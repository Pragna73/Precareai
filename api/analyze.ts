import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";
import formidable, { File as FormidableFile } from "formidable";
import fs from "fs";

// ─── In-memory fallback (survives within a warm lambda invocation) ───────────
const inMemoryReports: Map<string, any> = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;
  if (!url || !key) return null;
  if (serviceKey && anonKey && serviceKey === anonKey) return null;
  try {
    return createClient(url, key);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T> | any, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    Promise.resolve(promise)
      .then((res: any) => { clearTimeout(timer); resolve(res); })
      .catch((err: any) => { clearTimeout(timer); reject(err); });
  });
}

function cleanJSONString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
    cleaned = cleaned.replace(/```$/, "");
  }
  return cleaned.trim();
}

// Per-request cap. The previous NVIDIA implementation had no timeout, so a
// stalled connection hung the whole request indefinitely.
const GEMINI_TIMEOUT_MS = 60000;

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (geminiClient) return geminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required.");
  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

// `params` is already Gemini-native ({ model, contents, config }), so contents
// and config pass straight through to the SDK.
async function generateContentWithRetry(params: any, maxRetries = 2): Promise<any> {
  const ai = getGeminiClient();

  // Caller's model first, then a stable fallback if it is unavailable/overloaded.
  const requestedModel = params.model || "gemini-3.5-flash";
  const modelsToTry = [requestedModel, "gemini-2.5-flash"].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );

  for (const currentModel of modelsToTry) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        console.log(`[Gemini] Model: ${currentModel} (Attempt ${attempt + 1})`);

        // withTimeout guarantees this settles even if the network stalls.
        const response: any = await withTimeout(
          ai.models.generateContent({
            model: currentModel,
            contents: params.contents,
            config: {
              temperature: 0.1,
              ...(params.config || {}),
            },
          }),
          GEMINI_TIMEOUT_MS
        );

        let assistantMessage = response?.text || "";
        if (!assistantMessage) throw new Error("Gemini returned an empty response.");

        if (params.config?.responseMimeType === "application/json") {
          assistantMessage = cleanJSONString(assistantMessage);
        }
        return { text: assistantMessage };
      } catch (error: any) {
        attempt++;
        console.error(`[Gemini Error] Model: ${currentModel}, Attempt: ${attempt}, Error: ${error.message}`);
        if (attempt > maxRetries) break;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw new Error("The clinical analysis models are currently experiencing high demand. Please try again.");
}

// ─── Parse multipart form using formidable ───────────────────────────────────
function parseForm(req: VercelRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({ maxFileSize: 15 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    form.parse(req as any, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function normalizeReport(report: any) {
  if (!report) return report;
  
  // 1. Normalize summary
  if (!report.summary || report.summary === "No summary generated.") {
    const raw = report.raw_analysis || {};
    report.summary = raw.summary || raw.plain_language_summary || raw.plainLanguageSummary || "No summary generated.";
  }
  
  // 2. Normalize indicators
  if (!report.indicators || report.indicators.length === 0) {
    const raw = report.raw_analysis || {};
    if (raw.indicators && raw.indicators.length > 0) {
      report.indicators = raw.indicators;
    } else if (raw.key_health_indicators) {
      const abnormalList: string[] = [];
      if (Array.isArray(raw.abnormal_values)) {
        raw.abnormal_values.forEach((v: any) => abnormalList.push(String(v).toLowerCase()));
      } else if (raw.abnormal_values && typeof raw.abnormal_values === "object") {
        Object.entries(raw.abnormal_values).forEach(([k, v]) => {
          abnormalList.push(String(k).toLowerCase());
          abnormalList.push(String(v).toLowerCase());
        });
      }
      
      report.indicators = Object.entries(raw.key_health_indicators).map(([key, val]) => {
        const parameter = key
          .split(/[_-]/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
        
        const isAbnormal = abnormalList.some((abVal: string) => 
          abVal.includes(key.toLowerCase()) || 
          abVal.includes(parameter.toLowerCase())
        );
        
        return {
          parameter,
          value: String(val),
          status: isAbnormal ? "abnormal" : "normal"
        };
      });
    }
  }
  
  return report;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { fields, files } = await parseForm(req);

    const location =
      (Array.isArray(fields.location) ? fields.location[0] : fields.location) ||
      "Default Location";

    const fileField = files.file;
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!uploadedFile) {
      return res.status(400).json({
        error: "Please upload a pregnancy report file (PDF, Word DOCX/DOC, or Image).",
      });
    }

    const originalName: string = uploadedFile.originalFilename || "upload";
    let mimeType: string = uploadedFile.mimetype || "application/octet-stream";

    // Normalize mimetype by extension
    if (originalName.toLowerCase().endsWith(".docx"))
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if (originalName.toLowerCase().endsWith(".doc"))
      mimeType = "application/msword";
    else if (mimeType === "application/octet-stream") {
      if (originalName.toLowerCase().endsWith(".pdf")) mimeType = "application/pdf";
      else if (originalName.toLowerCase().endsWith(".png")) mimeType = "image/png";
      else if (originalName.toLowerCase().endsWith(".jpg") || originalName.toLowerCase().endsWith(".jpeg"))
        mimeType = "image/jpeg";
    }

    // Read file buffer from temp path (formidable writes to /tmp on Vercel)
    const fileBuffer = fs.readFileSync(uploadedFile.filepath);

    // No local disk storage on Vercel — file URL stays empty
    const fileUrl = "";

    // Extract text from Word docs
    const isWordDoc =
      originalName.toLowerCase().endsWith(".docx") ||
      originalName.toLowerCase().endsWith(".doc");
    let extractedText = "";
    if (isWordDoc) {
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText = result.value || "";
      } catch (err) {
        extractedText = `Word document: ${originalName} could not be fully decoded.`;
      }
    }

    const contents: any[] = [];
    if (isWordDoc) {
      contents.push({
        text: `Evaluate this text-extracted pregnancy report. Here is the raw patient content from the Word document:\n\n${extractedText}`,
      });
    } else {
      contents.push({ inlineData: { data: fileBuffer.toString("base64"), mimeType } });
      contents.push({ text: "Analyze this pregnancy report carefully and extract indicators and risk assessment." });
    }

    const systemPrompt = `You are a medical AI assistant specializing in pregnancy health. Analyze this pregnancy report and extract: 
1) The patient's full name (usually listed as name, patient, mother, or client. If not found, return "Patient")
2) The patient's age as an integer (If not found or not mentioned, default to 28)
3) Key health indicators (hemoglobin, blood pressure, sugar levels, etc.)
4) Any abnormal values
5) Risk level: LOW / MEDIUM / HIGH
6) Plain language summary for the patient
7) Recommended actions.
Return everything formatted as a validated JSON object.`;

    const geminiResponse = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            patient_name: { type: Type.STRING, description: "Full name of the patient. Return 'Patient' if not found." },
            age: { type: Type.INTEGER, description: "Age in years. Default 28 if not found." },
            risk_level: { type: Type.STRING, description: "Risk assessment: LOW, MEDIUM, or HIGH" },
            summary: { type: Type.STRING, description: "Warm, plain language summary for the patient." },
            indicators: {
              type: Type.ARRAY,
              description: "Checklist of health parameters.",
              items: {
                type: Type.OBJECT,
                properties: {
                  parameter: { type: Type.STRING, description: "Name of health parameter" },
                  value: { type: Type.STRING, description: "Extracted value with unit" },
                  status: { type: Type.STRING, description: "Status: 'normal' or 'abnormal'" },
                },
                required: ["parameter", "value", "status"],
              },
            },
            recommended_actions: {
              type: Type.ARRAY,
              description: "List of recommended actions.",
              items: { type: Type.STRING },
            },
          },
          required: ["patient_name", "age", "risk_level", "summary", "indicators", "recommended_actions"],
        },
      },
    });

    const responseText = geminiResponse.text?.trim() || "{}";
    let parsedAnalysis: any = {};
    try {
      parsedAnalysis = JSON.parse(responseText);
    } catch {
      parsedAnalysis = {
        patient_name: "Patient",
        age: 28,
        risk_level: "LOW",
        summary:
          "Your pregnancy report has been received. Our AI encountered a temporary issue parsing the detailed results. Please consult your healthcare provider for a full analysis.",
        indicators: [],
        recommended_actions: ["Please share this report with your healthcare provider for a detailed review."],
      };
    }

    const reportId =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    const newReport = normalizeReport({
      id: reportId,
      patient_name: parsedAnalysis.patient_name || "Patient",
      age: parsedAnalysis.age || 28,
      location,
      risk_level:
        parsedAnalysis.risk_level === "HIGH" || parsedAnalysis.risk_level === "MEDIUM"
          ? parsedAnalysis.risk_level
          : "LOW",
      summary: parsedAnalysis.summary || "No summary generated.",
      indicators: parsedAnalysis.indicators || [],
      raw_analysis: parsedAnalysis,
      file_url: fileUrl,
      created_at: new Date().toISOString(),
    });

    // Always keep in-memory copy
    inMemoryReports.set(newReport.id, newReport);

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const insertPromise = supabase.from("reports").insert({
          id: newReport.id,
          patient_name: newReport.patient_name,
          age: newReport.age,
          location: newReport.location,
          risk_level: newReport.risk_level,
          summary: newReport.summary,
          indicators: newReport.indicators,
          raw_analysis: newReport.raw_analysis,
          file_url: newReport.file_url,
          created_at: newReport.created_at,
        }) as any;

        const result = await withTimeout(insertPromise, 3000).catch((err: any) => ({ error: err })) as any;
        if (result?.error) {
          const errMsg =
            typeof result.error === "object"
              ? result.error.message || result.error.code || JSON.stringify(result.error)
              : String(result.error);
          console.error("Supabase insert error (in-memory fallback):", errMsg);
        } else {
          console.log("Report saved to Supabase.");
        }
      } catch (dbEx: any) {
        console.error("Database save exception:", dbEx?.message || String(dbEx));
      }
    }

    return res.json({
      reportId: newReport.id,
      patientName: newReport.patient_name,
      age: newReport.age,
      riskLevel: newReport.risk_level,
      summary: newReport.summary,
      indicators: newReport.indicators,
      recommended_actions: parsedAnalysis.recommended_actions || [],
    });
  } catch (error: any) {
    console.error("Error in /api/analyze:", error);
    return res.status(500).json({ error: error.message || "An error occurred during report analysis." });
  }
}
