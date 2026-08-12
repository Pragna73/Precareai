import React, { useRef, useState } from "react";
import { Upload, FileText, Image as ImageIcon, X, CheckCircle } from "lucide-react";

interface FileUploadProps {
  onFileSelect: (file: File | null) => void;
  selectedFile: File | null;
}

export default function FileUpload({ onFileSelect, selectedFile }: FileUploadProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const processFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const validTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword"
    ];
    const isDocxOrDoc = file.name.endsWith(".docx") || file.name.endsWith(".doc");
    if (!validTypes.includes(file.type) && !isDocxOrDoc) {
      alert("Invalid file format. Please upload a PDF, DOCX, PNG, or JPG pregnancy report.");
      return;
    }

    const lowerName = file.name.toLowerCase();
    const disallowedNames = [
      "invoice", "receipt", "resume", "cv", "passport", "license",
      "vehicle", "tax", "bill", "payslip", "ticket", "contract",
      "homework", "assignment", "statement", "salary", "certificate"
    ];

    if (disallowedNames.some(kw => lowerName.includes(kw))) {
      alert("Invalid Document: The selected file does not appear to be a pregnancy medical report. Please upload an obstetric lab report, prenatal blood test, or ultrasound scan.");
      return;
    }

    onFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    processFiles(e.dataTransfer.files);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileSelect(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 2;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        id="report-file-input"
        className="hidden"
        accept=".pdf, .jpg, .jpeg, .png, .docx, .doc"
        onChange={handleChange}
      />

      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={selectedFile ? undefined : openFileDialog}
        className={`w-full relative border-2 border-dashed rounded-2xl p-8 md:p-12 text-center transition-all ${
          selectedFile
            ? "border-green-300 bg-green-50/20"
            : isDragActive
            ? "border-[#EB1367] bg-[#FFF2F6]/50 scale-[1.01]"
            : "border-gray-200 hover:border-[#EB1367] hover:bg-[#FFF2F6]/20 cursor-pointer"
        }`}
      >
        {selectedFile ? (
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
              {selectedFile.type === "application/pdf" || selectedFile.name.endsWith(".docx") || selectedFile.name.endsWith(".doc") ? (
                <FileText className="w-7 h-7 text-green-600" />
              ) : (
                <ImageIcon className="w-7 h-7 text-green-600" />
              )}
            </div>

            <div className="max-w-xs md:max-w-md mx-auto">
              <p className="font-semibold text-gray-800 text-base mb-1 truncate">
                {selectedFile.name}
              </p>
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                <span>{formatSize(selectedFile.size)}</span>
                <span>•</span>
                <span className="capitalize">{selectedFile.type.split("/")[1]}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-green-100 text-green-800 px-2.5 py-1 rounded-md">
                <CheckCircle className="w-3.5 h-3.5" />
                Selected
              </span>
              <button
                type="button"
                onClick={removeFile}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 hover:bg-red-200 text-red-800 px-2.5 py-1 rounded-md transition-colors"
                id="btn-remove-file"
              >
                <X className="w-3.5 h-3.5" />
                Change File
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[#FFF2F6] flex items-center justify-center mb-4 text-[#EB1367] border border-[#FFF2F6] shadow-xs animate-float">
              <Upload className="w-8 h-8" />
            </div>

            <h3 className="text-lg font-semibold text-gray-800 mb-1.5 font-display">
              Upload Pregnancy Medical Report
            </h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6 leading-relaxed">
              Drag & drop your medical file here, or click to browse. We accept PDFs, DOCX, JPEG, and PNG reports.
            </p>

            <button
              type="button"
              className="inline-flex items-center gap-2 bg-[#EB1367] hover:bg-[#D0105C] text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-xs hover:shadow-md transition-all duration-200"
              id="btn-browse-files"
            >
              Browse Files
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
