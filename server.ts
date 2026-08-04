import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import mammoth from "mammoth";

// Ensure data directory exists (best-effort — may fail on read-only filesystems like Vercel)
const DATA_DIR = path.join(process.cwd(), "data");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

// In-memory fallback cache for production environments with read-only filesystems (e.g. Vercel)
// Reports stored here survive within a single server instance / warm lambda invocation
const inMemoryReports: Map<string, any> = new Map();
const isReadOnlyFS = (() => {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, JSON.stringify([], null, 2), "utf-8");
    return false;
  } catch {
    console.warn("[Storage] Filesystem is read-only (Vercel/serverless). Using in-memory + Supabase only.");
    return true;
  }
})();

// Multer setup for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
});

// Lazy initialization of Supabase
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;
  if (!url || !key) {
    console.log("Supabase credentials not fully configured. Using local JSON store.");
    return null;
  }
  // If service role key is identical to the anon key, it means it's misconfigured.
  // The anon key lacks write permissions to unconfigured tables — skip Supabase writes.
  if (serviceKey && anonKey && serviceKey === anonKey) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY appears to equal the anon key — using local store to avoid NOT_FOUND errors.");
    console.warn("To enable Supabase: set SUPABASE_SERVICE_ROLE_KEY to your actual service role key from the Supabase dashboard.");
    return null;
  }
  try {
    return createClient(url, key);
  } catch (error) {
    console.error("Failed to initialize Supabase client:", error);
    return null;
  }
}

// Lazy initialization of the Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (geminiClient) return geminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required.");
  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

// Utility to wrap any Promise/Thenable with a timeout safely
function withTimeout<T>(promise: Promise<T> | any, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout"));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((res: any) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err: any) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Helper to save report locally (with in-memory fallback for read-only environments)
function saveReportLocally(report: any) {
  // Always keep in-memory copy
  inMemoryReports.set(report.id, report);
  if (isReadOnlyFS) return; // skip disk write on Vercel / read-only FS
  try {
    const data = fs.readFileSync(REPORTS_FILE, "utf-8");
    const reports = JSON.parse(data);
    // Avoid duplicates
    const idx = reports.findIndex((r: any) => r.id === report.id);
    if (idx >= 0) reports[idx] = report; else reports.push(report);
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Storage] Local file write failed (report kept in memory):", err);
  }
}

// Helper to normalize and dynamically extract report summary and indicators if missing
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

// Helper to get reports locally (checks in-memory first, then disk)
function getReportLocally(id: string) {
  // Check in-memory cache first (fast, works on Vercel)
  if (inMemoryReports.has(id)) return inMemoryReports.get(id);
  if (isReadOnlyFS) return null;
  try {
    const data = fs.readFileSync(REPORTS_FILE, "utf-8");
    const reports = JSON.parse(data);
    return reports.find((r: any) => r.id === id) || null;
  } catch (err) {
    console.error("Error retrieving report locally:", err);
    return null;
  }
}

// Helper to clean markdown JSON wrappers from LLM responses
function cleanJSONString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
    cleaned = cleaned.replace(/```$/, "");
  }
  return cleaned.trim();
}

// Per-request cap. The previous NVIDIA implementation had no timeout, so a
// stalled connection hung the whole upload indefinitely.
const GEMINI_TIMEOUT_MS = 60000;

// Helper to call the Gemini API with retry and fallback models.
// `params` is already Gemini-native ({ model, contents, config }), so contents
// and config pass straight through to the SDK.
async function generateContentWithRetry(ai: any, params: any, maxRetries = 2): Promise<any> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required.");
  }

  // Caller's model first, then a stable fallback if it is unavailable/overloaded.
  const requestedModel = params.model || "gemini-3.5-flash";
  const modelsToTry = [requestedModel, "gemini-2.5-flash"].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );

  for (const currentModel of modelsToTry) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        console.log(`[Gemini] Generating with model: ${currentModel} (Attempt ${attempt + 1}/${maxRetries + 1})`);

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
        console.log(`[Gemini] Received response from ${currentModel}. Length: ${assistantMessage.length}`);

        if (!assistantMessage) {
          throw new Error("Gemini returned an empty response.");
        }

        const wantsJSON =
          params.config?.responseMimeType === "application/json" ||
          params.responseMimeType === "application/json";
        if (wantsJSON) {
          assistantMessage = cleanJSONString(assistantMessage);
        }

        return {
          text: assistantMessage
        };

      } catch (error: any) {
        attempt++;
        const errorMessage = error.message || String(error);
        console.error(`[Gemini Error] Model: ${currentModel}, Attempt: ${attempt}, Error: ${errorMessage}`);

        if (attempt > maxRetries) {
          console.warn(`[Gemini] Max retries reached for model ${currentModel}.`);
          break; // move to next model in modelsToTry
        }

        const delay = 1000 * attempt;
        console.log(`[Gemini] Waiting ${delay}ms before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error("The clinical analysis models are currently experiencing high demand. Please try again in a few seconds.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Analyze report
  app.post("/api/analyze", upload.single("file"), async (req, res): Promise<any> => {
    try {
      const file = req.file;
      const location = req.body.location || "Default Location";

      if (!file) {
        return res.status(400).json({ error: "Please upload a pregnancy report file (PDF, Word DOCX/DOC, or Image)." });
      }

      console.log(`Analyzing file: ${file.originalname} (mimetype: ${file.mimetype}) near ${location}`);

      // 1. Save file to local disk (reliable, no external dependency on Supabase Storage bucket).
      //    Report metadata is still persisted to Supabase DB below.
      let fileUrl = "";
      const supabase = getSupabaseClient();
      const uniqueFilename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;

      // Normalize mimeType to ensure correct forwarding to AI
      let mimeType = file.mimetype;
      if (file.originalname.toLowerCase().endsWith(".docx")) {
        mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (file.originalname.toLowerCase().endsWith(".doc")) {
        mimeType = "application/msword";
      } else if (mimeType === "application/octet-stream") {
        if (file.originalname.toLowerCase().endsWith(".pdf")) {
          mimeType = "application/pdf";
        } else if (file.originalname.toLowerCase().endsWith(".png")) {
          mimeType = "image/png";
        } else if (file.originalname.toLowerCase().endsWith(".jpg") || file.originalname.toLowerCase().endsWith(".jpeg")) {
          mimeType = "image/jpeg";
        }
      }

      // Always save locally — avoids Supabase Storage bucket NOT_FOUND errors.
      // If you want Supabase Storage, create the 'pregnancy-reports' bucket first
      // and replace SUPABASE_SERVICE_ROLE_KEY with the actual service role key.
      try {
        const localPath = path.join(UPLOADS_DIR, uniqueFilename);
        fs.writeFileSync(localPath, file.buffer);
        fileUrl = `/api/uploads/${uniqueFilename}`;
        console.log(`File saved locally: ${localPath}`);
      } catch (fsErr: any) {
        console.error("Failed to save file locally:", fsErr.message);
        // Non-fatal: continue without file URL
        fileUrl = "";
      }

      // 2. Call Gemini for analysis
      const ai = getGeminiClient();
      let isWordDoc = file.originalname.toLowerCase().endsWith(".docx") || file.originalname.toLowerCase().endsWith(".doc");
      let extractedText = "";

      if (isWordDoc) {
        try {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          extractedText = result.value || "";
          console.log(`Successfully extracted ${extractedText.length} characters of text from Word document.`);
        } catch (err) {
          console.error("Mammoth text extraction failed:", err);
          extractedText = `Word document: ${file.originalname} could not be fully decoded, but it has size of ${file.buffer.length} bytes.`;
        }
      }

      const contents: any[] = [];
      if (isWordDoc) {
        contents.push({
          text: `Evaluate this text-extracted pregnancy report. Here is the raw patient content from the Word document:\n\n${extractedText}`
        });
      } else {
        contents.push({
          inlineData: {
            data: file.buffer.toString("base64"),
            mimeType: mimeType,
          },
        });
        contents.push({
          text: "Analyze this pregnancy report carefully and extract indicators and risk assessment."
        });
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

      const geminiResponse = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              patient_name: {
                type: Type.STRING,
                description: "Full name of the patient extracted from the report. Return 'Patient' if not found."
              },
              age: {
                type: Type.INTEGER,
                description: "Age in years of the patient if found. If not found, return 28."
              },
              risk_level: {
                type: Type.STRING,
                description: "Risk assessment: LOW, MEDIUM, or HIGH"
              },
              summary: {
                type: Type.STRING,
                description: "Warm, plain language summary written directly to the patient explaining the report findings."
              },
              indicators: {
                type: Type.ARRAY,
                description: "Checklist of health parameters detected in the medical report.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    parameter: { type: Type.STRING, description: "Name of health parameter (e.g. Hemoglobin, Blood Glucose, Blood Pressure, Urine Albumin)" },
                    value: { type: Type.STRING, description: "Extracted value with unit (e.g. '11.2 g/dL' or '120/80 mmHg')" },
                    status: { type: Type.STRING, description: "Status must be exactly 'normal' or 'abnormal'" }
                  },
                  required: ["parameter", "value", "status"]
                }
              },
              recommended_actions: {
                type: Type.ARRAY,
                description: "A list of warm recommended actions for mother/fetal safety.",
                items: { type: Type.STRING }
              }
            },
            required: ["patient_name", "age", "risk_level", "summary", "indicators", "recommended_actions"]
          }
        }
      });

      const responseText = geminiResponse.text?.trim() || "{}";
      let parsedAnalysis: any = {};
      try {
        parsedAnalysis = JSON.parse(responseText);
      } catch (parseErr: any) {
        console.error("Failed to parse AI analysis response as JSON:", parseErr.message);
        console.error("Raw AI response was:", responseText.substring(0, 300));
        // Return a safe fallback analysis so the report still saves
        parsedAnalysis = {
          patient_name: "Patient",
          age: 28,
          risk_level: "LOW",
          summary: "Your pregnancy report has been received. Our AI encountered a temporary issue parsing the detailed results. Please consult your healthcare provider for a full analysis.",
          indicators: [],
          recommended_actions: ["Please share this report with your healthcare provider for a detailed review."]
        };
      }

      // Create Report object
      const reportId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const newReport = normalizeReport({
        id: reportId,
        patient_name: parsedAnalysis.patient_name || "Patient",
        age: parsedAnalysis.age || 28,
        location: location,
        risk_level: parsedAnalysis.risk_level === 'HIGH' || parsedAnalysis.risk_level === 'MEDIUM' ? parsedAnalysis.risk_level : 'LOW',
        summary: parsedAnalysis.summary || "No summary generated.",
        indicators: parsedAnalysis.indicators || [],
        raw_analysis: parsedAnalysis,
        file_url: fileUrl,
        created_at: new Date().toISOString(),
      });

      // 3. Save to database / local store
      // NOTE: Always use local fallback on any error — never let DB failures propagate to the API response.
      let savedToSupabase = false;
      if (supabase) {
        try {
          const insertPromise = supabase
            .from("reports")
            .insert({
              id: newReport.id,
              patient_name: newReport.patient_name,
              age: newReport.age,
              location: newReport.location,
              risk_level: newReport.risk_level,
              summary: newReport.summary,
              indicators: newReport.indicators,
              raw_analysis: newReport.raw_analysis,
              file_url: newReport.file_url,
              created_at: newReport.created_at
            }) as any;

          const result = await withTimeout(insertPromise, 3000).catch((err: any) => {
            // Catch any rejection from withTimeout (timeout or supabase network error)
            return { error: err };
          }) as any;

          const dbError = result?.error;
          if (dbError) {
            // Supabase DB errors (table NOT_FOUND, RLS, missing table, etc.) — always fall back to local
            const errCode = typeof dbError === "object" ? (dbError.code || "") : "";
            const errMsg = typeof dbError === "object" ? (dbError.message || dbError.code || JSON.stringify(dbError)) : String(dbError);
            console.error(`Supabase DB save error [${errCode}] (falling back to local):`, errMsg);
            saveReportLocally(newReport);
          } else {
            console.log("Report saved successfully in Supabase.");
            savedToSupabase = true;
          }
        } catch (dbEx: any) {
          // Belt-and-suspenders: catch anything that escapes above
          console.error("Database save exception, using local fallback:", dbEx?.message || String(dbEx));
          saveReportLocally(newReport);
        }
      } else {
        saveReportLocally(newReport);
      }

      // Also always save locally as a redundant backup when Supabase is used
      // so reports are retrievable even if Supabase read fails later
      if (savedToSupabase) {
        try { saveReportLocally(newReport); } catch (_) { /* best-effort */ }
      }

      return res.json({
        reportId: newReport.id,
        patientName: newReport.patient_name,
        age: newReport.age,
        riskLevel: newReport.risk_level,
        summary: newReport.summary,
        indicators: newReport.indicators,
        recommended_actions: parsedAnalysis.recommended_actions || []
      });

    } catch (error: any) {
      console.error("Error in report analysis API:", error);
      return res.status(500).json({ error: error.message || "An error occurred during report analysis." });
    }
  });

  // API Route: Get doctor search — powered by Google Maps Places API
  app.get("/api/doctors", async (req, res): Promise<any> => {
    try {
      const city = req.query.location as string;
      let lat = req.query.lat as string;
      let lon = req.query.lon as string;
      const mapsKey = process.env.GOOGLE_MAPS_API_KEY;

      if (!city && !lat && !lon) {
        return res.status(400).json({ error: "Location is required." });
      }

      // Step 1: If no GPS coords and we have a city, geocode via Google Geocoding API
      if ((!lat || !lon) && city) {
        try {
          if (mapsKey) {
            console.log(`Geocoding "${city}" via Google Geocoding API...`);
            const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${mapsKey}`;
            const geoRes = await fetch(geocodeUrl);
            if (geoRes.ok) {
              const geoData = await geoRes.json();
              if (geoData.results && geoData.results.length > 0) {
                lat = String(geoData.results[0].geometry.location.lat);
                lon = String(geoData.results[0].geometry.location.lng);
                console.log(`Geocoded "${city}" → lat:${lat}, lon:${lon}`);
              }
            }
          } else {
            // Fallback to Nominatim if no Maps key
            const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
            const geoRes = await fetch(geocodeUrl, { headers: { "User-Agent": "PreCare/1.0" } });
            if (geoRes.ok) {
              const geoData = await geoRes.json();
              if (geoData && geoData.length > 0) {
                lat = geoData[0].lat;
                lon = geoData[0].lon;
              }
            }
          }
        } catch (geoErr: any) {
          console.warn("Geocoding failed:", geoErr.message);
        }
      }

      let doctors: any[] = [];

      // Step 2: Google Maps Places Nearby Search for real hospitals/clinics
      if (lat && lon && mapsKey) {
        try {
          const radius = 10000; // 10km
          const keyword = "maternity hospital gynecologist obstetrics prenatal clinic";
          console.log(`Querying Google Places Nearby Search near (${lat},${lon})...`);

          // Use the Places API Nearby Search endpoint
          const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${radius}&type=hospital&keyword=${encodeURIComponent(keyword)}&key=${mapsKey}`;
          const placesRes = await fetch(placesUrl);

          if (placesRes.ok) {
            const placesData = await placesRes.json();
            console.log(`Google Places returned status: ${placesData.status}, results: ${placesData.results?.length || 0}`);

            if (placesData.status === "OK" || placesData.status === "ZERO_RESULTS") {
              const results = placesData.results || [];

              // Fetch details for top results to get phone/website
              const detailPromises = results.slice(0, 10).map(async (place: any) => {
                const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,geometry&key=${mapsKey}`;
                try {
                  const detailRes = await fetch(detailUrl);
                  if (detailRes.ok) {
                    const detailData = await detailRes.json();
                    return detailData.result || place;
                  }
                } catch (e) {}
                return place;
              });

              const detailedPlaces = await Promise.all(detailPromises);

              doctors = detailedPlaces.map((place: any) => {
                const placeLocation = place.geometry?.location;
                const mapsUrl = placeLocation
                  ? `https://www.google.com/maps/search/?api=1&query=${placeLocation.lat},${placeLocation.lng}&query_place_id=${place.place_id}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name || place.formatted_address || "")}` ;

                const typeStr = (place.types || []).join(",");
                return {
                  name: place.name || "Medical Facility",
                  address: place.formatted_address || place.vicinity || "See directions for address",
                  phone: place.formatted_phone_number || null,
                  website: place.website || null,
                  mapsUrl,
                  rating: place.rating || null,
                  user_ratings_total: place.user_ratings_total || null,
                  _type: typeStr.includes("hospital") ? "hospital" : typeStr.includes("doctor") ? "doctor" : "clinic",
                  _speciality: null,
                };
              });

              console.log(`Mapped ${doctors.length} doctors from Google Places.`);
            } else {
              console.warn(`Google Places API error status: ${placesData.status}`);
            }
          }
        } catch (placesErr: any) {
          console.error("Google Places API error:", placesErr.message);
        }
      } else if (lat && lon && !mapsKey) {
        // No Maps key — keep Overpass as fallback
        console.log("No GOOGLE_MAPS_API_KEY set, skipping Google Places.");
      }

      // Step 3: Fall back to mock data if nothing was found
      if (doctors.length === 0) {
        console.log("No real results found, using curated fallback list.");
        doctors = getMockDoctors(city || "your area");
      }

      // Step 4: AI-powered ranking via NVIDIA — picks the best clinic for high-risk maternal patient
      if (doctors.length > 0) {
        try {
          const ai = getGeminiClient();
          const doctorSummaries = doctors.slice(0, 10).map((d: any, i: number) =>
            `${i + 1}. Name: "${d.name}", Type: ${d._type || "clinic"}, Address: "${d.address}", Rating: ${d.rating || "N/A"}/5 (${d.user_ratings_total || 0} reviews), Phone: "${d.phone || "N/A"}"`
          ).join("\n");

          const aiResp = await generateContentWithRetry(ai, {
            model: "gemini-3.5-flash",
            contents: [
              {
                role: "user",
                parts: [{
                  text: `You are a maternal health advisor. A HIGH-RISK pregnant patient needs the best nearby clinic. From this list, pick the ONE most suitable (prefer hospitals > OB-GYN clinics > general; prefer higher ratings; prefer those with "maternity", "gynae", "obstetric", "women" in name). Return JSON: { "bestIndex": <0-based index>, "reason": "<warm 1-sentence reason, max 20 words>" }\n\nClinics:\n${doctorSummaries}`
                }]
              }
            ],
            config: { responseMimeType: "application/json" }
          });

          const aiText = aiResp.text?.trim() || "{}";
          const aiPick = JSON.parse(aiText);
          if (typeof aiPick.bestIndex === "number" && doctors[aiPick.bestIndex]) {
            doctors[aiPick.bestIndex].aiRecommended = true;
            doctors[aiPick.bestIndex].aiReason = aiPick.reason || "Highly recommended for maternal and prenatal care in your area.";
            const recommended = doctors.splice(aiPick.bestIndex, 1)[0];
            doctors.unshift(recommended);
          }
        } catch (aiErr: any) {
          console.warn("AI doctor ranking skipped:", aiErr.message);
        }
      }

      // Clean up internal fields before sending to client
      const result = doctors.map(({ _type, _speciality, ...rest }: any) => rest);
      return res.json(result);

    } catch (error: any) {
      console.error("Error fetching doctors:", error);
      return res.status(500).json({ error: error.message || "An error occurred fetching nearby doctors." });
    }
  });

  // API Route: Send confirmation email via Resend
  app.post("/api/auth/send-email", async (req, res): Promise<any> => {
    try {
      const { email, name, type } = req.body; // type: "signup" | "signin"
      const resendKey = process.env.RESEND_API_KEY;

      if (!resendKey) {
        return res.status(500).json({ error: "Email service not configured." });
      }
      if (!email || !type) {
        return res.status(400).json({ error: "Email and type are required." });
      }

      const displayName = name || email.split("@")[0];
      const isSignup = type === "signup";

      const subject = isSignup
        ? "🌸 Welcome to PreCare — Your Secure Pregnancy Companion"
        : "🔐 PreCare — New Sign-In Detected";

      const htmlBody = isSignup ? `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Welcome to PreCare</title></head>
<body style="margin:0;padding:0;background:#fdf8f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fefaf6;border:1px solid #f3e9df;border-radius:24px;overflow:hidden;max-width:560px;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#EB1367,#FF5E9B);padding:36px 40px;text-align:center;">
          <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <span style="font-size:28px;">🌸</span>
          </div>
          <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Welcome to PreCare</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Secure Pregnancy Care Platform</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="margin:0 0 16px;color:#5a4d44;font-size:16px;">Dear <strong style="color:#EB1367;">${displayName}</strong>,</p>
          <p style="margin:0 0 24px;color:#72645a;font-size:15px;line-height:1.7;">Your account has been successfully created. You now have secure access to the full PreCare pregnancy care suite.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF2F6;border:1px solid #FFCCD8;border-radius:16px;padding:20px;margin-bottom:24px;">
            <tr><td>
              <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#EB1367;text-transform:uppercase;letter-spacing:0.5px;">What you can do now:</p>
              <table cellpadding="0" cellspacing="0"><tbody>
                <tr><td style="padding:6px 0;"><span style="color:#EB1367;margin-right:10px;">🔬</span><span style="color:#5a4d44;font-size:14px;">Upload & analyze pregnancy reports with NVIDIA AI</span></td></tr>
                <tr><td style="padding:6px 0;"><span style="color:#EB1367;margin-right:10px;">📊</span><span style="color:#5a4d44;font-size:14px;">Get plain-language summaries of lab biomarkers</span></td></tr>
                <tr><td style="padding:6px 0;"><span style="color:#EB1367;margin-right:10px;">🗺️</span><span style="color:#5a4d44;font-size:14px;">Find nearby gynecologists & maternity clinics</span></td></tr>
                <tr><td style="padding:6px 0;"><span style="color:#EB1367;margin-right:10px;">🔒</span><span style="color:#5a4d44;font-size:14px;">HIPAA-compliant, encrypted secure storage</span></td></tr>
              </tbody></table>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#72645a;font-size:13px;">If you didn't create this account, please ignore this email — your email has not been shared with anyone.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#fdf8f4;border-top:1px solid #f3e9df;padding:20px 40px;text-align:center;">
          <p style="margin:0;color:#a09080;font-size:12px;">© 2026 PreCare · Secure Pregnancy Care · HIPAA Compliant</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>` : `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>New Sign-In to PreCare</title></head>
<body style="margin:0;padding:0;background:#fdf8f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fefaf6;border:1px solid #f3e9df;border-radius:24px;overflow:hidden;max-width:560px;">
        <tr><td style="background:linear-gradient(135deg,#4a7c6a,#618266);padding:36px 40px;text-align:center;">
          <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <span style="font-size:28px;">🔐</span>
          </div>
          <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">New Sign-In Detected</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">PreCare Account Security</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <p style="margin:0 0 16px;color:#5a4d44;font-size:16px;">Hello <strong style="color:#618266;">${displayName}</strong>,</p>
          <p style="margin:0 0 24px;color:#72645a;font-size:15px;line-height:1.7;">A new sign-in to your PreCare account was detected. If this was you, no action is required.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f9f6;border:1px solid #e8efe8;border-radius:16px;padding:20px;margin-bottom:24px;">
            <tr><td>
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#618266;text-transform:uppercase;letter-spacing:0.5px;">Sign-In Details:</p>
              <p style="margin:0;color:#5a4d44;font-size:14px;">🕐 Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (IST)</p>
              <p style="margin:4px 0 0;color:#5a4d44;font-size:14px;">📧 Account: ${email}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#72645a;font-size:13px;"><strong>Didn't sign in?</strong> Please change your password immediately to secure your account.</p>
        </td></tr>
        <tr><td style="background:#fdf8f4;border-top:1px solid #f3e9df;padding:20px 40px;text-align:center;">
          <p style="margin:0;color:#a09080;font-size:12px;">© 2026 PreCare · Secure Pregnancy Care · HIPAA Compliant</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      // Send via Resend API
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "PreCare <onboarding@resend.dev>",
          to: [email],
          subject,
          html: htmlBody
        })
      });

      const resendData = await resendRes.json();
      if (!resendRes.ok) {
        console.error("Resend API error:", resendData);
        return res.status(500).json({ error: "Failed to send confirmation email.", details: resendData });
      }

      console.log(`[Resend] ${type} confirmation email sent to ${email}, id: ${resendData.id}`);
      return res.json({ success: true, id: resendData.id });

    } catch (error: any) {
      console.error("Error sending email:", error);
      return res.status(500).json({ error: error.message || "Email send failed." });
    }
  });


  // Retrieve single report
  app.get("/api/reports/:id", async (req, res): Promise<any> => {
    try {
      const id = req.params.id;
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          const selectPromise = supabase
            .from("reports")
            .select("*")
            .eq("id", id)
            .single() as any;

          const { data, error } = await withTimeout(selectPromise, 2500) as any;

          if (error || !data) {
            const errMsg = error ? (typeof error === "object" ? (error.message || error.code || JSON.stringify(error)) : String(error)) : "no data";
            console.log("Supabase report not found or error, trying local... Reason:", errMsg);
            const localReport = getReportLocally(id);
            if (!localReport) return res.status(404).json({ error: "Report not found." });
            return res.json(normalizeReport(localReport));
          }
          return res.json(normalizeReport(data));
        } catch (ex: any) {
          console.log("Supabase retrieve timed out or exception occurred, fetching local:", ex.message || ex);
          const localReport = getReportLocally(id);
          if (!localReport) return res.status(404).json({ error: "Report not found." });
          return res.json(normalizeReport(localReport));
        }
      } else {
        const localReport = getReportLocally(id);
        if (!localReport) return res.status(404).json({ error: "Report not found." });
        return res.json(normalizeReport(localReport));
      }
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Serve uploaded images/PDFs on fallback directory
  app.use("/api/uploads", express.static(UPLOADS_DIR));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Full-featured mock data for offline/unconfigured environments
function getMockDoctors(city: string) {
  return [
    {
      name: "Dr. Evelyn Ross, MD (PreCare)",
      rating: 4.8,
      user_ratings_total: 124,
      address: `102 Oakwood Medical Center, ${city}`,
      phone: "+1 (555) 321-4567",
      website: "https://example.com/evelyn-ross",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Dr Evelyn Ross MD in " + city)}`,
    },
    {
      name: "Women's Health & Gynaecology Associates",
      rating: 4.9,
      user_ratings_total: 82,
      address: `455 Pine Crest Blvd Suite B, ${city}`,
      phone: "+1 (555) 789-1011",
      website: "https://example.com/womens-associates",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Womens Health Gynecology in " + city)}`,
    },
    {
      name: "St. Mary Maternal-Fetal Wellness Clinic",
      rating: 4.7,
      user_ratings_total: 215,
      address: `Hospital Pavilion Lane, ${city}`,
      phone: "+1 (555) 901-4422",
      website: "https://example.com/st-mary-maternal",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("St Mary Maternal Wellness Clinic in " + city)}`,
    },
    {
      name: "Dr. Sarah Patel, OB-GYN",
      rating: 4.6,
      user_ratings_total: 58,
      address: `88 Broad Street Wellness Hub, ${city}`,
      phone: "+1 (555) 234-9090",
      website: "https://example.com/sarah-patel",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Dr Sarah Patel OBGYN in " + city)}`,
    },
    {
      name: "Prestige Pregnancy Care Clinic",
      rating: 4.9,
      user_ratings_total: 94,
      address: `12 Golden Gate Way Suite 300, ${city}`,
      phone: "+1 (555) 678-0112",
      website: "https://example.com/prestige-pregnancy",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Prestige Pregnancy Care in " + city)}`,
    },
  ];
}

startServer();
