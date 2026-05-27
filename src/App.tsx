import { useState, useEffect } from "react";
import {
  FileText,
  Database,
  Trash2,
  Copy,
  Download,
  Check,
  AlertCircle,
  Sparkles,
  Layers,
  RefreshCw,
  Cpu,
  Share2,
  FileDown,
  Table,
  Archive,
} from "lucide-react";
import DropZone from "./components/DropZone";
import ChunkingOptionsPanel from "./components/ChunkingOptionsPanel";
import FileList from "./components/FileList";
import { ProcessedFile, ChunkingConfig, ConversionResponse, EmbedResponse, StoreResponse, SearchResponse, SearchResult, Chunk } from "./types";
import { generateChunks, estimateTokens, formatBytes } from "./utils/chunker";

export default function App() {
  const [config, setConfig] = useState<ChunkingConfig>({
    enabled: true,
    strategy: "char",
    size: 500,
    overlap: 100,
    addMetadata: true,
    enrichWithAI: true,
  });

  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"raw" | "chunks">("raw");
  const [collectionName, setCollectionName] = useState("vectorflow");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(5);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [exportLoading, setExportLoading] = useState<{
    sqlite: boolean;
    snapshot: boolean;
    json: boolean;
    csv: boolean;
  }>({
    sqlite: false,
    snapshot: false,
    json: false,
    csv: false,
  });
  const [exportError, setExportError] = useState<string | null>(null);

  const activeFile = files.find((f) => f.id === activeFileId);

  useEffect(() => {
    setFiles((prev) =>
      prev.map((file) => {
        if (file.status === "done" && file.rawText) {
          const generated = generateChunks(
            file.rawText,
            file.name,
            config,
            file.summary || "",
            file.keywords || []
          );
          return { ...file, chunks: generated };
        }
        return file;
      })
    );
  }, [config.enabled, config.strategy, config.size, config.overlap, config.addMetadata]);

  const handleFilesSelected = (
    newFiles: { name: string; size: number; mimeType: string; base64: string }[]
  ) => {
    const processed: ProcessedFile[] = newFiles.map((f) => ({
      id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: f.name,
      size: f.size,
      type: f.mimeType,
      status: "pending",
      progress: 0,
      rawText: undefined,
      markdownText: undefined,
      chunks: [],
      _base64: f.base64,
    } as any));

    setFiles((prev) => [...prev, ...processed]);
    if (!activeFileId && processed.length > 0) {
      setActiveFileId(processed[0].id);
    }
  };

  const convertFile = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file || file.status === "processing") return;

    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 30 } : f))
    );

    try {
      const base64Data = (file as any)._base64;
      if (!base64Data) {
        throw new Error("Contenu binaire du fichier introuvable. Veuillez le réimporter.");
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, mimeType: file.type, base64: base64Data }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Erreur serveur : Code ${response.status}`);
      }

      const data: ConversionResponse = await response.json();
      if (!data.success) throw new Error(data.error || "La conversion a échoué.");

      const initialChunks = generateChunks(
        data.rawText, file.name, config, data.summary || "", data.keywords || []
      );

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, status: "done", progress: 100, rawText: data.rawText,
                markdownText: data.markdownText, summary: data.summary,
                keywords: data.keywords, chunks: initialChunks, processedAt: Date.now() }
            : f
        )
      );
    } catch (err: any) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: "error", error: err.message || "Erreur inconnue" } : f
        )
      );
    }
  };

  const embedFile = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file || !file.chunks || file.chunks.length === 0) return;

    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, embeddingStatus: "processing" } : f))
    );

    try {
      const response = await fetch("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: file.chunks.map((c) => ({ id: c.id, text: c.text })) }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Erreur serveur : Code ${response.status}`);
      }

      const data: EmbedResponse = await response.json();
      if (!data.success) throw new Error(data.error || "Échec de la génération des embeddings.");

      const embeddingMap = new Map(data.embeddings!.map((e) => [e.id, e.vector]));

      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== id) return f;
          return {
            ...f,
            embeddingStatus: "done",
            chunks: f.chunks?.map((c) => ({
              ...c,
              embedding: embeddingMap.get(c.id) ?? c.embedding,
            })),
          };
        })
      );
    } catch (err: any) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, embeddingStatus: "error", embeddingError: err.message } : f
        )
      );
    }
  };

  const storeFile = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file?.chunks?.length) return;

    const embeddedChunks = file.chunks.filter((c) => c.embedding);
    if (!embeddedChunks.length) return;

    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, storeStatus: "processing" } : f))
    );

    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionName,
          chunks: embeddedChunks.map((c) => ({
            id: c.id, text: c.text, embedding: c.embedding, metadata: c.metadata,
          })),
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Erreur serveur : Code ${response.status}`);
      }

      const data: StoreResponse = await response.json();
      if (!data.success) throw new Error(data.error || "Échec du stockage dans Qdrant.");

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, storeStatus: "done", storedCollection: data.collection } : f
        )
      );
    } catch (err: any) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, storeStatus: "error", storeError: err.message } : f
        )
      );
    }
  };

  const performSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, collectionName, limit: searchLimit }),
      });
      const data: SearchResponse = await response.json();
      if (!data.success) throw new Error(data.error || "Recherche échouée.");
      setSearchResults(data.results || []);
    } catch (err: any) {
      setSearchError(err.message);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleExport = async (format: "sqlite" | "snapshot" | "json" | "csv") => {
    setExportLoading((prev) => ({ ...prev, [format]: true }));
    setExportError(null);
    try {
      const response = await fetch(`/api/export/${format}?collection=${collectionName}`);
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Erreur lors de l'exportation (${response.status})`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      let ext = format === "sqlite" ? "db" : format;
      if (format === "snapshot") ext = "snapshot";
      
      a.download = `${collectionName}_export.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setExportError(err.message || "Une erreur est survenue lors de l'exportation.");
    } finally {
      setExportLoading((prev) => ({ ...prev, [format]: false }));
    }
  };

  const convertAllPending = async () => {
    const pending = files.filter((f) => f.status === "pending");
    for (const file of pending) {
      await convertFile(file.id);
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (activeFileId === id) {
      const remaining = files.filter((f) => f.id !== id);
      setActiveFileId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const copyToClipboard = (text: string, labelId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(labelId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const downloadFile = (file: ProcessedFile, format: "txt" | "json") => {
    let content: string;
    let filename: string;
    let mimeType = "text/plain";
    const base = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;

    if (format === "txt") {
      content = file.rawText || "";
      filename = `${base}_raw.txt`;
    } else {
      const vectorPayload = {
        document: {
          id: file.id, name: file.name, total_size_bytes: file.size,
          mime_type: file.type, raw_character_count: file.rawText?.length || 0,
          estimated_tokens: estimateTokens(file.rawText || ""), processed_at: file.processedAt,
        },
        chunking_strategy: {
          enabled: config.enabled, strategy: config.strategy,
          chunk_size: config.size, chunk_overlap: config.overlap,
          metadata_injected: config.addMetadata,
        },
        chunks: file.chunks?.map((c) => ({
          chunk_id: c.id, index: c.index, text: c.text,
          token_estimate: estimateTokens(c.text), char_count: c.charCount,
          word_count: c.wordCount, embedding: c.embedding ?? null, metadata: c.metadata,
        })) || [],
      };
      content = JSON.stringify(vectorPayload, null, 2);
      filename = `${base}_vector_package.json`;
      mimeType = "application/json";
    }

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalFiles = files.length;
  const processedCount = files.filter((f) => f.status === "done").length;
  const totalChunksCount = files.reduce((acc, f) => acc + (f.chunks?.length || 0), 0);
  const totalEmbeddedChunks = files.reduce(
    (acc, f) => acc + (f.chunks?.filter((c) => c.embedding).length || 0), 0
  );

  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen font-sans flex flex-col antialiased">

      <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xs">
            VF
          </div>
          <h1 className="text-sm font-bold tracking-tight text-slate-900">VectorFlow</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Local
        </div>
      </header>

      <main className="flex-grow flex flex-col lg:flex-row overflow-hidden">

        {/* Left sidebar — stats */}
        <aside className="w-full lg:w-56 border-r border-slate-200 bg-white p-4 flex flex-col shrink-0 gap-3">
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
            {[
              { label: "Fichiers", value: totalFiles, sub: `${processedCount} convertis` },
              { label: "Segments", value: totalChunksCount, sub: `${config.strategy} · ${config.size}` },
              { label: "Vecteurs", value: totalEmbeddedChunks, sub: "multilingual-e5-base" },
            ].map(({ label, value, sub }) => (
              <div key={label} className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="text-[10px] uppercase text-slate-400 font-semibold block">{label}</span>
                <p className="text-xl font-black text-slate-800 mt-0.5">{value}</p>
                <p className="text-[9px] text-slate-400 font-mono mt-0.5 truncate">{sub}</p>
              </div>
            ))}
          </div>

          {files.length > 0 && (
            <button
              type="button"
              onClick={() => { setFiles([]); setActiveFileId(null); }}
              className="mt-auto flex items-center justify-center gap-1.5 py-1.5 px-3 border border-red-100 hover:border-red-200 bg-red-50/30 hover:bg-red-50 text-red-500 hover:text-red-600 text-xs font-medium rounded-lg transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Vider la file
            </button>
          )}
        </aside>

        {/* Central workspace */}
        <section className="flex-1 flex flex-col p-5 gap-5 overflow-y-auto min-w-0">

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 shrink-0">
            <div className="md:col-span-2">
              <DropZone onFilesSelected={handleFilesSelected} />
            </div>
            <div className="h-full">
              <FileList
                files={files}
                activeFileId={activeFileId}
                onSelectFile={(id) => setActiveFileId(id)}
                onRemoveFile={(id) => removeFile(id)}
                onConvertFile={(id) => convertFile(id)}
                onConvertAll={convertAllPending}
              />
            </div>
          </div>

          {activeFile ? (
            <div className="flex-grow bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col min-h-[500px]">

              {/* File header */}
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 truncate" title={activeFile.name}>
                    {activeFile.name}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {formatBytes(activeFile.size)} · {activeFile.type || "inconnu"} ·{" "}
                    <span className={activeFile.status === "done" ? "text-emerald-600" : "text-slate-400"}>
                      {activeFile.status === "done" ? "converti" : activeFile.status}
                    </span>
                  </p>
                </div>

                {activeFile.status === "done" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => downloadFile(activeFile, "txt")}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-xs rounded-lg transition"
                    >
                      <Download className="h-3.5 w-3.5" />
                      .txt
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile(activeFile, "json")}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-xs rounded-lg transition"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      .json
                    </button>

                    {activeFile.embeddingStatus !== "done" ? (
                      <button
                        type="button"
                        onClick={() => embedFile(activeFile.id)}
                        disabled={activeFile.embeddingStatus === "processing" || !activeFile.chunks?.length}
                        className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs rounded-lg transition active:scale-95"
                      >
                        {activeFile.embeddingStatus === "processing"
                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          : <Cpu className="h-3.5 w-3.5" />}
                        {activeFile.embeddingStatus === "processing" ? "Vectorisation…" : "Vectoriser"}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 px-2.5 py-1.5 bg-violet-50 text-violet-700 border border-violet-200 text-xs rounded-lg">
                        <Check className="h-3.5 w-3.5" />
                        {activeFile.chunks?.length} vecteurs
                      </span>
                    )}
                    {activeFile.embeddingStatus === "error" && (
                      <span className="text-[10px] text-red-600 font-mono truncate max-w-[200px]" title={activeFile.embeddingError}>
                        {activeFile.embeddingError}
                      </span>
                    )}

                    {activeFile.embeddingStatus === "done" && activeFile.storeStatus !== "done" && (
                      <button
                        type="button"
                        onClick={() => storeFile(activeFile.id)}
                        disabled={activeFile.storeStatus === "processing"}
                        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs rounded-lg transition active:scale-95"
                      >
                        {activeFile.storeStatus === "processing"
                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          : <Database className="h-3.5 w-3.5" />}
                        {activeFile.storeStatus === "processing" ? "Stockage…" : "Stocker"}
                      </button>
                    )}
                    {activeFile.storeStatus === "done" && (
                      <span className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs rounded-lg">
                        <Check className="h-3.5 w-3.5" />
                        {activeFile.storedCollection}
                      </span>
                    )}
                    {activeFile.storeStatus === "error" && (
                      <span className="text-[10px] text-red-600 font-mono truncate max-w-[200px]" title={activeFile.storeError}>
                        {activeFile.storeError}
                      </span>
                    )}
                  </div>
                )}

                {activeFile.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => convertFile(activeFile.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg transition active:scale-95"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Convertir
                  </button>
                )}
              </div>

              {/* Tabs + content */}
              {activeFile.status === "done" ? (
                <div className="flex-grow flex flex-col min-h-0">
                  <div className="flex border-b border-slate-100 bg-white shrink-0">
                    {(["raw", "chunks"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`py-2.5 px-5 text-xs font-medium border-b-2 transition whitespace-nowrap flex items-center gap-1.5 ${
                          activeTab === tab
                            ? "border-indigo-600 text-indigo-700"
                            : "border-transparent text-slate-400 hover:text-slate-700"
                        }`}
                      >
                        {tab === "raw" ? <FileText className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
                        {tab === "raw" ? "Texte brut" : `Segments (${activeFile.chunks?.length || 0})`}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 p-5 overflow-y-auto min-h-0">

                    {activeTab === "raw" && (
                      <div className="h-full flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-mono text-slate-400">
                            ~{activeFile.rawText ? estimateTokens(activeFile.rawText) : 0} tokens
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(activeFile.rawText || "", "raw")}
                            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded px-2.5 py-1 transition"
                          >
                            {copiedId === "raw" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                            {copiedId === "raw" ? "Copié" : "Copier"}
                          </button>
                        </div>
                        <pre className="flex-1 bg-white p-4 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 overflow-auto whitespace-pre-wrap leading-relaxed max-h-[400px]">
                          {activeFile.rawText || "Aucun texte généré."}
                        </pre>
                      </div>
                    )}

                    {activeTab === "chunks" && (
                      <div className="h-full flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">
                            {activeFile.chunks?.length || 0} segments
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                            {config.strategy} · {config.size} · overlap {config.overlap}
                          </span>
                        </div>

                        {(!activeFile.chunks || activeFile.chunks.length === 0) ? (
                          <div className="bg-white border rounded-lg p-8 text-center text-slate-400 text-xs">
                            Aucun segment généré.
                          </div>
                        ) : (
                          <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
                            {activeFile.chunks.map((docChunk: Chunk, idx: number) => (
                              <div key={docChunk.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden hover:border-indigo-200 transition-colors">
                                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-500">
                                  <span>#{idx + 1} · {docChunk.charCount} car. · ~{estimateTokens(docChunk.text)} tok.</span>
                                  <div className="flex items-center gap-2">
                                    {docChunk.embedding ? (
                                      <span className="text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
                                        {docChunk.embedding.length}D
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">
                                        non vectorisé
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(docChunk.text, `chunk-${idx}`)}
                                      className="p-1 text-slate-300 hover:text-slate-600 rounded transition"
                                    >
                                      {copiedId === `chunk-${idx}` ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                                    </button>
                                  </div>
                                </div>
                                <p className="p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed">
                                  {docChunk.text}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center p-12 text-center">
                  {activeFile.status === "processing" ? (
                    <div className="space-y-3">
                      <div className="relative w-10 h-10 mx-auto">
                        <div className="absolute inset-0 rounded-full border-2 border-indigo-200 animate-ping" />
                        <div className="absolute inset-1 rounded-full border-2 border-t-indigo-600 animate-spin" />
                      </div>
                      <p className="text-sm font-medium text-slate-700">Conversion en cours…</p>
                    </div>
                  ) : activeFile.status === "error" ? (
                    <div className="space-y-3 max-w-sm mx-auto">
                      <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
                      <p className="text-sm font-medium text-slate-700">Échec du traitement</p>
                      <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2.5 font-mono break-all">
                        {activeFile.error}
                      </p>
                      <button
                        type="button"
                        onClick={() => convertFile(activeFile.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs rounded-lg transition"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Réessayer
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <FileText className="h-10 w-10 text-slate-300 stroke-1 mx-auto" />
                      <p className="text-sm font-medium text-slate-600">En attente de conversion</p>
                      <button
                        type="button"
                        onClick={() => convertFile(activeFile.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg transition active:scale-95"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Convertir
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center border border-slate-200 rounded-xl bg-white p-12 text-center min-h-[300px]">
              <FileText className="h-10 w-10 text-slate-200 stroke-1 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-500">Aucun fichier sélectionné</p>
              <p className="text-xs text-slate-400 mt-1">Importez un document pour commencer.</p>
            </div>
          )}

          {/* Semantic search */}
          <div className="shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-indigo-500" />
              <h3 className="text-xs font-semibold text-slate-700">Recherche sémantique</h3>
              <span className="ml-auto text-[10px] font-mono text-slate-400">{collectionName}</span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && performSearch()}
                  placeholder="Posez une question…"
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50"
                />
                <select
                  value={searchLimit}
                  onChange={(e) => setSearchLimit(Number(e.target.value))}
                  className="px-2 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  <option value={3}>Top 3</option>
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                </select>
                <button
                  type="button"
                  onClick={performSearch}
                  disabled={searchLoading || !searchQuery.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs rounded-lg transition active:scale-95"
                >
                  {searchLoading
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5" />}
                  {searchLoading ? "Recherche…" : "Rechercher"}
                </button>
              </div>

              {searchError && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-mono">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {searchError}
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {searchResults.map((result, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-slate-100 text-[10px] font-mono text-slate-500">
                        <span>#{i + 1} · {result.chunkId}</span>
                        <span className={`font-semibold px-1.5 py-0.5 rounded ${
                          result.score >= 0.8 ? "text-emerald-700 bg-emerald-50"
                          : result.score >= 0.6 ? "text-amber-700 bg-amber-50"
                          : "text-slate-600 bg-slate-100"
                        }`}>
                          {(result.score * 100).toFixed(1)}%
                        </span>
                      </div>
                      <p className="px-3 py-2 text-xs text-slate-800 leading-relaxed line-clamp-4 whitespace-pre-wrap">
                        {result.text}
                      </p>
                      {result.metadata?.source !== undefined && result.metadata?.source !== null && (
                        <div className="px-3 py-1 border-t border-slate-100 text-[10px] text-slate-400 font-mono">
                          {String(result.metadata.source)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {searchResults.length === 0 && !searchLoading && !searchError && (
                <p className="text-[11px] text-slate-400 text-center py-2">
                  Résultats après recherche — assurez-vous d'avoir stocké des fichiers dans Qdrant.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Right sidebar */}
        <aside className="w-full lg:w-[500px] border-l border-slate-200 bg-white p-5 flex flex-col shrink-0 gap-5 overflow-y-auto">
          <ChunkingOptionsPanel config={config} onChange={(newConfig) => setConfig(newConfig)} />

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-indigo-500" />
              Collection Qdrant
            </h3>
            <input
              type="text"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              placeholder="vectorflow"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50"
            />
            <p className="text-[10px] text-slate-400 mt-1.5">
              Créée automatiquement si inexistante.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
            <div>
              <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5 text-indigo-600" />
                Exporter la Collection
              </h3>
              <p className="text-[10px] text-slate-400 mt-1">
                Téléchargez la base de données vectorielle complète pour l'intégrer dans d'autres applications.
              </p>
            </div>

            {exportError && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2.5 font-mono">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {exportError}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {/* SQLite Export Button */}
              <button
                type="button"
                onClick={() => handleExport("sqlite")}
                disabled={Object.values(exportLoading).some(Boolean)}
                className="group relative flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20 text-left transition disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]"
              >
                <div className="w-8 h-8 rounded bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center shrink-0 transition">
                  {exportLoading.sqlite ? (
                    <RefreshCw className="h-4 w-4 text-indigo-600 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4 text-indigo-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-800">Base SQLite (.db)</div>
                  <div className="text-[9px] text-slate-400 truncate">Base relationnelle complète avec embeddings</div>
                </div>
                <Download className="h-3.5 w-3.5 text-slate-400 group-hover:text-indigo-600 transition" />
              </button>

              {/* Qdrant Snapshot Export Button */}
              <button
                type="button"
                onClick={() => handleExport("snapshot")}
                disabled={Object.values(exportLoading).some(Boolean)}
                className="group relative flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50/20 text-left transition disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]"
              >
                <div className="w-8 h-8 rounded bg-violet-50 group-hover:bg-violet-100 flex items-center justify-center shrink-0 transition">
                  {exportLoading.snapshot ? (
                    <RefreshCw className="h-4 w-4 text-violet-600 animate-spin" />
                  ) : (
                    <Archive className="h-4 w-4 text-violet-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-800">Snapshot Qdrant (.snapshot)</div>
                  <div className="text-[9px] text-slate-400 truncate">Export d'archive officiel pour serveur Qdrant</div>
                </div>
                <Download className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-600 transition" />
              </button>

              {/* JSON Export Button */}
              <button
                type="button"
                onClick={() => handleExport("json")}
                disabled={Object.values(exportLoading).some(Boolean)}
                className="group relative flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/20 text-left transition disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]"
              >
                <div className="w-8 h-8 rounded bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center shrink-0 transition">
                  {exportLoading.json ? (
                    <RefreshCw className="h-4 w-4 text-emerald-600 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4 text-emerald-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-800">Format JSON (.json)</div>
                  <div className="text-[9px] text-slate-400 truncate">Export structuré complet avec vecteurs & métadonnées</div>
                </div>
                <Download className="h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-600 transition" />
              </button>

              {/* CSV Export Button */}
              <button
                type="button"
                onClick={() => handleExport("csv")}
                disabled={Object.values(exportLoading).some(Boolean)}
                className="group relative flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 hover:border-amber-300 hover:bg-amber-50/20 text-left transition disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]"
              >
                <div className="w-8 h-8 rounded bg-amber-50 group-hover:bg-amber-100 flex items-center justify-center shrink-0 transition">
                  {exportLoading.csv ? (
                    <RefreshCw className="h-4 w-4 text-amber-600 animate-spin" />
                  ) : (
                    <Table className="h-4 w-4 text-amber-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-800">Format CSV (.csv)</div>
                  <div className="text-[9px] text-slate-400 truncate">Export tabulaire simple, idéal tableurs/scripts</div>
                </div>
                <Download className="h-3.5 w-3.5 text-slate-400 group-hover:text-amber-600 transition" />
              </button>
            </div>
          </div>
        </aside>
      </main>

    </div>
  );
}
