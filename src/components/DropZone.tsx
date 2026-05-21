import React, { useState, useRef } from "react";
import { Upload, FileText, FileSpreadsheet, Music, Image as ImageIcon, FileCode } from "lucide-react";

interface DropZoneProps {
  onFilesSelected: (files: { name: string; size: number; mimeType: string; base64: string }[]) => void;
}

export default function DropZone({ onFilesSelected }: DropZoneProps) {
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

  const processFile = (file: File): Promise<{ name: string; size: number; mimeType: string; base64: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          // Extract the actual base64 part
          const base64String = reader.result.split(",")[1];
          resolve({
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
            base64: base64String,
          });
        } else {
          reject(new Error("Échec de la lecture du fichier"));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (fileList: FileList) => {
    const promises = Array.from(fileList).map((file) => processFile(file));
    try {
      const processed = await Promise.all(promises);
      onFilesSelected(processed);
    } catch (err) {
      console.error("Erreur de traitement des fichiers:", err);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handleFiles(e.target.files);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      id="drag-and-drop-container"
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      onClick={triggerFileInput}
      className={`group relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 ${
        isDragActive
          ? "border-emerald-500 bg-emerald-50/10 dark:bg-emerald-950/20"
          : "border-gray-200 dark:border-gray-800 hover:border-gray-400 dark:hover:border-gray-600 bg-white hover:bg-gray-50/50"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleChange}
      />

      <div className="flex -space-x-2 mb-4">
        <div className="p-2.5 rounded-lg bg-red-100 text-red-600 shadow-sm">
          <FileText className="h-5 w-5" />
        </div>
        <div className="p-2.5 rounded-lg bg-indigo-100 text-indigo-600 shadow-sm z-10 scale-110">
          <Upload className="h-5 w-5 animate-bounce" />
        </div>
        <div className="p-2.5 rounded-lg bg-green-100 text-green-600 shadow-sm">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
      </div>

      <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-base mb-1">
        Faites glisser et déposez vos fichiers ici
      </h3>
      <p className="text-gray-500 dark:text-gray-400 text-xs max-w-md leading-relaxed mb-4">
        PDF, CSV, JSON, XML, Markdown, TXT, code source.
        Conversion automatique via IA locale (Qwen2.5-Coder).
      </p>

      <button
        type="button"
        id="file-select-btn"
        className="px-4 py-2 bg-gray-900 border border-transparent text-white font-medium text-xs rounded-lg hover:bg-gray-850 active:scale-95 transition-all duration-150 shadow-sm"
      >
        Parcourir les fichiers
      </button>

      {/* Decorative support indicators */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-center items-center space-x-4 opacity-40 group-hover:opacity-60 transition-opacity duration-300 text-[10px] text-gray-400 font-mono">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> DOCS
        </span>
        <span className="flex items-center gap-1">
          <FileSpreadsheet className="h-3 w-3" /> DATA
        </span>
        <span className="flex items-center gap-1">
          <ImageIcon className="h-3 w-3" /> OCR
        </span>
        <span className="flex items-center gap-1">
          <Music className="h-3 w-3" /> AUDIO
        </span>
        <span className="flex items-center gap-1">
          <FileCode className="h-3 w-3" /> CODE
        </span>
      </div>
    </div>
  );
}
