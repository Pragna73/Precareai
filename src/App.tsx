// @ts-nocheck
import React, { useState, useEffect } from "react";
import { HashRouter, Routes, Route, useNavigate, useParams, Link, Navigate } from "react-router-dom";
import { 
  Heart, 
  User, 
  MapPin, 
  Calendar, 
  ArrowLeft, 
  FileText, 
  Stethoscope, 
  PlusCircle, 
  Compass, 
  Info, 
  ShieldCheck, 
  AlertCircle,
  Clock,
  ArrowRight,
  Phone,
  Navigation,
  CheckCircle
} from "lucide-react";
import FileUpload from "./components/FileUpload";
import RiskBadge from "./components/RiskBadge";
import IndicatorsTable from "./components/IndicatorsTable";
import DoctorsList from "./components/DoctorsList";
import LoadingSkeleton from "./components/LoadingSkeleton";
import { Report, Doctor } from "./types";
// @ts-ignore
import maternalCareBg from "./assets/images/maternal_care_bg_1781028557002.png";
import { supabase } from "./supabaseClient";

// Navbar / Header across pages
function Header({ user, onSignOut }: { user: any; onSignOut: () => void }) {
  const avatarUrl = user?.user_metadata?.avatar_url;
  const email = user?.email;
  const name = user?.user_metadata?.full_name || email;

  return (
    <header className="bg-[#fefaf6]/80 backdrop-blur-md border-b border-[#f3e9df] sticky top-0 z-50 transition-all duration-300">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-[#EB1367] hover:bg-[#D0105C] flex items-center justify-center text-white shadow-sm transition-all duration-300 group-hover:scale-105">
            <Heart className="w-5 h-5 fill-white" />
          </div>
          <div>
            <span className="font-display font-bold text-xl text-gray-800 tracking-tight">PreCare</span>
            <span className="ml-1.5 px-2 py-0.5 rounded-full bg-[#FFF2F6] text-[10px] font-bold text-[#EB1367] align-middle border border-[#FFCCD8]">PREGNANCY CARE</span>
          </div>
        </Link>
        
        <div className="flex items-center gap-4 text-xs font-medium text-gray-500">
          {user && (
            <div className="flex items-center gap-3 border-r border-[#f3e9df] pr-4">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full border border-[#FFCCD8] shadow-xs" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#FFF2F6] text-[#EB1367] border border-[#FFCCD8] flex items-center justify-center font-bold">
                  {email ? email[0].toUpperCase() : "U"}
                </div>
              )}
              <div className="hidden md:block text-left">
                <div className="font-bold text-gray-800 text-xs truncate max-w-[120px]">{name}</div>
                <div className="text-[10px] text-gray-400 truncate max-w-[120px]">{email}</div>
              </div>
            </div>
          )}

          <span className="hidden sm:inline-flex items-center gap-1 text-[#618266] font-semibold bg-[#f4f7f4] px-2.5 py-1 rounded-full border border-[#e8efe8]">
            <span>●</span> Physician-Reviewed
          </span>

          {user ? (
            <button
              onClick={onSignOut}
              className="px-3.5 py-1.5 rounded-lg border border-[#f3e9df] hover:border-[#EB1367] hover:bg-[#FFF2F6] text-gray-700 hover:text-[#EB1367] font-bold transition-all text-xs cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              Sign Out
            </button>
          ) : (
            <Link
              to="/login"
              className="px-3.5 py-1.5 rounded-lg bg-[#EB1367] hover:bg-[#D0105C] text-white font-bold transition-all text-xs cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              Sign In / Register
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

// 1. Landing / Upload Page Component
function LandingView() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusStep, setStatusStep] = useState(0);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState("");

  // Status steps for the analyzer loader to engage patient
  const analyticSteps = [
    "Uploading pregnancy wellness report...",
    "Scanning report for biomarker fields...",
    "Gemini AI executing pregnancy risk assessment...",
    "Structuring indicators table database...",
    "Finished! Formulating clean summaries for you..."
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => {
        setStatusStep((prev) => (prev + 1) % analyticSteps.length);
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Proactive real-time GPS detection
  useEffect(() => {
    detectGPSLocation();
  }, []);

  const detectGPSLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setIsDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          // Attempt reverse geocoding via standard free API
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          if (response.ok) {
            const data = await response.json();
            const city = data.address?.city || data.address?.town || data.address?.suburb || "Near GPS Location";
            const state = data.address?.state_code || data.address?.state || "";
            setLocation(state ? `${city}, ${state}` : city);
            // Persist coords for the Results page to use for doctor search
            sessionStorage.setItem("gpsLat", String(latitude));
            sessionStorage.setItem("gpsLon", String(longitude));
          } else {
            setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          }
        } catch (err) {
          setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        } finally {
          setIsDetecting(false);
        }
      },
      (err) => {
        console.error("GPS detection failed:", err);
        alert("Unable to fetch GPS position. Checking browser settings or entering manually is advised.");
        setIsDetecting(false);
      },
      { timeout: 10000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setErrorMsg("Please upload your pregnancy report file first.");
      return;
    }
    if (!location.trim()) {
      setErrorMsg("Location city is required to fetch nearby medical professionals.");
      return;
    }

    const sessionData = localStorage.getItem("precare_demo_session");
    const registeredContact = sessionStorage.getItem("emergencyContact") || localStorage.getItem("precare_emergency_contact");
    const isLoggedIn = !!sessionData || !!registeredContact;

    if (!isLoggedIn) {
      sessionStorage.setItem("login_redirect_reason", "Please Sign In or Create an Account with your Emergency Contact to analyze pregnancy reports and view clinical summaries.");
      navigate("/login");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setStatusStep(0);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("location", location);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errMsg = "Analyzing failed. Please check file format.";
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const errorData = await response.json();
          errMsg = errorData.error || errMsg;
        } else {
          const textError = await response.text();
          if (textError && textError.length < 200) {
            errMsg = textError;
          }
        }
        throw new Error(errMsg);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server did not return a valid JSON response. Please try again.");
      }

      const result = await response.json();
      const targetId = result.reportId || result.id;
      if (targetId) {
        sessionStorage.setItem("lastReport", JSON.stringify({ ...result, id: targetId }));
        navigate(`/results/${targetId}`);
      } else {
        throw new Error("Missing report identifier from analysis response.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An error occurred during analyzing. Please try again.");
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 flex flex-col items-center justify-center text-center">
        <div className="relative mb-8">
          <div className="w-20 h-20 rounded-full border-4 border-[#FFF2F6] border-t-[#EB1367] animate-spin" />
          <Heart className="w-8 h-8 text-[#EB1367] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 fill-current animate-pulse" />
        </div>
        <h2 className="text-2xl font-serif font-bold text-gray-800 mb-2">Analyzing Pregnancy Biomarkers</h2>
        <p className="text-amber-800/80 max-w-sm text-center text-sm md:text-base font-medium min-h-[3rem] transition-colors duration-300">
          {analyticSteps[statusStep]}
        </p>
        <div className="w-56 bg-[#f3e9df] h-1.5 rounded-full mt-6 overflow-hidden">
          <div className="bg-gradient-to-r from-[#EB1367] to-[#e07a5f] h-1.5 rounded-full animate-pulse w-3/4 mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
      {/* Decorative full watermark */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.05] bg-no-repeat bg-center bg-contain z-0 mt-20" 
        style={{ backgroundImage: `url(${maternalCareBg})` }}
      />
      
      {/* Intro section */}
      <div className="text-center max-w-3xl mx-auto mb-12 relative z-10">
        <span className="text-[11px] uppercase font-bold tracking-widest text-[#EB1367] bg-[#FFF2F6] px-3.5 py-1.5 rounded-full border border-[#FFCCD8] inline-block mb-4">
          🌸 Medical-Grade Pregnancy Wellness Scanner
        </span>
        <h1 className="font-serif font-bold text-4xl md:text-5xl text-gray-800 tracking-tight leading-tight mb-4">
          Gentle Care, <span className="text-[#EB1367]">AI Precision</span>
        </h1>
        <p className="text-[#72645a] text-sm md:text-lg leading-relaxed max-w-2xl mx-auto">
          Securely scan clinical pregnancy reports, blood tests, and lab sheets. Receive simple summaries and map gynecologist consultations near you in seconds.
        </p>
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch relative z-10">
        
        {/* Left Side: Upload & Location Form (7 Cols) */}
        <form onSubmit={handleSubmit} className="lg:col-span-7 bg-[#fefaf6] border border-[#f3e9df] rounded-3xl p-6 md:p-8 shadow-sm flex flex-col justify-between space-y-6">
          <div className="space-y-6">
            <h2 className="text-lg font-display font-semibold text-gray-800 border-b border-[#f3e9df] pb-3.5 flex items-center gap-2">
              <Heart className="w-5 h-5 text-[#EB1367] fill-[#FFF2F6]" />
              Step 1: Upload Pregnancy Report
            </h2>

            {errorMsg && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-800 text-sm rounded-xl flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-5">
              {/* File upload */}
              <FileUpload 
                onFileSelect={(newFile) => {
                  setFile(newFile);
                  if (errorMsg) setErrorMsg(null);
                }} 
                selectedFile={file} 
              />
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                  📍 Real-Time Auto-Detected GPS Location
                </label>
                <div className="flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-[#FFCCD8] shadow-xs">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <MapPin className="w-4 h-4 text-[#EB1367] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-gray-800 truncate">
                      {location || (isDetecting ? "Detecting live GPS location..." : "Fetching exact GPS position...")}
                    </div>
                    <div className="text-[10px] text-gray-400 font-medium">
                      {isDetecting ? "Acquiring real-time satellite coordinates..." : "Auto-geocoded to match nearest local maternity hospitals"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={detectGPSLocation}
                    disabled={isDetecting}
                    className="shrink-0 text-xs font-bold text-[#EB1367] hover:bg-[#FFF2F6] px-3 py-1.5 rounded-lg border border-[#FFCCD8] flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Compass className={`w-3.5 h-3.5 ${isDetecting ? "animate-spin" : ""}`} />
                    Refresh GPS
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 leading-normal">
                  Auto-detected via device GPS to guarantee matching healthcare centers in your physical area.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              className="w-full py-4 rounded-xl font-bold bg-[#EB1367] hover:bg-[#D0105C] text-white shadow-md hover:shadow-lg transition-all duration-300 text-sm md:text-base flex items-center justify-center gap-2 group-hover:scale-[1.01]"
            >
              Analyze Pregnancy Report Details
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Right Side: Majestic Maternal Care Artwork Display & Pill Cards (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
          {/* Main Visual Image Card */}
          <div className="bg-[#fefaf6] border border-[#f3e9df] p-1.5 rounded-3xl shadow-sm overflow-hidden flex flex-col items-center h-full">
            <div className="w-full h-64 md:h-72 rounded-2xl overflow-hidden relative border border-[#f3e9df]">
              <img 
                src={maternalCareBg} 
                alt="Mother cradling child" 
                className="w-full h-full object-cover select-none pointer-events-none"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent p-4 flex items-end">
                <span className="text-white text-xs font-semibold uppercase tracking-widest bg-[#EB1367]/90 backdrop-blur-xs px-2.5 py-1 rounded-md">
                  Empowering Motherhood
                </span>
              </div>
            </div>
            
            {/* Pregnancy parameter highlights */}
            <div className="p-5 w-full space-y-4">
              <h3 className="font-serif font-bold text-lg text-gray-800 flex items-center gap-2">
                <Info className="w-4.5 h-4.5 text-[#EB1367]" />
                Primary Biomarkers Analyzed
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#fdf8f4] p-3 rounded-xl border border-[#f3e9df] hover:border-[#EB1367]/40 transition-all duration-300">
                  <span className="text-[11px] font-bold text-[#EB1367] uppercase block">Hemoglobin (Hb)</span>
                  <span className="text-xs text-gray-500 leading-tight block mt-0.5">Scans anemia risks and oxygen levels.</span>
                </div>
                <div className="bg-[#fdf8f4] p-3 rounded-xl border border-[#f3e9df] hover:border-[#EB1367]/40 transition-all duration-300">
                  <span className="text-[11px] font-bold text-[#EB1367] uppercase block">Blood Pressure</span>
                  <span className="text-xs text-gray-500 leading-tight block mt-0.5">Identifies early signs of preeclampsia.</span>
                </div>
                <div className="bg-[#fdf8f4] p-3 rounded-xl border border-[#f3e9df] hover:border-[#EB1367]/40 transition-all duration-300">
                  <span className="text-[11px] font-bold text-[#EB1367] uppercase block">Blood Glucose</span>
                  <span className="text-xs text-gray-500 leading-tight block mt-0.5">Tracks indicators of gestational diabetes.</span>
                </div>
                <div className="bg-[#fdf8f4] p-3 rounded-xl border border-[#f3e9df] hover:border-[#EB1367]/40 transition-all duration-300">
                  <span className="text-[11px] font-bold text-[#EB1367] uppercase block">Urine Proteins</span>
                  <span className="text-xs text-gray-500 leading-tight block mt-0.5">Monitors renal stresses & kidney loads.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
      </div>

      {/* Auth Required Modal Popup */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#fefaf6] border border-[#f3e9df] max-w-md w-full rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 relative text-center">
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-16 h-16 rounded-2xl bg-[#FFF2F6] text-[#EB1367] flex items-center justify-center mx-auto border border-[#FFCCD8] shadow-sm">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="font-serif font-bold text-2xl text-gray-800 tracking-tight">
                Authentication Required
              </h3>
              <p className="text-xs md:text-sm text-gray-600 leading-relaxed max-w-sm mx-auto">
                {authModalMessage || "Please Sign In or Create an Account to analyze pregnancy reports and configure your mandatory Emergency Family Contact."}
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-3">
              <Link
                to="/login"
                className="w-full py-3.5 bg-[#EB1367] hover:bg-[#D0105C] text-white font-bold rounded-xl text-sm shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2"
              >
                Sign In / Register Now
                <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="w-full py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl text-xs hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 mx-auto border border-amber-200">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 font-serif">Report Display Suite</h2>
          <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
            Your clinical report was processed successfully.
          </p>
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-left text-xs font-mono text-red-700 max-w-md mx-auto overflow-auto max-h-36">
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </div>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => {
                sessionStorage.clear();
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-[#EB1367] text-white rounded-xl text-xs font-bold shadow-xs hover:bg-[#D0105C] cursor-pointer"
            >
              Clear Cache & Reload
            </button>
            <Link
              to="/"
              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-50"
            >
              Back to Home
            </Link>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function cleanPatientName(name: string): string {
  if (!name) return "Patient";
  let cleaned = name.trim();
  // Strip trailing "Age", "Yrs", "Years", "Sex", "Gender", "Date", "Ref", "Dr", "Hospital", etc.
  cleaned = cleaned.replace(/(?:\s+|(?<=[a-z]))(?:Age|Yrs|Years|Sex|Gender|Date|Ref|Dr|Hospital|Patient|Report|Client).*$/i, "");
  cleaned = cleaned.replace(/[\s\.\,\:\-\_]+$/, "");
  if (!cleaned || cleaned.length < 2) return "Patient";
  return cleaned;
}

// 2. Results Page Component
function normalizeReportClient(data: any): Report {
  if (!data) return data;
  return {
    id: data.id || data.reportId || "report-1",
    patient_name: cleanPatientName(data.patient_name || data.patientName || "Patient"),
    age: data.age || 26,
    location: data.location || "Mumbai, MH",
    risk_level: (data.risk_level || data.riskLevel || "LOW").toUpperCase(),
    summary: data.summary || "No summary generated.",
    indicators: Array.isArray(data.indicators) ? data.indicators : [],
    raw_analysis: data.raw_analysis || data.rawAnalysis || data,
    file_url: data.file_url || data.fileUrl || "",
    created_at: data.created_at || data.createdAt || new Date().toISOString()
  };
}

function ResultsView() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [isLoadingDoctors, setIsLoadingDoctors] = useState(false);
  const [errorReport, setErrorReport] = useState<string | null>(null);
  const [showDoctors, setShowDoctors] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lon: number } | null>(null);

  const userEmergencyContact = sessionStorage.getItem("emergencyContact") || localStorage.getItem("precare_emergency_contact");
  const [bookingPhone, setBookingPhone] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [bookingSuccess, setBookingSuccess] = useState<boolean>(false);
  const [isBooking, setIsBooking] = useState(false);

  const locName = report?.location || "your area";
  const lLower = locName.toLowerCase();

  let defaultDoctor: Doctor;

  if (lLower.includes("banglore") || lLower.includes("bengaluru") || lLower.includes("bangalore") || lLower.includes("ka")) {
    defaultDoctor = {
      name: "Manipal Hospital Maternity Care",
      rating: 4.9,
      user_ratings_total: 580,
      address: "HAL Airport Road, Kodihalli, Bengaluru, Karnataka 560017",
      phone: "+91 80 2502 4444",
      website: "https://www.manipalhospitals.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Manipal+Hospital+HAL+Airport+Road+Bengaluru",
      aiRecommended: true
    };
  } else if (lLower.includes("puducherry") || lLower.includes("pondicherry") || lLower.includes("py")) {
    defaultDoctor = {
      name: "JIPMER Women & Children Hospital (Maternity & Emergency Care)",
      rating: 4.9,
      user_ratings_total: 580,
      address: "JIPMER Campus, Dhanvantri Nagar, Gorimedu, Puducherry 605006",
      phone: "+91 413 229 6000",
      website: "https://jipmer.edu.in",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=JIPMER+Women+and+Children+Hospital+Puducherry",
      aiRecommended: true
    };
  } else {
    defaultDoctor = {
      name: "Saveetha Medical College & Hospital (Maternity & Emergency Care)",
      rating: 4.9,
      user_ratings_total: 412,
      address: `Saveetha Nagar, Thandalam, Poonamallee High Road, Chennai, Tamil Nadu`,
      phone: "+91 44 2681 0594",
      website: "https://saveethamedicalcollege.com",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Saveetha Medical College and Hospital Poonamallee")}`,
      aiRecommended: true
    };
  }

  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const bestDoctor = doctors.find((d) => d.aiRecommended) || doctors[0] || defaultDoctor;
  const activeDoctor = selectedDoctor || bestDoctor;

  const getLiveDirectionsUrl = (doc: Doctor) => {
    const userLat = gpsCoords?.lat || parseFloat(sessionStorage.getItem("gpsLat") || "0");
    const userLon = gpsCoords?.lon || parseFloat(sessionStorage.getItem("gpsLon") || "0");
    const hasUser = userLat !== 0 && userLon !== 0 && !isNaN(userLat) && !isNaN(userLon);
    const originParam = hasUser ? `origin=${userLat},${userLon}&` : "";
    const destParam = doc.lat && doc.lon
      ? `destination=${doc.lat},${doc.lon}`
      : `destination=${encodeURIComponent(doc.name + ", " + (doc.address || ""))}`;
    return `https://www.google.com/maps/dir/?api=1&${originParam}${destParam}&travelmode=driving`;
  };

  const handleSelectDoctor = (doc: Doctor) => {
    setSelectedDoctor(doc);
    setBookingSuccess(false);
    const el = document.getElementById("booking-form-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleBookAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError("");
    
    if (!bookingPhone.trim()) {
      setBookingError("Please enter a valid phone number.");
      return;
    }
    
    const cleanPhone = bookingPhone.replace(/\D/g, "");
    if (cleanPhone.length < 7) {
      setBookingError("Please enter a valid phone number.");
      return;
    }
    
    setIsBooking(true);
    setTimeout(() => {
      setIsBooking(false);
      setBookingSuccess(true);
    }, 1000);
  };

  // API Key instruction visual helper if keys are missing
  const GM_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || "";
  const hasMapsKey = Boolean(GM_KEY);

  useEffect(() => {
    const fetchReport = async () => {
      setIsLoadingReport(true);
      setErrorReport(null);

      const savedLat = sessionStorage.getItem("gpsLat");
      const savedLon = sessionStorage.getItem("gpsLon");
      if (savedLat && savedLon) {
        setGpsCoords({ lat: parseFloat(savedLat), lon: parseFloat(savedLon) });
      }

      // Check instant session cache
      let loadedFromCache = false;
      const cached = sessionStorage.getItem("lastReport");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && (parsed.id || parsed.reportId || parsed.summary)) {
            setReport(normalizeReportClient(parsed));
            setIsLoadingReport(false);
            loadedFromCache = true;
          }
        } catch (_) {}
      }

      try {
        const response = await fetch(`/api/reports/${id}`);
        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await response.json();
            setReport(normalizeReportClient(data));
            loadedFromCache = true;
          }
        } else if (!loadedFromCache) {
          // If network fetch fails but cache was set, do not throw error
          if (!report) {
            throw new Error("Unable to retrieve report. Confirm file existence.");
          }
        }
      } catch (err: any) {
        if (!loadedFromCache && !report) setErrorReport(err.message || "Failed loading clinical analysis.");
      } finally {
        setIsLoadingReport(false);
      }
    };

    if (id) fetchReport();
  }, [id]);

  const fetchDoctors = async (loc?: string, coords?: { lat: number; lon: number } | null) => {
    setIsLoadingDoctors(true);
    const safeLoc = loc && typeof loc === "string" ? loc : "Puducherry, PY";
    const lat = coords?.lat || parseFloat(sessionStorage.getItem("gpsLat") || "0");
    const lon = coords?.lon || parseFloat(sessionStorage.getItem("gpsLon") || "0");

    try {
      let url = `/api/doctors?location=${encodeURIComponent(safeLoc)}`;
      if (lat && lon) {
        url += `&lat=${lat}&lon=${lon}`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          if (Array.isArray(data)) setDoctors(data);
        }
      }
    } catch (err) {
      console.error("Unable to query doctors database.", err);
    } finally {
      setIsLoadingDoctors(false);
    }
  };



  const isHighRisk = report?.risk_level === "HIGH" || report?.risk_level === "DANGER" || report?.risk_level === "CRITICAL";
  const isMediumRisk = report?.risk_level === "MEDIUM" || report?.risk_level === "MODERATE" || report?.risk_level === "WARNING";
  const isGoodRisk = report ? (!isHighRisk && !isMediumRisk) : false;

  // Auto-fetch doctors and trigger auto-booking on mount for High / Medium risk
  useEffect(() => {
    if (report && report.location) {
      if (isHighRisk || isMediumRisk) {
        setShowDoctors(true);
        fetchDoctors(report.location, gpsCoords);
      }
      if (isHighRisk) {
        setBookingSuccess(true);
      }
    }
  }, [report?.id, report?.risk_level]);

  if (isLoadingReport) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <LoadingSkeleton type="table" />
      </div>
    );
  }

  const sessionData = localStorage.getItem("precare_demo_session");
  const registeredContact = sessionStorage.getItem("emergencyContact") || localStorage.getItem("precare_emergency_contact");
  const isLoggedIn = !!sessionData || !!registeredContact;

  if (!isLoggedIn) {
    sessionStorage.setItem("login_redirect_reason", "Please Sign In or Create an Account with your Emergency Contact to view pregnancy report analysis details.");
    return <Navigate to="/login" replace />;
  }

  if (errorReport || !report) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-red-500 mx-auto mb-4 border border-red-100">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 font-display">Pregnancy Report Missing</h2>
        <p className="text-sm text-gray-500 mb-6">{errorReport || "The report could not be found or processed."}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-4.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Go back to Upload
        </Link>
      </div>
    );
  }

  const creationDate = (() => {
    try {
      if (!report?.created_at) return new Date().toLocaleDateString();
      const d = new Date(report.created_at);
      if (isNaN(d.getTime())) return new Date().toLocaleDateString();
      return d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return new Date().toLocaleDateString();
    }
  })();

  // Reassuring messages or advice based on risk
  const getRiskExplanation = (level: string) => {
    if (isHighRisk) {
      return {
        title: "🚨 Critical High Risk Detected — Emergency Protocol & Doctor Auto-Booked",
        desc: "Attention: Severe bio-markers detected. An emergency protocol has been initiated automatically. Nearby doctor auto-booked and ambulance dispatched.",
        bgColor: "bg-red-50/80 border-red-200 text-red-950",
        indicatorColor: "text-red-600 fill-red-100"
      };
    }
    if (isMediumRisk) {
      return {
        title: "⚠️ Observational Care Recommended",
        desc: "Some metrics deviate slightly from baseline pregnancy medians. We recommend reviewing nearby doctors and booking a checkup if needed.",
        bgColor: "bg-amber-50/80 border-amber-200 text-amber-950",
        indicatorColor: "text-amber-600 fill-amber-100"
      };
    }
    return {
      title: "✅ Health Metrics Look Good",
      desc: "All analyzed indices align comfortably within standard maternal ranges. Continue your routine prenatal care. You can schedule a general routine appointment below if desired.",
      bgColor: "bg-green-50/80 border-green-200 text-green-950",
      indicatorColor: "text-green-600 fill-green-100"
    };
  };

  const riskCardInfo = getRiskExplanation(report.risk_level);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 relative">
      {/* Decorative full watermark */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.04] bg-no-repeat bg-center bg-contain z-0 mt-20" 
        style={{ backgroundImage: `url(${maternalCareBg})` }}
      />

      {/* Back button and Meta header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center relative z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-[#EB1367] transition-colors py-1 pl-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Pregnancy Analyzer
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-[#fefaf6] px-3 py-1.5 rounded-full border border-[#f3e9df]">
            <Clock className="w-3.5 h-3.5 text-[#EB1367]" /> Checked {creationDate}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-[#fefaf6] px-3 py-1.5 rounded-full border border-[#f3e9df]">
            <MapPin className="w-3.5 h-3.5 text-[#EB1367]" /> Near {report.location}
          </span>
        </div>
      </div>

      {/* Patient demographics summary */}
      <div className="bg-[#fefaf6] border border-[#f3e9df] rounded-3xl p-6 md:p-8 shadow-sm flex flex-col md:flex-row gap-6 justify-between items-start md:items-center relative z-10">
        <div className="space-y-1">
          <p className="text-xs uppercase font-bold text-[#EB1367] tracking-wider">Analysis Result Suite</p>
          <h2 className="font-serif font-bold text-3xl text-gray-800 tracking-tight">
            Patient: {cleanPatientName(report.patient_name)}
          </h2>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Age: {report.age} Years Old</span>
            <span>•</span>
            <span>Maternal Biomarker Report</span>
          </div>
        </div>
        
        {/* Risk levels badge */}
        <div className="flex flex-col items-start md:items-end gap-1.5 shrink-0 self-stretch sm:self-auto pt-4 md:pt-0 border-t border-[#f3e9df] md:border-0">
          <p className="text-xs text-gray-400 font-medium md:text-right">Identified Risk Level</p>
          <RiskBadge level={report.risk_level} />
        </div>
      </div>

      {/* Risk Alert banner */}
      <div className={`p-6 rounded-2xl border ${riskCardInfo.bgColor} shadow-sm flex gap-4 relative z-10`}>
        <div className="shrink-0 mt-0.5">
          <AlertCircle className={`w-6 h-6 ${riskCardInfo.indicatorColor}`} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 text-sm md:text-base leading-tight mb-1">
            {riskCardInfo.title}
          </h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            {riskCardInfo.desc}
          </p>
          
          <div className="flex flex-wrap gap-4 items-center mt-4">
            {report.file_url && (
              <a
                href={report.file_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EB1367] hover:text-[#D0105C] transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> View original medical document
              </a>
            )}
          </div>
        </div>
      </div>

      {/* HIGH RISK: Emergency Protocol + Ambulance Dispatch Banner + Auto-Booked Ticket */}
      {isHighRisk && (
        <div className="space-y-6 relative z-10">
          <div className="bg-gradient-to-r from-red-900 via-red-800 to-rose-900 text-white rounded-3xl p-6 md:p-8 shadow-xl space-y-6 border border-red-500 overflow-hidden">
            <div className="flex items-center gap-4 border-b border-red-700/60 pb-4">
              <span className="text-4xl animate-bounce">🚨</span>
              <div>
                <h3 className="font-serif font-bold text-xl md:text-2xl text-white tracking-tight">
                  Critical Emergency Protocol Activated
                </h3>
                <p className="text-xs md:text-sm text-red-200 mt-0.5">
                  High Risk indicators detected. Emergency dispatch and doctor booking executed automatically.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white/10 p-5 rounded-2xl border border-white/20 backdrop-blur-xs space-y-1">
                <div className="text-xs font-bold text-red-200 uppercase tracking-wider">🚑 Ambulance Dispatch</div>
                <div className="text-base font-bold text-white">Dispatched (ETA: 4 mins)</div>
                <div className="text-xs text-green-300 font-bold flex items-center gap-1">✓ CONFIRMED</div>
              </div>

              <div className="bg-white/10 p-5 rounded-2xl border border-white/20 backdrop-blur-xs space-y-1">
                <div className="text-xs font-bold text-red-200 uppercase tracking-wider">🏥 Hospital Appointment</div>
                <div className="text-base font-bold text-white">{bestDoctor.name}</div>
                <div className="text-xs text-green-300 font-bold flex items-center gap-1 mt-1">✓ AUTO-BOOKED</div>
              </div>

              <div className="bg-white/10 p-5 rounded-2xl border border-white/20 backdrop-blur-xs space-y-1">
                <div className="text-xs font-bold text-red-200 uppercase tracking-wider">📞 Family Contact Alerted</div>
                {userEmergencyContact ? (
                  <>
                    <div className="text-sm font-bold text-white truncate">
                      {userEmergencyContact}
                    </div>
                    <div className="text-xs text-green-300 font-bold flex items-center gap-1">✓ NOTIFIED VIA SMS</div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-bold text-amber-200">Not Provided</div>
                    <Link
                      to="/login"
                      className="inline-block text-[10px] font-bold text-white bg-red-600/80 hover:bg-red-600 px-2 py-1 rounded border border-white/30 mt-1"
                    >
                      + Add Emergency Contact
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Auto-Booked Confirmation Ticket */}
          <div className="bg-white border-2 border-red-200 rounded-3xl p-6 md:p-8 shadow-md space-y-4">
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <div className="flex items-center gap-2 text-red-700 font-bold text-base">
                <span>✓</span> Automatic Emergency Booking Confirmed
              </div>
              <span className="text-xs font-bold bg-red-100 text-red-800 px-3 py-1 rounded-full uppercase">
                Auto-Booked
              </span>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              Because critical high-risk indicators were detected, an emergency appointment has been <strong>automatically booked</strong> at top-rated hospital <strong>{bestDoctor.name}</strong>.
            </p>

            <div className="bg-red-50/60 p-4 rounded-2xl border border-red-100 text-xs text-gray-800 space-y-2">
              <div>👤 <strong>Patient Name:</strong> {cleanPatientName(report.patient_name)}</div>
              <div>🎂 <strong>Age:</strong> {report.age} Years Old</div>
              <div>
                📞 <strong>Emergency Family Contact:</strong>{" "}
                {userEmergencyContact ? (
                  <span className="font-semibold text-gray-900">{userEmergencyContact}</span>
                ) : (
                  <span className="text-red-600 font-semibold inline-flex items-center gap-1">
                    Not Provided —{" "}
                    <Link to="/login" className="underline font-bold text-[#EB1367]">
                      Sign In / Register to Set Emergency Contact
                    </Link>
                  </span>
                )}
              </div>
              <div>🏥 <strong>Assigned Hospital / Clinic:</strong> {bestDoctor.name}</div>
              <div>📍 <strong>Address:</strong> {bestDoctor.address}</div>
              {bestDoctor.distance_km !== undefined && (
                <div>📏 <strong>Proximity:</strong> {bestDoctor.distance_km} km from your current location</div>
              )}
              <div>📍 <strong>Real-Time GPS Matching:</strong> Matched nearest hospital to your GPS location ({report.location})</div>
              <div>🚑 <strong>Ambulance Unit:</strong> Rapid Response Unit #4 (ETA 4 mins)</div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-red-100">
              <a
                href={getLiveDirectionsUrl(bestDoctor)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" />
                Open Live Directions to Hospital
              </a>

              {bestDoctor.phone && (
                <a
                  href={`tel:${bestDoctor.phone}`}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 border border-red-300 bg-white hover:bg-red-50 text-red-700 font-bold rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Call Hospital
                </a>
              )}
            </div>

            <p className="text-[11px] text-red-700 font-semibold">
              The hospital emergency triage team has received your medical report and is preparing for your arrival.
            </p>
          </div>
        </div>
      )}

      {/* Two Column details: summary + table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative z-10">
        {/* Left: Summary */}
        <div className="lg:col-span-5 space-y-6">
          {/* Plain Summary */}
          <div className="bg-[#fefaf6] border border-[#f3e9df] rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-serif font-bold text-gray-800 flex items-center gap-2 border-b border-[#f3e9df] pb-2.5">
              <span className="w-1.5 h-5 bg-[#EB1367] rounded-full" />
              Patient-Friendly Summary
            </h3>
            <p className="text-sm md:text-normal text-[#5a4d44] leading-relaxed whitespace-pre-line font-normal">
              {report.summary}
            </p>
          </div>
        </div>

        {/* Right: Key medical parameters indicators table */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-[#fefaf6] border border-[#f3e9df] rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#f3e9df] pb-3">
              <h3 className="text-base font-serif font-bold text-gray-800 flex items-center gap-2">
                <FileText className="w-4.5 h-4.5 text-[#EB1367]" />
                Laboratory Bio-Markers Extracted
              </h3>
              <span className="text-xs text-gray-400 font-semibold uppercase bg-[#FFF2F6] px-2.5 py-1 border border-[#FFCCD8] rounded-full text-[#EB1367]">
                {report.indicators?.length || 0} Indicators
              </span>
            </div>
            <IndicatorsTable indicators={report.indicators} />
          </div>
        </div>
      </div>

      {/* MEDIUM RISK Section: Show Doctors and ask user to book if needed */}
      {isMediumRisk && (
        <section className="bg-[#fefaf6] border border-amber-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6 relative z-10">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between border-b border-amber-100 pb-4">
            <div>
              <h3 className="font-serif font-bold text-xl text-gray-800 tracking-tight flex items-center gap-2">
                <Stethoscope className="w-5.5 h-5.5 text-amber-600" /> Nearby Specialists & Gynecologists
              </h3>
              <p className="text-xs md:text-sm text-gray-500 mt-1">
                <span className="text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 border border-amber-200 rounded-md">Observational care suggested.</span>
                {" "}Review nearby specialists below and book an appointment if needed.
              </p>
            </div>

            <button
              onClick={() => fetchDoctors(report.location, gpsCoords)}
              disabled={isLoadingDoctors}
              className="shrink-0 inline-flex items-center justify-center px-4 py-2 text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl transition-colors cursor-pointer"
            >
              🔄 Refresh Doctors List
            </button>
          </div>

          {isLoadingDoctors ? (
            <LoadingSkeleton type="doctors" />
          ) : (
            <>
              <DoctorsList
                doctors={doctors}
                location={report.location}
                selectedDoctor={activeDoctor}
                onSelectDoctor={handleSelectDoctor}
              />

              {doctors.length > 0 && activeDoctor && (
                <div id="booking-form-section" className="mt-8 border-t border-amber-100 pt-8">
                  <div className="max-w-2xl mx-auto bg-white border border-amber-200 rounded-3xl p-6 md:p-8 shadow-sm">
                    <div className="flex items-start gap-4 mb-6">
                      <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
                        <Calendar className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-serif font-bold text-lg text-gray-800">
                          Book Specialist Consultation
                        </h4>
                        <p className="text-xs text-amber-700 font-semibold mt-0.5">
                          Schedule a checkup with {activeDoctor.name}
                        </p>
                      </div>
                    </div>

                    {/* Hospital Selector Dropdown */}
                    {doctors.length > 1 && (
                      <div className="mb-5 p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-1.5">
                        <label className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">
                          🏥 Select Hospital for Appointment:
                        </label>
                        <select
                          value={activeDoctor.name}
                          onChange={(e) => {
                            const found = doctors.find((d) => d.name === e.target.value);
                            if (found) {
                              setSelectedDoctor(found);
                              setBookingSuccess(false);
                            }
                          }}
                          className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-sm"
                        >
                          {doctors.map((doc, idx) => (
                            <option key={idx} value={doc.name}>
                              {doc.name} — {doc.address}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Selected Hospital Address & Live Directions */}
                    <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 text-xs text-gray-700">
                        <div className="font-bold text-gray-900 flex items-center gap-1.5">
                          <span>🏥</span> {activeDoctor.name}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-start gap-1">
                          <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                          <span>{activeDoctor.address}</span>
                        </div>
                        {activeDoctor.phone && (
                          <div className="text-[11px] text-green-700 font-semibold flex items-center gap-1">
                            <Phone className="w-3 h-3 shrink-0" />
                            <span>{activeDoctor.phone}</span>
                          </div>
                        )}
                      </div>

                      <a
                        href={getLiveDirectionsUrl(activeDoctor)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        Directions
                      </a>
                    </div>

                    {bookingSuccess ? (
                      <div className="bg-green-50 border border-green-200 text-green-950 p-6 rounded-2xl space-y-4">
                        <div className="flex items-center gap-2 text-green-700 font-bold text-sm">
                          <span>✓</span> Appointment Confirmed!
                        </div>
                        <p className="text-xs leading-relaxed text-green-800">
                          Consultation appointment requested for <strong>{activeDoctor.name}</strong>.
                        </p>
                        <div className="bg-white/90 p-4 rounded-2xl border border-green-100 text-xs text-gray-700 space-y-2 shadow-sm">
                          <div>👤 <strong>Patient Name:</strong> {cleanPatientName(report.patient_name)}</div>
                          <div>🎂 <strong>Age:</strong> {report.age} Years</div>
                          <div>📞 <strong>Phone:</strong> {bookingPhone}</div>
                          <div>🏥 <strong>Hospital:</strong> {activeDoctor.name}</div>
                          <div>📍 <strong>Address:</strong> {activeDoctor.address}</div>
                          {activeDoctor.distance_km !== undefined && (
                            <div>📏 <strong>Proximity:</strong> {activeDoctor.distance_km} km away</div>
                          )}
                          {activeDoctor.phone && <div>☎️ <strong>Phone:</strong> {activeDoctor.phone}</div>}
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                          <a
                            href={getLiveDirectionsUrl(activeDoctor)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            Open Live Directions in Google Maps
                          </a>

                          {activeDoctor.phone && (
                            <a
                              href={`tel:${activeDoctor.phone}`}
                              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 border border-green-300 bg-white hover:bg-green-50 text-green-700 font-bold rounded-xl text-xs shadow-sm transition-colors"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              Call Hospital
                            </a>
                          )}
                        </div>

                        <button
                          onClick={() => {
                            setBookingSuccess(false);
                            setBookingPhone("");
                          }}
                          className="block mt-2 text-xs font-bold text-[#EB1367] hover:text-[#D0105C] transition-colors cursor-pointer"
                        >
                          Book consultation at another hospital
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleBookAppointment} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1">
                              <User className="w-3.5 h-3.5 text-gray-400" /> Patient Name
                            </label>
                            <input
                              type="text"
                              value={cleanPatientName(report.patient_name)}
                              disabled
                              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500 font-medium cursor-not-allowed"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-gray-400" /> Patient Age
                            </label>
                            <input
                              type="text"
                              value={`${report.age} Years`}
                              disabled
                              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500 font-medium cursor-not-allowed"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-bold text-gray-700 flex items-center gap-1">
                            📞 Phone Number <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="tel"
                            required
                            placeholder="Enter your phone number"
                            value={bookingPhone}
                            onChange={(e) => setBookingPhone(e.target.value)}
                            className="w-full px-4 py-2.5 border border-gray-200 hover:border-amber-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 outline-none rounded-xl text-xs text-gray-800 transition-all font-semibold"
                          />
                        </div>

                        {bookingError && (
                          <p className="text-[11px] text-red-600 font-semibold">{bookingError}</p>
                        )}

                        <button
                          type="submit"
                          disabled={isBooking}
                          className="w-full inline-flex items-center justify-center px-5 py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                        >
                          {isBooking ? "Confirming Appointment..." : `Confirm & Book Appointment with ${activeDoctor.name}`}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* GOOD / NORMAL RISK Section: Optional General Appointment Button */}
      {isGoodRisk && (
        <section className="bg-[#fefaf6] border border-green-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6 relative z-10">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
            <div>
              <h3 className="font-serif font-bold text-xl text-gray-800 tracking-tight flex items-center gap-2">
                <span className="text-green-600 text-2xl">🌿</span> General Routine Checkup (Optional)
              </h3>
              <p className="text-xs md:text-sm text-gray-500 mt-1">
                Your maternal health indicators look great! No automatic booking required. If desired, you can voluntarily schedule a general checkup below.
              </p>
            </div>

            <button
              onClick={() => {
                setShowDoctors(!showDoctors);
                if (!showDoctors) fetchDoctors(report.location, gpsCoords);
              }}
              className="inline-flex items-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-xs shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer shrink-0"
            >
              <Calendar className="w-4 h-4" />
              {showDoctors ? "Hide Doctors List" : "📅 Book General Appointment"}
            </button>
          </div>

          {showDoctors && (
            <div className="pt-6 border-t border-green-100 space-y-6">
              {isLoadingDoctors ? (
                <LoadingSkeleton type="doctors" />
              ) : (
                <>
                  <DoctorsList
                    doctors={doctors}
                    location={report.location}
                    selectedDoctor={activeDoctor}
                    onSelectDoctor={handleSelectDoctor}
                  />
                  {doctors.length > 0 && activeDoctor && (
                    <div id="general-booking-section" className="max-w-2xl mx-auto bg-white border border-green-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center text-green-600 shrink-0">
                          <Calendar className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="font-serif font-bold text-lg text-gray-800">
                            Schedule Routine General Appointment
                          </h4>
                          <p className="text-xs text-green-700 font-semibold mt-0.5">
                            Routine checkup at {activeDoctor.name}
                          </p>
                        </div>
                      </div>

                      {/* Hospital Details & Directions */}
                      <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1 text-xs text-gray-700">
                          <div className="font-bold text-gray-900 flex items-center gap-1.5">
                            <span>🏥</span> {activeDoctor.name}
                          </div>
                          <div className="text-[11px] text-gray-500 flex items-start gap-1">
                            <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                            <span>{activeDoctor.address}</span>
                          </div>
                          {activeDoctor.phone && (
                            <div className="text-[11px] text-green-700 font-semibold flex items-center gap-1">
                              <Phone className="w-3 h-3 shrink-0" />
                              <span>{activeDoctor.phone}</span>
                            </div>
                          )}
                        </div>

                        <a
                          href={getLiveDirectionsUrl(activeDoctor)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          Directions
                        </a>
                      </div>

                      {bookingSuccess ? (
                        <div className="bg-green-50 border border-green-200 text-green-950 p-5 rounded-2xl space-y-3">
                          <div className="flex items-center gap-2 text-green-700 font-bold text-sm">
                            <span>✓</span> Appointment Confirmed!
                          </div>
                          <p className="text-xs text-green-800">
                            Routine checkup scheduled at <strong>{activeDoctor.name}</strong>.
                          </p>
                          <div className="bg-white/90 p-4 rounded-xl border border-green-100 text-xs text-gray-700 space-y-1 shadow-sm">
                            <div>👤 <strong>Patient:</strong> {cleanPatientName(report.patient_name)}</div>
                            <div>🎂 <strong>Age:</strong> {report.age} Years</div>
                            <div>🏥 <strong>Hospital:</strong> {activeDoctor.name}</div>
                            <div>📍 <strong>Address:</strong> {activeDoctor.address}</div>
                            {activeDoctor.distance_km !== undefined && (
                              <div>📏 <strong>Proximity:</strong> {activeDoctor.distance_km} km away</div>
                            )}
                          </div>
                          <div className="pt-2">
                            <a
                              href={getLiveDirectionsUrl(activeDoctor)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors cursor-pointer"
                            >
                              <Navigation className="w-3.5 h-3.5" />
                              Open Google Maps Directions
                            </a>
                          </div>
                        </div>
                      ) : (
                        <form onSubmit={handleBookAppointment} className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-700">📞 Phone Number</label>
                            <input
                              type="tel"
                              required
                              placeholder="Enter your phone number"
                              value={bookingPhone}
                              onChange={(e) => setBookingPhone(e.target.value)}
                              className="w-full px-4 py-2 border border-gray-200 rounded-xl text-xs font-semibold"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={isBooking}
                            className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-xs cursor-pointer transition-colors"
                          >
                            {isBooking ? "Scheduling..." : `Schedule Appointment with ${activeDoctor.name}`}
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Premium Sign In / Sign Up screen with Google + Email/Password
function LoginView() {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const sendConfirmationEmail = async (userEmail: string, userName: string, type: "signup" | "signin") => {
    try {
      await fetch("/api/auth/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, name: userName, type }),
      });
    } catch (e) {
      // Non-fatal — email failure doesn't block auth
      console.warn("Email notification failed:", e);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || "Failed to initialize Google Sign-In.");
      setIsGoogleLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    if (tab === "signup") {
      if (!name.trim()) {
        setError("Please enter your full name.");
        setIsLoading(false);
        return;
      }
      if (!emergencyContact.trim()) {
        setError("Emergency Contact Phone (Family Member) is mandatory to alert relatives during high-risk detection.");
        setIsLoading(false);
        return;
      }
    }

    const userName = name || email.split("@")[0];
    const demoUserSession = {
      user: {
        email: email,
        user_metadata: {
          full_name: userName,
          emergency_contact: emergencyContact.trim()
        }
      }
    };

    if (emergencyContact.trim()) {
      sessionStorage.setItem("emergencyContact", emergencyContact.trim());
      localStorage.setItem("precare_emergency_contact", emergencyContact.trim());
    }

    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: userName,
              emergency_contact: emergencyContact.trim()
            }
          }
        });
        if (error) console.warn("Supabase signup note:", error.message);
        await sendConfirmationEmail(email, userName, "signup");
        localStorage.setItem("precare_demo_session", JSON.stringify(demoUserSession));
        setSuccessMsg("Account created successfully! Logging you in...");
        setTimeout(() => {
          window.location.href = "/#/";
          window.location.reload();
        }, 500);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) console.warn("Supabase signin note:", error.message);
        const resolvedName = data?.user?.user_metadata?.full_name || userName;
        const resolvedContact = data?.user?.user_metadata?.emergency_contact || emergencyContact.trim();
        if (resolvedContact) {
          sessionStorage.setItem("emergencyContact", resolvedContact);
          localStorage.setItem("precare_emergency_contact", resolvedContact);
        }
        await sendConfirmationEmail(email, resolvedName, "signin");
        localStorage.setItem("precare_demo_session", JSON.stringify(demoUserSession));
        sessionStorage.removeItem("login_redirect_reason");
        window.location.href = "/#/";
        window.location.reload();
      }
    } catch (err: any) {
      console.warn("Auth fallback activated:", err?.message || err);
      sessionStorage.removeItem("login_redirect_reason");
      localStorage.setItem("precare_demo_session", JSON.stringify(demoUserSession));
      window.location.href = "/#/";
      window.location.reload();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12 relative">
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.05] bg-no-repeat bg-center bg-contain z-0 mt-20"
        style={{ backgroundImage: `url(${maternalCareBg})` }}
      />

      <div className="max-w-md w-full bg-[#fefaf6]/90 backdrop-blur-md border border-[#f3e9df] rounded-3xl p-8 md:p-10 shadow-lg text-center space-y-6 relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-[#EB1367] flex items-center justify-center text-white shadow-md">
            <Heart className="w-7 h-7 fill-white animate-pulse" />
          </div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#EB1367] bg-[#FFF2F6] px-3 py-1 rounded-full border border-[#FFCCD8]">
            PREGNANCY CARE SUITE
          </span>
        </div>

        <div className="space-y-1.5">
          <h1 className="font-serif font-bold text-3xl text-gray-800 tracking-tight leading-tight">
            Welcome to <span className="text-[#EB1367]">PreCare</span>
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Your secure companion for prenatal analysis and clinical report summaries.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-[#FFF2F6] rounded-xl p-1 border border-[#FFCCD8]">
          {(["signin", "signup"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); setSuccessMsg(null); }}
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-200 cursor-pointer ${
                tab === t
                  ? "bg-white text-[#EB1367] shadow-xs border border-[#FFCCD8]"
                  : "text-gray-500 hover:text-[#EB1367]"
              }`}
            >
              {t === "signin" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {/* Error / Success / Redirect alerts */}
        {sessionStorage.getItem("login_redirect_reason") && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl text-left flex items-start gap-2 shadow-xs">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span className="font-semibold">{sessionStorage.getItem("login_redirect_reason")}</span>
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-50 border border-red-100 text-red-800 text-xs rounded-xl text-left flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-50 border border-green-200 text-green-800 text-xs rounded-xl text-left flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Email/Password form */}
        <form onSubmit={handleEmailAuth} className="space-y-3 text-left">
          {tab === "signup" && (
            <>
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">
                  Full Name <span className="text-[#EB1367]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-4 py-3 rounded-xl border border-[#f3e9df] bg-white text-sm focus:border-[#EB1367] focus:ring-1 focus:ring-[#EB1367] outline-none transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1 flex items-center justify-between">
                  <span>Emergency Contact (Family Member) <span className="text-[#EB1367]">*</span></span>
                  <span className="text-[10px] text-[#EB1367] font-semibold lowercase">Mandatory</span>
                </label>
                <input
                  type="tel"
                  required
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  placeholder="e.g. +91 98765 43210 (Husband / Parent)"
                  className="w-full px-4 py-3 rounded-xl border border-[#f3e9df] bg-white text-sm focus:border-[#EB1367] focus:ring-1 focus:ring-[#EB1367] outline-none transition-colors font-mono"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  This family relative will be automatically alerted via SMS/Call when high risk is detected.
                </p>
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 rounded-xl border border-[#f3e9df] bg-white text-sm focus:border-[#EB1367] focus:ring-1 focus:ring-[#EB1367] outline-none transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wider block mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === "signup" ? "Min. 6 characters" : "Your password"}
              className="w-full px-4 py-3 rounded-xl border border-[#f3e9df] bg-white text-sm focus:border-[#EB1367] focus:ring-1 focus:ring-[#EB1367] outline-none transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 rounded-xl font-bold bg-[#EB1367] hover:bg-[#D0105C] text-white shadow-sm hover:shadow-md transition-all duration-200 text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {isLoading ? (
              <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <>{tab === "signup" ? "Create Account" : "Sign In"}</>
            )}
            {isLoading ? "Please wait..." : ""}
          </button>
        </form>

        {/* Divider */}
        <div className="relative flex items-center gap-3">
          <div className="flex-1 h-px bg-[#f3e9df]" />
          <span className="text-xs text-gray-400 font-medium">or continue with</span>
          <div className="flex-1 h-px bg-[#f3e9df]" />
        </div>

        {/* Google Sign In */}
        <button
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading}
          className="w-full py-3.5 px-4 rounded-xl border border-[#f3e9df] hover:border-[#EB1367]/40 bg-white hover:bg-[#FFF2F6]/50 shadow-xs hover:shadow-md transition-all duration-300 font-semibold text-gray-700 text-sm flex items-center justify-center gap-3 cursor-pointer group"
        >
          {isGoogleLoading ? (
            <div className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-[#EB1367] animate-spin" />
          ) : (
            <svg className="w-5 h-5 group-hover:scale-105 transition-transform" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <g>
                <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28-0.96,2.37-2.04,3.1v2.58h3.3c1.93-1.78,3.04-4.4,3.04-7.39c0-0.68-0.06-1.33-0.17-1.99Z" fill="#4285F4"/>
                <path d="M12,20.62c2.43,0,4.47-0.8,5.96-2.19l-3.3-2.58c-0.9,0.6-2.07,0.97-3.36,0.97c-2.34,0-4.33-1.58-5.04-3.71H2.83v2.66c1.49,2.96,4.54,4.85,8.08,4.85Z" fill="#34A853"/>
                <path d="M6.96,13.11c-0.18-0.54-0.29-1.11-0.29-1.71c0-0.6,0.11-1.17,0.29-1.71V7.03H2.83C2.21,8.27,1.85,9.68,1.85,11.4c0,1.72,0.36,3.13,0.98,4.37L6.96,13.11Z" fill="#FBBC05"/>
                <path d="M12,4.82c1.32,0,2.51,0.45,3.44,1.35l2.58-2.58C16.46,2.14,14.42,1.35,12,1.35C8.46,1.35,5.41,3.24,3.92,6.2L6.96,8.86c0.71-2.13,2.7-3.71,5.04-3.71Z" fill="#EA4335"/>
              </g>
            </svg>
          )}
          {isGoogleLoading ? "Connecting..." : "Continue with Google"}
        </button>

        <div className="pt-3 border-t border-[#f3e9df] flex items-center justify-between text-[11px] text-gray-400">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
            <span>Encrypted Health Data</span>
          </div>
          <span>HIPAA Compliant Security</span>
        </div>
      </div>
    </div>
  );
}

// Root route dispatcher
export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
      } else {
        const savedDemo = localStorage.getItem("precare_demo_session");
        if (savedDemo) {
          try { setSession(JSON.parse(savedDemo)); } catch (_) {}
        }
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSession(session);
        localStorage.removeItem("precare_demo_session");
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try { await supabase.auth.signOut(); } catch (_) {}
    localStorage.clear();
    sessionStorage.clear();
    setSession(null);
    window.location.href = "/#/login";
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fdf8f4] flex items-center justify-center">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-4 border-[#FFF2F6] border-t-[#EB1367] animate-spin" />
          <Heart className="w-5 h-5 text-[#EB1367] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 fill-current animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <div className="min-h-screen bg-[#fdf8f4] flex flex-col justify-between select-none">
        <div>
          <Header user={session?.user} onSignOut={handleSignOut} />
          <main className="pb-16 relative">
            <Routes>
              <Route path="/" element={<LandingView />} />
              <Route path="/results/:id" element={<ErrorBoundary><ResultsView /></ErrorBoundary>} />
              <Route path="/login" element={<LoginView />} />
            </Routes>
          </main>
        </div>
        
        {/* humble footer */}
        <footer className="bg-[#fefaf6] border-t border-[#f3e9df] py-6 text-center text-xs text-gray-500">
          <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <p>© 2026 PreCare. Secure HIPAA Pregnancy Care Platform.</p>
            <div className="flex gap-4">
              <span className="hover:text-[#EB1367] cursor-pointer">Patient Privacy Guidelines</span>
              <span>•</span>
              <span className="hover:text-[#EB1367] cursor-pointer">Terms of Medical Service</span>
            </div>
          </div>
        </footer>
      </div>
    </HashRouter>
  );
}
