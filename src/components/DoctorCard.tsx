import React from "react";
import { Star, MapPin, Phone, Navigation, CalendarCheck, Check } from "lucide-react";
import { Doctor } from "../types";

interface DoctorCardProps {
  key?: any;
  id?: string;
  doctor: Doctor;
  isSelected?: boolean;
  onSelect?: (doctor: Doctor) => void;
}

export default function DoctorCard({ id = "doctor-card", doctor, isSelected = false, onSelect }: DoctorCardProps) {
  // Render star ratings based on rating number
  const renderStars = (rating: number = 4.5) => {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;
    const stars = [];

    for (let i = 1; i <= 5; i++) {
      if (i <= fullStars) {
        stars.push(<Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />);
      } else if (i === fullStars + 1 && hasHalfStar) {
        stars.push(
          <div key={i} className="relative inline-block">
            <Star className="w-3.5 h-3.5 text-gray-200" />
            <div className="absolute top-0 left-0 overflow-hidden w-1/2">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            </div>
          </div>
        );
      } else {
        stars.push(<Star key={i} className="w-3.5 h-3.5 text-gray-200" />);
      }
    }
    return stars;
  };

  // Generate an elegant medical doctor initials avatar
  const getInitials = (nameString: string) => {
    if (!nameString || typeof nameString !== "string") return "DR";
    const cleanName = nameString.replace(/^(Dr\.|Dr)\s+/i, "");
    const parts = cleanName.split(" ").filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return cleanName.substring(0, 2).toUpperCase();
  };

  // Construct Google Maps Direct Navigation with GPS origin and hospital destination
  const userLat = sessionStorage.getItem("gpsLat");
  const userLon = sessionStorage.getItem("gpsLon");
  const originParam = userLat && userLon ? `origin=${userLat},${userLon}&` : "";
  const destParam = doctor.lat && doctor.lon
    ? `destination=${doctor.lat},${doctor.lon}`
    : `destination=${encodeURIComponent(doctor.name + ", " + (doctor.address || ""))}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&${originParam}${destParam}&travelmode=driving`;

  return (
    <div
      id={id}
      className={`relative bg-white rounded-2xl p-5 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between border-2 ${
        isSelected
          ? "border-amber-500 ring-2 ring-amber-500/20 shadow-md bg-amber-50/10"
          : doctor.aiRecommended
          ? "border-[#EB1367] ring-1 ring-[#EB1367]/20"
          : "border-gray-100"
      }`}
    >
      {/* AI Recommended / Selected Badge */}
      {isSelected ? (
        <div className="absolute -top-3 left-4 flex items-center gap-1 bg-amber-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-md">
          <Check className="w-3 h-3" /> Selected Hospital
        </div>
      ) : doctor.aiRecommended ? (
        <div className="absolute -top-3 left-4 flex items-center gap-1.5 bg-[#EB1367] text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-md">
          <span>✨</span> {doctor.isClosest ? "Nearest Hospital" : "AI Recommended"}
        </div>
      ) : null}

      <div className={doctor.aiRecommended || isSelected ? "mt-2" : ""}>
        {/* Header: Avatar + Name + Rating */}
        <div className="flex gap-3 items-start mb-3">
          <div
            className={`w-12 h-12 rounded-xl font-bold flex items-center justify-center shrink-0 text-sm ${
              isSelected
                ? "bg-amber-100 text-amber-800"
                : doctor.aiRecommended
                ? "bg-[#FFF2F6] text-[#EB1367]"
                : "bg-blue-50 text-blue-600"
            }`}
          >
            {getInitials(doctor.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-gray-900 text-sm leading-tight line-clamp-2">
              {doctor.name}
            </h4>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-gray-700">{doctor.rating || 4.8}</span>
              <div className="flex items-center gap-0.5">
                {renderStars(doctor.rating)}
              </div>
              <span className="text-[10px] text-gray-400">
                ({(doctor.user_ratings_total || 150).toLocaleString()})
              </span>
              {doctor.distance_km !== undefined && doctor.distance_km > 0 && (
                <span className="ml-auto text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                  📍 {doctor.distance_km} km
                </span>
              )}
            </div>
          </div>
        </div>

        {/* AI Reason / Proximity Note */}
        {doctor.aiRecommended && doctor.aiReason && (
          <div className="mb-3 p-2 bg-[#FFF2F6] rounded-xl border border-[#FFCCD8]">
            <p className="text-[11px] text-[#EB1367] font-semibold leading-normal">
              ⚡ {doctor.aiReason}
            </p>
          </div>
        )}

        {/* Details */}
        <div className="space-y-2 text-xs text-gray-600 mb-4">
          <div className="flex gap-2 items-start">
            <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
            <span className="leading-normal">{doctor.address}</span>
          </div>

          {doctor.phone && (
            <div className="flex gap-2 items-center">
              <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <a
                href={`tel:${doctor.phone}`}
                className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                {doctor.phone}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-3 border-t border-gray-100">
        <div className="flex gap-2">
          {/* Direct Google Maps Directions Navigation */}
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all duration-200 cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5" />
            Get Directions
          </a>

          {doctor.phone && (
            <a
              href={`tel:${doctor.phone}`}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border border-green-200 hover:bg-green-50 text-green-700 transition-colors"
            >
              <Phone className="w-3.5 h-3.5" />
              Call
            </a>
          )}
        </div>

        {onSelect && (
          <button
            type="button"
            onClick={() => onSelect(doctor)}
            className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
              isSelected
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200"
            }`}
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            {isSelected ? "Selected for Consultation" : "Book at This Hospital"}
          </button>
        )}
      </div>
    </div>
  );
}
