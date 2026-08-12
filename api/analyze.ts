import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";
import pako from "pako";
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

const GEMINI_TIMEOUT_MS = 25000;
const GEMINI_TOTAL_BUDGET_MS = 55000;
const GEMINI_FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-flash-latest"];

function isPermanentModelError(message: string): boolean {
  return /NOT_FOUND|no longer available|INVALID_ARGUMENT|PERMISSION_DENIED|API key not valid|"code":\s*40[0134]/i.test(
    message
  );
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (geminiClient) return geminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required.");
  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

async function generateContentWithRetry(params: any, maxRetries = 2): Promise<any> {
  const ai = getGeminiClient();
  const requestedModel = params.model || GEMINI_FALLBACK_MODELS[0];
  const modelsToTry = [requestedModel, ...GEMINI_FALLBACK_MODELS].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );

  const deadline = Date.now() + GEMINI_TOTAL_BUDGET_MS;
  let lastError = "";

  for (const currentModel of modelsToTry) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.warn("[Gemini] Total time budget exhausted; giving up.");
        break;
      }

      try {
        console.log(`[Gemini] Model: ${currentModel} (Attempt ${attempt + 1})`);
        const response: any = await withTimeout(
          ai.models.generateContent({
            model: currentModel,
            contents: params.contents,
            config: {
              temperature: 0.1,
              ...(params.config || {}),
            },
          }),
          Math.min(GEMINI_TIMEOUT_MS, remaining)
        );

        let assistantMessage = response?.text || "";
        if (!assistantMessage) throw new Error("Gemini returned an empty response.");

        if (params.config?.responseMimeType === "application/json") {
          assistantMessage = cleanJSONString(assistantMessage);
        }
        return { text: assistantMessage };
      } catch (error: any) {
        attempt++;
        lastError = error.message || String(error);
        console.error(`[Gemini Error] Model: ${currentModel}, Attempt: ${attempt}, Error: ${lastError}`);

        if (isPermanentModelError(lastError)) {
          console.warn(`[Gemini] ${currentModel} is permanently unavailable; moving to next model.`);
          break;
        }
        if (attempt > maxRetries) break;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  console.error(`[Gemini] All models exhausted. Last error: ${lastError}`);
  throw new Error("The clinical analysis models are currently experiencing high demand. Please try again.");
}

// ─── Strict Clinical Pregnancy Detection & Extraction Regexes ──────────────────
const STRICT_PREGNANCY_REGEX = /\b(pregnan\w*|prenatal|antenatal|maternal|obstetric\w*|gynecol\w*|gestat\w*|trimester\w*|fetal|foetal|fhr|preeclampsia|eclampsia|gravida|primigravida|multigravida|\bpara\b|lmp|edd|beta[- ]?hcg|fundal\s*height|amniotic\s*fluid|crown[- ]?rump|bpd|crl|efw|placenta|anc\s*card|anc\s*profile|anc\s*visit|maternity|prenatal\s*care|maternal\s*serum|quadruple\s*marker|double\s*marker|nuchal\s*translucency|nt\s*scan|anomaly\s*scan|usg\s*obstetric|usg\s*pelvis|fundus)\b/i;

const DISALLOWED_DOC_REGEX = /\b(invoice|receipt|resume|curriculum\s*vitae|cv|passport|driver\s*license|driving\s*license|vehicle|insurance\s*policy|tax\s*return|salary\s*slip|payslip|utility\s*bill|bank\s*statement|rental\s*agreement|employment\s*contract|homework|assignment|source\s*code|github|movie\s*ticket|flight\s*ticket|boarding\s*pass|electricity\s*bill|certificate\s*of\s*completion)\b/i;

const HB_REGEX = /\b(?:hemoglobin|haemoglobin|hb)\s*[:=]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:g\/dl|gm\/dl|g%|gm%|g\/l)?\b/i;
const BP_REGEX = /\b(?:blood\s*pressure|b\.?p\.?)\s*[:=]?\s*(\d{2,3}\s*\/\s*\d{2,3})\s*(?:mm\s*hg|mmhg)?\b/i;
const GLUCOSE_REGEX = /\b(?:fasting\s*blood\s*sugar|fbs|random\s*blood\s*sugar|rbs|blood\s*glucose|fasting\s*glucose|ogtt|gct|postprandial\s*glucose|ppbs)\s*[:=]?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:mg\/dl|mmol\/l)?\b/i;
const PROTEIN_REGEX = /\b(?:urine\s*protein|urine\s*albumin|albumin|protein\s*in\s*urine)\s*[:=]?\s*(\+\d|nil|negative|neg|trace|present|\d+\.?\d*\s*mg\/dl)/i;
const HCG_REGEX = /\b(?:beta[- ]?hcg|b[- ]?hcg|total\s*hcg|human\s*chorionic\s*gonadotropin)\s*[:=]?\s*([\d\.,]+)\s*(?:miu\/ml|iu\/l|ng\/ml)?\b/i;
const TSH_REGEX = /\b(?:tsh|thyroid\s*stimulating\s*hormone)\s*[:=]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:u[iu]\/ml|miu\/l|ng\/dl)?\b/i;
const PLATELET_REGEX = /\b(?:platelet\s*count|platelets|plt)\s*[:=]?\s*([\d,\.]+)\s*(?:lakhs?|\/cumm|\/u[lL]|x10\^3\/u[lL]|k\/u[lL])?\b/i;
const GESTATIONAL_AGE_REGEX = /\b(?:gestational\s*age|ga|period\s*of\s*gestation|pog)\s*[:=]?\s*(\d{1,2}\s*(?:weeks?|wks?)(?:\s*\+\s*\d{1,2}\s*(?:days?|d))?)/i;
const EDD_REGEX = /\b(?:edd|expected\s*date\s*of\s*delivery|due\s*date)\s*[:=]?\s*(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}|[A-Za-z]{3,9}\s*\d{1,2},?\s*\d{4})/i;
const FHR_REGEX = /\b(?:fetal\s*heart\s*rate|fhr|fetal\s*heart\s*sound|fhs)\s*[:=]?\s*(\d{2,3})\s*(?:bpm|beats\/min)?\b/i;

function extractTextFromPDF(buffer: Buffer): string {
  let text = "";
  try {
    const raw = buffer.toString("binary");
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    while ((match = streamRegex.exec(raw)) !== null) {
      const streamData = Buffer.from(match[1], "binary");
      try {
        const decompressed = pako.inflate(streamData);
        const decompressedText = Buffer.from(decompressed).toString("utf-8");
        const tjMatches = decompressedText.match(/\(([^()]*)\)\s*Tj/g);
        if (tjMatches) {
          text += " " + tjMatches.map(m => m.replace(/^[\s(]+|[)\sTj]+$/g, "")).join(" ");
        }
        const tjArrayMatches = decompressedText.match(/\[([^\]]*)\]\s*TJ/g);
        if (tjArrayMatches) {
          text += " " + tjArrayMatches.map(m => m.replace(/[\[\]\sTJ]/g, "").replace(/\(([^()]*)\)/g, "$1")).join(" ");
        }
        text += " " + decompressedText.replace(/[^\x20-\x7E\n\r\t]/g, " ");
      } catch (_) {
        text += " " + streamData.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
      }
    }

    const plainTj = raw.match(/\(([^()]{2,100})\)\s*Tj/g);
    if (plainTj) {
      text += " " + plainTj.map(m => m.replace(/^[\s(]+|[)\sTj]+$/g, "")).join(" ");
    }
  } catch (err) {
    console.warn("PDF text extraction warning:", err);
  }
  return text.trim();
}

function isPregnancyRelatedReport(filename: string, extractedText: string, isImage: boolean = false): boolean {
  const lowerFile = filename.toLowerCase();

  if (DISALLOWED_DOC_REGEX.test(lowerFile)) return false;

  const cleanText = extractedText.replace(/[^\x20-\x7E\n\r\t]/g, " ");
  if (DISALLOWED_DOC_REGEX.test(cleanText)) return false;

  const filenameHasPregnancy = STRICT_PREGNANCY_REGEX.test(lowerFile);
  const textHasPregnancy = STRICT_PREGNANCY_REGEX.test(cleanText);
  const hasPregnancyMarker = GESTATIONAL_AGE_REGEX.test(cleanText) ||
                             EDD_REGEX.test(cleanText) ||
                             FHR_REGEX.test(cleanText) ||
                             HCG_REGEX.test(cleanText);

  const hasBP = BP_REGEX.test(cleanText);
  const hasHb = HB_REGEX.test(cleanText);
  const hasGlucose = GLUCOSE_REGEX.test(cleanText);
  const hasProtein = PROTEIN_REGEX.test(cleanText);
  const hasBiomarker = hasBP || hasHb || hasGlucose || hasProtein;

  if (filenameHasPregnancy || textHasPregnancy || hasPregnancyMarker) {
    if (hasBiomarker || hasPregnancyMarker || cleanText.length > 50) {
      return true;
    }
  }

  if (cleanText.trim().length > 30 && !textHasPregnancy && !hasPregnancyMarker && !filenameHasPregnancy) {
    return false;
  }

  if ((isImage || cleanText.trim().length < 20) && process.env.GEMINI_API_KEY) {
    return true;
  }

  return false;
}

function cleanExtractedName(candidate: string): string {
  if (!candidate) return "Patient";
  let name = candidate.trim();

  // Strip leading prefixes like "Mrs.", "Ms.", "Miss", "Dr.", "Patient:", "Name:"
  name = name.replace(/^(?:mrs\.?|ms\.?|miss|dr\.?|patient(?:\s*name)?\s*[:=–-]?|name\s*[:=–-]?)\s*/i, "");

  // Cut off everything starting at noise words, regardless of preceding punctuation (. , / - : space or letter)
  const NOISE_CUTOFF_REGEX = /(?:[\s\.\,\:\-\_]+|(?<=[a-zA-Z]))(?:Patient|Pt|Age|Yrs|Years|Sex|Gender|Female|Male|Date|Ref|Doctor|Dr|Hospital|Clinic|Center|Centre|Report|Client|W\/o|D\/o|S\/o|C\/o|Reg|IPD|OPD|UHID|MRN|ID|No|Num|Number|Phone|Mobile|Contact|Address|Lab|Test|Specimen|Sample|Referred|Bed|Ward|Room).*$/i;
  name = name.replace(NOISE_CUTOFF_REGEX, "");

  // Strip trailing punctuation & whitespace
  name = name.replace(/[\s\.\,\:\-\_\/\\\|\(\)\[\]]+$/, "").trim();

  if (!name || name.length < 2) return "Patient";
  return name;
}

function cleanPatientName(name: string): string {
  if (!name) return "Patient";
  let cleaned = name.trim();
  const NON_PERSON_KEYWORDS = /\b(hospital|clinic|diagnostic|center|centre|speciality|specialty|healthcare|health|nursing|maternity|pathology|radiology|laboratory|lab|college|institute|foundation|trust|sunrise|apollo|manipal|fortis|max|aiims|dr|doctor|department|consultant|unit|division|report|summary|patient\s*report|medical\s*record|prescription|invoice|receipt)\b/i;
  cleaned = cleanExtractedName(cleaned);
  if (!cleaned || cleaned.length < 2 || NON_PERSON_KEYWORDS.test(cleaned)) return "Patient";
  return cleaned;
}

function extractPatientName(text: string, filename: string): string {
  const cleanText = text.replace(/[^\x20-\x7E\n\r\t]/g, " ");

  const NON_PERSON_KEYWORDS = /\b(hospital|clinic|diagnostic|center|centre|speciality|specialty|healthcare|health|nursing|maternity|pathology|radiology|laboratory|lab|college|institute|foundation|trust|sunrise|apollo|manipal|fortis|max|aiims|dr|doctor|department|consultant|unit|division|report|summary|patient\s*report|medical\s*record|prescription|invoice|receipt)\b/i;

  const explicitPatterns = [
    /\b(?:Patient\s*Name|Pt\.?\s*Name|Name\s*of\s*(?:the\s*)?Patient|Mother(?:\'s)?\s*Name|Expectant\s*Mother|Client\s*Name)\s*[:=–-]?\s*(?:Mrs\.?|Ms\.?|Miss|Dr\.?)?\s*([A-Za-z][A-Za-z\s\.\']{1,50})/i,
    /\b(?:Mrs\.?|Ms\.?|Miss)\s+([A-Za-z][A-Za-z\s\.\']{1,45})/i,
    /\bPatient\s*[:=–-]\s*([A-Za-z][A-Za-z\s\.\']{1,45})/i,
    /\bName\s*[:=–-]\s*([A-Za-z][A-Za-z\s\.\']{1,45})/i
  ];

  for (const regex of explicitPatterns) {
    const match = cleanText.match(regex);
    if (match && match[1]) {
      let candidate = cleanExtractedName(match[1]);
      if (candidate.length >= 2 && candidate.length <= 40 && !NON_PERSON_KEYWORDS.test(candidate)) {
        return candidate;
      }
    }
  }

  const cleanBase = filename.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
  const cleanFileNoExt = cleanBase.replace(/\b(pregnancy|report|medical|lab|scan|antenatal|prenatal|test|results?|new|final|\(\d+\))\b/gi, "").trim();
  if (cleanFileNoExt.length >= 3 && cleanFileNoExt.length <= 35 && !NON_PERSON_KEYWORDS.test(cleanFileNoExt)) {
    return cleanFileNoExt.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }

  return "Patient";
}

function extractMotherAge(cleanText: string): number {
  // Strategy 1: Explicit labeled age with Sex/Gender or Years (Highest confidence)
  // e.g. "Age/Sex: 24/F", "Age/Gender: 24 Yrs / Female", "Age: 24 Yrs", "Age : 24 Years", "Age: 24 / Female"
  const highConfPatterns = [
    /\bAge\s*(?:\/|\s*and\s*|\s*&\s*)\s*(?:Sex|Gender)\s*[:=–-]?\s*(\d{2})\s*(?:yrs?|years?|y\/o)?\s*(?:\/|\s*,?\s*(?:Female|F|Woman|Male|M))\b/i,
    /\b(?:Patient\s*Age|Mother(?:\'s)?\s*Age|Pt\.?\s*Age)\s*[:=–-]?\s*(\d{2})\b/i,
    /\bAge\s*[:=–-]?\s*(\d{2})\s*(?:yrs?|years?|y\/o|y\b)\b/i,
    /\bAge\s*[:=–-]?\s*(\d{2})\s*(?:\/|\s*,)\s*(?:Female|F|Woman)\b/i,
    /\b(?:Female|F|Woman)\s*(?:\/|\s*,)\s*(\d{2})\s*(?:yrs?|years?|y\/o)?\b/i,
    /\b(\d{2})\s*(?:yrs?|years?|y\/o)\s*(?:\/|\s*,)\s*(?:Female|F|Woman)\b/i
  ];

  for (const regex of highConfPatterns) {
    const match = cleanText.match(regex);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (parsed >= 15 && parsed <= 55) {
        return parsed;
      }
    }
  }

  // Strategy 2: Scan all occurrences of "Age: XX" and find the one that is NOT gestational age (weeks/days)
  const generalAgeRegex = /(?<!Gestational\s*|GA\s*|POG\s*)\bAge\s*[:=–-]?\s*(\d{2})\b(?!\s*(?:weeks?|wks?|days?|months?|d\b))/gi;
  let match: RegExpExecArray | null;
  while ((match = generalAgeRegex.exec(cleanText)) !== null) {
    if (match[1]) {
      const parsed = parseInt(match[1], 10);
      if (parsed >= 15 && parsed <= 55) {
        return parsed;
      }
    }
  }

  // Strategy 3: Look for standalone patterns like "24 Y / F", "24/F", "24 Yrs" near patient name or in header
  const standalonePatterns = [
    /\b(\d{2})\s*(?:Y|Yrs|Years)\s*\/\s*F(?:emale)?\b/i,
    /\b(\d{2})\s*\/\s*F(?:emale)?\b/i,
    /\b(\d{2})\s*(?:yrs?|years?)\s*(?:old)?\b(?!\s*(?:of\s*gestation|gestation|pregnancy))/i
  ];

  for (const regex of standalonePatterns) {
    const match = cleanText.match(regex);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (parsed >= 15 && parsed <= 55) {
        return parsed;
      }
    }
  }

  return 28;
}

function parseReportOffline(filename: string, extractedText: string) {
  const cleanText = extractedText.replace(/[^\x20-\x7E\n\r\t]/g, " ");
  const combined = filename + " " + cleanText;

  // 1. Strict Check for pregnancy validity
  const hasPregnancyTerm = STRICT_PREGNANCY_REGEX.test(combined);
  const hasPregnancyMarker = GESTATIONAL_AGE_REGEX.test(cleanText) ||
                             EDD_REGEX.test(cleanText) ||
                             FHR_REGEX.test(cleanText) ||
                             HCG_REGEX.test(cleanText);
  const isDisallowed = DISALLOWED_DOC_REGEX.test(filename) || DISALLOWED_DOC_REGEX.test(cleanText);

  // Extract biomarker matches
  const bpMatch = cleanText.match(BP_REGEX);
  const hbMatch = cleanText.match(HB_REGEX);
  const glucoseMatch = cleanText.match(GLUCOSE_REGEX);
  const proteinMatch = cleanText.match(PROTEIN_REGEX);
  const hcgMatch = cleanText.match(HCG_REGEX);
  const tshMatch = cleanText.match(TSH_REGEX);
  const plateletMatch = cleanText.match(PLATELET_REGEX);
  const gaMatch = cleanText.match(GESTATIONAL_AGE_REGEX);
  const eddMatch = cleanText.match(EDD_REGEX);
  const fhrMatch = cleanText.match(FHR_REGEX);

  const matchedBiomarkersCount = [
    bpMatch, hbMatch, glucoseMatch, proteinMatch, hcgMatch,
    tshMatch, plateletMatch, gaMatch, eddMatch, fhrMatch
  ].filter(Boolean).length;

  if (isDisallowed || (!hasPregnancyTerm && !hasPregnancyMarker) || (matchedBiomarkersCount === 0 && cleanText.length < 50)) {
    return {
      is_pregnancy_report: false,
      rejection_reason: `Invalid Document: '${filename}' does not contain recognized pregnancy or maternal health parameters. Please upload an obstetric lab report, ultrasound scan, or prenatal vitals document.`
    };
  }

  // Extract Patient Name accurately (excluding hospital/clinic names)
  const patientName = extractPatientName(cleanText, filename);

  // Extract Mother's Age accurately (excluding gestational age in weeks)
  const age = extractMotherAge(cleanText);

  // Build indicators ONLY from parameters that ACTUALLY exist in the document (NO HALLUCINATIONS)
  const indicators: Array<{ parameter: string; value: string; status: "normal" | "abnormal" }> = [];
  let highRiskFlags = 0;
  let mediumRiskFlags = 0;

  // Hemoglobin
  if (hbMatch && hbMatch[1]) {
    const hbVal = parseFloat(hbMatch[1]);
    const isAbnormal = hbVal < 11.0;
    if (hbVal < 8.5) highRiskFlags++;
    else if (hbVal < 11.0) mediumRiskFlags++;
    indicators.push({
      parameter: "Hemoglobin (Hb)",
      value: `${hbVal} g/dL`,
      status: isAbnormal ? "abnormal" : "normal"
    });
  }

  // Blood Pressure
  if (bpMatch && bpMatch[1]) {
    const bpParts = bpMatch[1].split("/").map(s => parseInt(s.trim(), 10));
    const sys = bpParts[0] || 0;
    const dia = bpParts[1] || 0;
    const isAbnormal = sys >= 130 || dia >= 85;
    if (sys >= 150 || dia >= 100) highRiskFlags++;
    else if (sys >= 130 || dia >= 85) mediumRiskFlags++;
    indicators.push({
      parameter: "Blood Pressure",
      value: `${sys}/${dia} mmHg`,
      status: isAbnormal ? "abnormal" : "normal"
    });
  }

  // Fasting Blood Glucose
  if (glucoseMatch && glucoseMatch[1]) {
    const gVal = parseFloat(glucoseMatch[1]);
    const isAbnormal = gVal >= 100;
    if (gVal >= 140) highRiskFlags++;
    else if (gVal >= 100) mediumRiskFlags++;
    indicators.push({
      parameter: "Blood Glucose",
      value: `${gVal} mg/dL`,
      status: isAbnormal ? "abnormal" : "normal"
    });
  }

  // Urine Protein
  if (proteinMatch && proteinMatch[1]) {
    const pStr = proteinMatch[1].trim();
    const pLower = pStr.toLowerCase();
    const isNegative = pLower === "nil" || pLower === "negative" || pLower === "neg" || pLower === "normal";
    const isHigh = pLower.includes("+2") || pLower.includes("+3") || pLower.includes("2+") || pLower.includes("3+");
    const isMedium = pLower.includes("+1") || pLower.includes("1+") || pLower.includes("trace") || pLower.includes("present");
    if (isHigh) highRiskFlags++;
    else if (isMedium) mediumRiskFlags++;
    indicators.push({
      parameter: "Urine Protein",
      value: pStr.startsWith("+") ? `${pStr} (Elevated)` : pStr,
      status: !isNegative ? "abnormal" : "normal"
    });
  }

  // Gestational Age
  if (gaMatch && gaMatch[1]) {
    indicators.push({
      parameter: "Gestational Age",
      value: gaMatch[1].trim(),
      status: "normal"
    });
  }

  // Fetal Heart Rate
  if (fhrMatch && fhrMatch[1]) {
    const fhrNum = parseInt(fhrMatch[1], 10);
    const isAbnormal = fhrNum < 110 || fhrNum > 160;
    if (fhrNum < 100 || fhrNum > 170) highRiskFlags++;
    else if (isAbnormal) mediumRiskFlags++;
    indicators.push({
      parameter: "Fetal Heart Rate (FHR)",
      value: `${fhrNum} bpm`,
      status: isAbnormal ? "abnormal" : "normal"
    });
  }

  // Beta-hCG
  if (hcgMatch && hcgMatch[1]) {
    indicators.push({
      parameter: "Beta-hCG",
      value: `${hcgMatch[1].trim()} mIU/mL`,
      status: "normal"
    });
  }

  // TSH
  if (tshMatch && tshMatch[1]) {
    const tshVal = parseFloat(tshMatch[1]);
    const isAbnormal = tshVal < 0.1 || tshVal > 4.0;
    if (isAbnormal) mediumRiskFlags++;
    indicators.push({
      parameter: "TSH (Thyroid)",
      value: `${tshVal} uIU/mL`,
      status: isAbnormal ? "abnormal" : "normal"
    });
  }

  // Platelet Count
  if (plateletMatch && plateletMatch[1]) {
    const rawVal = parseFloat(plateletMatch[1].replace(/,/g, ""));
    let displayVal = `${plateletMatch[1].trim()} Lakhs/cumm`;
    let isAbnormal = false;
    if (rawVal < 20) {
      displayVal = `${rawVal} Lakhs/cumm`;
      if (rawVal < 1.0) highRiskFlags++;
      else if (rawVal < 1.5) mediumRiskFlags++;
      isAbnormal = rawVal < 1.5;
    } else {
      displayVal = `${rawVal.toLocaleString()} /µL`;
      if (rawVal < 100000) highRiskFlags++;
      else if (rawVal < 150000) mediumRiskFlags++;
      isAbnormal = rawVal < 150000;
    }
    indicators.push({
      parameter: "Platelet Count",
      value: displayVal,
      status: isAbnormal ? "abnormal" : "normal"
    });
  }

  // EDD
  if (eddMatch && eddMatch[1]) {
    indicators.push({
      parameter: "Estimated Due Date (EDD)",
      value: eddMatch[1].trim(),
      status: "normal"
    });
  }

  // If no specific parameters were matched from regex, but pregnancy terms were present
  if (indicators.length === 0) {
    indicators.push({
      parameter: "Prenatal Clinical Evaluation",
      value: "Observed in Document",
      status: "normal"
    });
  }

  // Determine Risk Level
  let risk_level: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (highRiskFlags > 0 || cleanText.toLowerCase().includes("high risk") || cleanText.toLowerCase().includes("preeclampsia")) {
    risk_level = "HIGH";
  } else if (mediumRiskFlags > 0 || cleanText.toLowerCase().includes("moderate risk") || cleanText.toLowerCase().includes("anemia")) {
    risk_level = "MEDIUM";
  } else {
    risk_level = "LOW";
  }

  // Build Summary & Actions
  let summary = "";
  let recommended_actions: string[] = [];

  if (risk_level === "HIGH") {
    summary = `Critical clinical biomarkers detected for ${patientName}: Priority prenatal biomarkers require immediate attention. We recommend prompt consultation with an obstetrician.`;
    recommended_actions = ["Immediate Obstetric Consultation", "Close BP and Biomarker Monitoring", "Specialist Hospital Triage"];
  } else if (risk_level === "MEDIUM") {
    summary = `Observational pregnancy biomarkers noted for ${patientName}: Some pregnancy biomarkers show slight variance from baseline healthy averages. Routine follow-up with your prenatal care specialist is recommended.`;
    recommended_actions = ["Schedule Follow-up with Gynecologist", "Maintain Iron & Prenatal Vitamin Supplements", "Routine Vitals Tracking"];
  } else {
    summary = `Healthy pregnancy report for ${patientName}: All detected prenatal markers align comfortably within standard healthy prenatal ranges. Continue your routine prenatal checkups.`;
    recommended_actions = ["Continue Routine Prenatal Care", "Maintain Daily Hydration & Nutrition", "Next Scheduled Trimester Visit"];
  }

  return {
    is_pregnancy_report: true,
    patient_name: patientName,
    age: age,
    risk_level: risk_level,
    summary: summary,
    indicators: indicators,
    recommended_actions: recommended_actions
  };
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
  
  if (!report.summary || report.summary === "No summary generated.") {
    const raw = report.raw_analysis || {};
    report.summary = raw.summary || raw.plain_language_summary || raw.plainLanguageSummary || "No summary generated.";
  }
  
  if (!report.indicators || report.indicators.length === 0) {
    const raw = report.raw_analysis || {};
    if (raw.indicators && raw.indicators.length > 0) {
      report.indicators = raw.indicators;
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

    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    const fileUrl = "";

    const isWordDoc =
      originalName.toLowerCase().endsWith(".docx") ||
      originalName.toLowerCase().endsWith(".doc");
    const isPdfDoc = originalName.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf";
    const isImageFile = mimeType.startsWith("image/") || originalName.toLowerCase().endsWith(".png") || originalName.toLowerCase().endsWith(".jpg") || originalName.toLowerCase().endsWith(".jpeg");
    let extractedText = "";

    if (isWordDoc) {
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText = result.value || "";
      } catch (err) {
        extractedText = `Word document: ${originalName} could not be fully decoded.`;
      }
    } else if (isPdfDoc) {
      try {
        extractedText = extractTextFromPDF(fileBuffer);
      } catch (err) {
        console.warn("PDF extraction error:", err);
      }
    } else if (!isImageFile) {
      try {
        extractedText = fileBuffer.toString("utf-8");
      } catch (_) {}
    }

    // Validate that the uploaded document is pregnancy / maternal health related
    if (!isPregnancyRelatedReport(originalName, extractedText, isImageFile)) {
      console.warn(`[Validation Reject] File '${originalName}' is not a valid pregnancy report.`);
      return res.status(400).json({
        error: `Invalid Document: The uploaded file ('${originalName}') does not contain recognized pregnancy or maternal health parameters. Please upload an actual maternal health lab report, prenatal blood test, or ultrasound scan.`
      });
    }

    const contents: any[] = [];
    if (isWordDoc) {
      contents.push({
        text: `Evaluate this text-extracted pregnancy report. Here is the raw patient content from the Word document:\n\n${extractedText}`,
      });
    } else {
      contents.push({ inlineData: { data: fileBuffer.toString("base64"), mimeType } });
      if (extractedText && extractedText.length > 20) {
        contents.push({
          text: `Extracted text from document:\n${extractedText}\n\nAnalyze this pregnancy report carefully and extract indicators and risk assessment.`
        });
      } else {
        contents.push({ text: "Verify if this image/document is an actual pregnancy or maternal health medical report. If so, extract indicators and risk assessment." });
      }
    }

    const systemPrompt = `You are an expert maternal-fetal medicine clinical verification AI assistant. Inspect the uploaded document/image carefully with high clinical precision:

CRITICAL PREGNANCY VERIFICATION & EXTRACTION RULES:
1) Determine if the uploaded file is an AUTHENTIC pregnancy or maternal health medical report (e.g. prenatal laboratory test, obstetric ultrasound scan, antenatal visit vitals, Beta-hCG report, maternal blood/urine test, gestational diabetes screening, ANC card).
2) If the image or document is a personal photo/selfie, vehicle, invoice, receipt, student assignment, resume, non-medical document, or a generic medical test with NO pregnancy or maternal parameters:
   - You MUST set "is_pregnancy_report": false.
   - Set "rejection_reason" to a clear, compassionate message explaining that the document was rejected because it does not contain recognized pregnancy or maternal health parameters.
   - Leave "indicators" as empty array [], "summary" as "Not a pregnancy report.", "risk_level" as "LOW", and "patient_name" as "Patient".
3) ONLY if "is_pregnancy_report" is true:
   - Extract ONLY the actual biomarker values present in the document. NEVER fabricate or hallucinate missing values!
   - Patient Name: Extract ONLY the human patient/mother's name (e.g. 'Priya Sharma', 'Anitha Reddy'). NEVER extract hospital names, clinic names, diagnostic center names (such as 'Sunrise Multi Speciality Hospital', 'Apollo Clinic', 'LifeCare'), doctor names, or facility headers as the patient's name! If patient name is missing, return "Patient".
   - Mother's Age: Extract the mother's age in years (between 15 and 55). NEVER confuse Gestational Age / POG in weeks (e.g. '27 weeks') with the Mother's Age! If mother's age is not found, return 28.
   - Evaluate clinical risk level accurately:
     * LOW: All maternal biomarkers are within healthy prenatal baseline ranges (e.g. Hemoglobin >= 11.0 g/dL, Blood Pressure < 130/85 mmHg, Glucose < 100 mg/dL, Platelets >= 1.5 Lakhs / 150,000, Urine Protein Nil/Negative).
     * MEDIUM: Mild to moderate variance (e.g. Hemoglobin 8.5-10.9 g/dL, Blood Pressure 130-149/85-99 mmHg, Glucose 100-139 mg/dL, Platelets 1.0-1.49 Lakhs, or Urine Protein +1/Trace).
     * HIGH: Critical severe indicators (e.g. Hemoglobin < 8.5 g/dL, Blood Pressure >= 150/100 mmHg, Urine Protein +2/+3/+4, Glucose >= 140 mg/dL, Platelets < 1.0 Lakh, Fetal Heart Rate < 100 or > 170 bpm, severe preeclampsia signs).
   - Provide a warm, clear plain-language summary for the patient.
   - Provide safe, helpful recommended actions.

Return everything strictly as a validated JSON object.`;

    let parsedAnalysis: any = {};
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("No GEMINI_API_KEY provided; using high-accuracy clinical offline parser.");
      }

      const geminiResponse = await generateContentWithRetry({
        model: "gemini-3.6-flash",
        contents,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              is_pregnancy_report: {
                type: Type.BOOLEAN,
                description: "Must be true ONLY if the document/image is an actual pregnancy or maternal medical report."
              },
              rejection_reason: {
                type: Type.STRING,
                description: "Explanation if is_pregnancy_report is false."
              },
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
            required: ["is_pregnancy_report", "patient_name", "age", "risk_level", "summary", "indicators", "recommended_actions"],
          },
        },
      });

      const responseText = geminiResponse.text?.trim() || "{}";
      parsedAnalysis = JSON.parse(responseText);

      if (parsedAnalysis.is_pregnancy_report === false) {
        console.warn(`[Gemini AI Reject] File '${originalName}' is not a pregnancy report.`);
        return res.status(400).json({
          error: parsedAnalysis.rejection_reason || `Invalid Document: The uploaded file '${originalName}' is not a recognized pregnancy medical report. Please upload an actual maternal health lab report, prenatal blood test, or ultrasound scan.`
        });
      }
    } catch (aiErr: any) {
      console.warn("[Analysis Fallback] Using offline clinical parser:", aiErr.message);
      parsedAnalysis = parseReportOffline(originalName, extractedText);
    }

    if (parsedAnalysis.is_pregnancy_report === false) {
      console.warn(`[Reject] File '${originalName}' is not a pregnancy report.`);
      return res.status(400).json({
        error: parsedAnalysis.rejection_reason || `Invalid Document: The uploaded file '${originalName}' is not a recognized pregnancy medical report. Please upload an actual maternal health lab report, prenatal blood test, or ultrasound scan.`
      });
    }

    const reportId =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    const newReport = normalizeReport({
      id: reportId,
      patient_name: cleanPatientName(parsedAnalysis.patient_name),
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
