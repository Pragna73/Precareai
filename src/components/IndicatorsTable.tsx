import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { HealthIndicator } from "../types";

interface IndicatorsTableProps {
  indicators: HealthIndicator[];
}

export default function IndicatorsTable({ indicators }: IndicatorsTableProps) {
  if (!indicators || indicators.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
        No indicators were found or analyze is incomplete.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 shadow-xs">
      <table className="w-full text-left border-collapse bg-white">
        <thead>
          <tr className="bg-blue-50/50 border-b border-gray-100">
            <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Health Marker / Parameter</th>
            <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Report Value</th>
            <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {indicators.map((item, index) => {
            if (!item) return null;
            const parameter = typeof item === "string" ? item : (item.parameter || "Biomarker Parameter");
            const value = typeof item === "string" ? "Extracted" : (item.value || "Normal");
            const statusStr = typeof item === "object" && item.status ? String(item.status).toLowerCase() : "normal";
            const isAbnormal = statusStr === "abnormal" || statusStr === "high" || statusStr === "attention" || statusStr === "danger";

            return (
              <tr key={index} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4">
                  <span className="font-medium text-gray-800 text-sm md:text-base">
                    {parameter}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`font-mono text-sm md:text-base ${isAbnormal ? "text-amber-700 font-semibold" : "text-gray-600"}`}>
                    {value}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="inline-flex items-center gap-1.5 ml-auto">
                    {isAbnormal ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        Attention
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-green-50 text-green-800 border border-green-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        Normal
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
