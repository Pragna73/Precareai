import React from "react";

interface RiskBadgeProps {
  id?: string;
  level: "LOW" | "MEDIUM" | "HIGH" | string;
}

export default function RiskBadge({ id = "risk-badge", level }: RiskBadgeProps) {
  const normalizedLevel = level?.toUpperCase() || "LOW";

  let styles = "bg-green-100 text-green-800 border-green-200";
  let dotColor = "bg-green-500";
  let text = "Low Risk";

  if (normalizedLevel === "MEDIUM" || normalizedLevel === "MODERATE" || normalizedLevel === "WARNING") {
    styles = "bg-amber-100 text-amber-800 border-amber-200";
    dotColor = "bg-amber-500";
    text = "Medium Risk";
  } else if (normalizedLevel === "HIGH" || normalizedLevel === "DANGER" || normalizedLevel === "CRITICAL") {
    styles = "bg-red-100 text-red-800 border-red-200";
    dotColor = "bg-red-500";
    text = "High Risk";
  }

  return (
    <span
      id={id}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border ${styles} shadow-xs`}
    >
      <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
      {text}
    </span>
  );
}
