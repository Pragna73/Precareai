import React from "react";
import { Stethoscope } from "lucide-react";
import DoctorCard from "./DoctorCard";
import { Doctor } from "../types";

interface DoctorsListProps {
  doctors: Doctor[];
  location: string;
  selectedDoctor?: Doctor | null;
  onSelectDoctor?: (doctor: Doctor) => void;
}

export default function DoctorsList({ doctors, location, selectedDoctor, onSelectDoctor }: DoctorsListProps) {
  if (!doctors || doctors.length === 0) {
    return (
      <div className="text-center py-10 px-4 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
        <Stethoscope className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">No nearby gynecologists found in {location}.</p>
        <p className="text-sm text-gray-400 mt-1">Please ensure your location is spelled correctly.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {doctors.map((doctor, index) => (
        <DoctorCard
          key={index}
          id={`doctor-${index}`}
          doctor={doctor}
          isSelected={selectedDoctor?.name === doctor.name}
          onSelect={onSelectDoctor}
        />
      ))}
    </div>
  );
}
