# 🌸 PreCare — Gentle Care, AI Precision

PreCare is an AI-powered secure pregnancy companion designed to scan pregnancy medical reports (PDFs, Word documents, images), translate complex lab biomarkers into patient-friendly plain language summaries, assess maternal health risk levels, and connect patients with the best gynecologists and maternity clinics nearby.

---

## 🌟 Key Features

### 1. 🔬 Multimodal Pregnancy Report Analyzer
* **File Compatibility:** Securely processes images (JPEG, PNG), PDF documents, and Microsoft Word files (`.doc`, `.docx`).
* **Mammoth Integration:** Extracts rich text from Word documents automatically before AI ingestion.
* **NVIDIA NIM API Pipeline:** Leverages state-of-the-art clinical models with dynamic fallbacks and retries:
  * **Multimodal (Vision):** `meta/llama-3.2-11b-vision-instruct`, `meta/llama-3.2-90b-vision-instruct`.
  * **Text-only:** `meta/llama-3.3-70b-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct`, `meta/llama-3.1-8b-instruct`.
* **Validated Structured Outputs:** Forces JSON schema outputs specifying:
  * Demographics (Patient Name, Age)
  * Extracted Bio-Markers with values, units, and status (*normal* vs. *abnormal*)
  * Risk Classification (`LOW`, `MEDIUM`, or `HIGH`)
  * Warm, plain-language patient summary
  * Actionable clinical recommendations

### 2. 🗺️ Location-Aware Doctor Directory & AI Recommendation
* **Proactive Geolocation:** Defaults search locations automatically using IP lookup (`ipapi.co`) or precise browser GPS coords.
* **Google Maps Places integration:** Searches for nearby maternity clinics, gynecologists, and obstetrics specialists using Google Geocoding & Places Nearby API, falling back to OpenStreetMap (`Nominatim`) if Google services are configured differently.
* **AI-Ranked Recommendations:** If a patient is flagged as `HIGH` or `MEDIUM` risk, the system utilizes LLMs to evaluate the top nearby options (prioritizing major maternity hospitals, ratings, and specialities) and outputs a personalized recommendation reason.
* **Instant Priority Booking:** Allows patients to request priority checkup appointments directly.

### 3. 🔐 Secure Database & Hybrid Cache
* **Supabase Integration:** Real-time database insertion storing report ID, patient metrics, locations, and raw AI responses.
* **Vercel Serverless Ready:** Uses custom in-memory caches and automatic local file fallbacks to handle read-only environments (avoiding database timeouts or write blockages).
* **Security Alerts:** Notifies users on registration or sign-in through transactional email services powered by **Resend**.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, Vite 6, TailwindCSS v4, TypeScript, Lucide Icons, Framer Motion |
| **Backend** | Node.js Express Server, tsx execution engine, Vercel Serverless Functions |
| **Database & Storage** | Supabase PostgreSQL, Supabase Storage Buckets, Local JSON file backups |
| **AI Processing** | NVIDIA NIM API (Llama models), Google Gen AI SDK |
| **Integrations** | Google Maps Places & Geocoding APIs, Resend (Transactional Email), OpenStreetMap Nominatim, Mammoth |

---

## ⚙️ Configuration & Setup

### 1. Prerequisites
Ensure you have **Node.js** (v18+) installed on your machine.

### 2. Environment Variables (`.env`)
Create a `.env` file in the root directory. You can copy the structure from `.env.example`:

```env
# AI Studio & API Access
GEMINI_API_KEY=your_gemini_api_key_here
NVIDIA_API_KEY=your_nvidia_api_key_here

# Location & Mapping Services
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# Email Delivery
RESEND_API_KEY=your_resend_api_key_here

# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Application Context
APP_URL=http://localhost:3000
```

> [!NOTE]
> * `SUPABASE_SERVICE_ROLE_KEY` is highly recommended for backend database insertions to bypass RLS restrictions if they are enabled.
> * If `GOOGLE_MAPS_API_KEY` is omitted, the app automatically degrades gracefully to OpenStreetMap's free lookup APIs and curated mock regional lists.

---

## 🚀 Running the Application

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Database & Storage (Supabase)
Run the automated setup script to automatically construct the `pregnancy-reports` bucket and the database tables:
```bash
node setup-supabase.cjs
```

> [!TIP]
> If the setup RPC is disabled on your Supabase instance, you can paste the following SQL directly into the Supabase SQL editor:
> ```sql
> CREATE TABLE IF NOT EXISTS reports (
>   id TEXT PRIMARY KEY,
>   patient_name TEXT NOT NULL DEFAULT 'Patient',
>   age INTEGER NOT NULL DEFAULT 28,
>   location TEXT NOT NULL DEFAULT '',
>   risk_level TEXT NOT NULL DEFAULT 'LOW',
>   summary TEXT,
>   indicators JSONB DEFAULT '[]'::jsonb,
>   raw_analysis JSONB DEFAULT '{}'::jsonb,
>   file_url TEXT,
>   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
> );
> 
> -- Enable RLS
> ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
> CREATE POLICY "Allow all" ON reports FOR ALL USING (true) WITH CHECK (true);
> ```

### 3. Start Development Server
```bash
npm run dev
```
This script fires up the unified backend Express app (configured in `server.ts`) at `http://localhost:3000`. The server proxies frontend assets in dev mode and supports file uploads, analysis, and doctor mapping route requests.

### 4. Build for Production
```bash
npm run build
```
Generates statically compiled assets in `dist/` and server-side assets. Run the production node distribution with `npm run start`.

---

## 📂 Project Structure

```
├── api/                   # Serverless routes for Vercel deployment
│   ├── auth/              # Security email notification routes
│   ├── reports/           # Report retrieval and metadata routes
│   ├── analyze.ts         # Report processing & LLM query endpoint
│   └── doctors.ts         # Google Places clinic routing and AI ranking
├── src/                   # React Frontend App
│   ├── assets/            # Static assets and illustration watermarks
│   ├── components/        # Reusable UI widgets (FileUpload, DoctorsList, etc.)
│   ├── App.tsx            # Primary client router and view layouts
│   ├── main.tsx           # React bootstrap entry point
│   ├── index.css          # Custom styling using Tailwind v4 directives
│   └── types/             # Common TypeScript declarations
├── server.ts              # Express dev & production server
├── vercel.json            # Vercel routing configurations
├── setup-supabase.cjs     # CLI automated DB initializer
└── tsconfig.json          # TypeScript compilation settings
```

---

## 📄 License
This project is private and confidential. Built as a secure, HIPAA-compliant patient-first solution.
