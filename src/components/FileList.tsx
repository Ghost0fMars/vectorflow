import { FileText, CheckCircle2, Loader2, AlertTriangle, Trash2, Play, RefreshCw, FileCheck } from "lucide-react";
import { ProcessedFile } from "../types";
import { formatBytes } from "../utils/chunker";

interface FileListProps {
  files: ProcessedFile[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onConvertFile: (id: string) => void;
  onConvertAll: () => void;
}

export default function FileList({
  files,
  activeFileId,
  onSelectFile,
  onRemoveFile,
  onConvertFile,
  onConvertAll,
}: FileListProps) {
  const pendingFiles = files.filter((f) => f.status === "pending");
  const conversionInProgress = files.some((f) => f.status === "processing");

  return (
    <div id="file-list-container" className="flex flex-col h-full bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      {/* File List Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800 text-xs">File de Fichiers ({files.length})</span>
        </div>
        {pendingFiles.length > 0 && (
          <button
            type="button"
            onClick={onConvertAll}
            disabled={conversionInProgress}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-[11px] rounded transition active:scale-95"
          >
            <Play className="h-3 w-3 fill-current" />
            Tout convertir
          </button>
        )}
      </div>

      {/* Files List Scroll Area */}
      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-12 px-4 text-center text-gray-400">
          <FileText className="h-10 w-10 text-gray-300 stroke-1 mb-2" />
          <p className="text-xs font-medium">Aucun fichier importé</p>
          <p className="text-[10px] text-gray-400 mt-1 max-w-[180px] leading-normal">
            Déposez des documents ci-dessus ou parcourez votre disque pour commencer.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50 max-h-[350px] lg:max-h-full">
          {files.map((file) => {
            const isActive = file.id === activeFileId;
            const hasDone = file.status === "done";
            const isProcessing = file.status === "processing";
            const isPending = file.status === "pending";
            const isFailed = file.status === "error";

            return (
              <div
                key={file.id}
                onClick={() => onSelectFile(file.id)}
                className={`group flex items-center justify-between p-3 cursor-pointer transition-all duration-150 ${
                  isActive
                    ? "bg-slate-50 border-l-[3px] border-emerald-500"
                    : "border-l-[3px] border-transparent hover:bg-slate-50/50"
                }`}
              >
                {/* File Info Block */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {/* Icon depending on state */}
                  <div className="flex-shrink-0">
                    {isProcessing ? (
                      <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : hasDone ? (
                      <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                        <FileCheck className="h-4 w-4" />
                      </div>
                    ) : isFailed ? (
                      <div className="p-1.5 rounded-lg bg-red-50 text-red-500">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                    ) : (
                      <div className="p-1.5 rounded-lg bg-gray-50 text-gray-500 group-hover:bg-gray-100 transition">
                        <FileText className="h-4 w-4" />
                      </div>
                    )}
                  </div>

                  {/* Name and Size */}
                  <div className="min-w-0">
                    <h4
                      className={`text-xs font-semibold truncate ${
                        isActive ? "text-slate-900" : "text-gray-700"
                      }`}
                      title={file.name}
                    >
                      {file.name}
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-440 font-mono">
                      <span>{formatBytes(file.size)}</span>
                      <span>•</span>
                      <span>{file.type ? file.type.split("/")[1] || file.type : "inconnu"}</span>
                    </div>
                  </div>
                </div>

                {/* Operations & Interactive States */}
                <div className="flex items-center gap-1.5 ml-2" onClick={(e) => e.stopPropagation()}>
                  {isPending && (
                    <button
                      type="button"
                      onClick={() => onConvertFile(file.id)}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-emerald-600 transition"
                      title="Lancer la conversion"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </button>
                  )}

                  {isFailed && (
                    <button
                      type="button"
                      onClick={() => onConvertFile(file.id)}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-500 transition"
                      title="Réessayer"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {hasDone && (
                    <div className="flex items-center gap-1 mr-1 text-[10px] font-mono text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">
                      <CheckCircle2 className="h-3 w-3" />
                      Prêt
                    </div>
                  )}

                  {isProcessing && (
                    <span className="text-[10px] font-mono font-bold text-indigo-500 mr-1 animate-pulse">
                      Gemini...
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemoveFile(file.id)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500 transition opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
