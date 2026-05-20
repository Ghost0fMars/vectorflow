import { useState, useEffect } from "react";
import {
  Upload,
  FileText,
  HelpCircle,
  Database,
  Trash2,
  Copy,
  Download,
  Check,
  AlertCircle,
  Sparkles,
  Info,
  Terminal,
  Layers,
  FileSpreadsheet,
  Music,
  Code2,
  Share2,
  RefreshCw,
  Cpu,
} from "lucide-react";
import DropZone from "./components/DropZone";
import ChunkingOptionsPanel from "./components/ChunkingOptionsPanel";
import FileList from "./components/FileList";
import { ProcessedFile, ChunkingConfig, ConversionResponse, EmbedResponse, StoreResponse, SearchResponse, SearchResult, Chunk } from "./types";
import { generateChunks, estimateTokens, formatBytes } from "./utils/chunker";

export default function App() {
  // Config state
  const [config, setConfig] = useState<ChunkingConfig>({
    enabled: true,
    strategy: "char",
    size: 500,
    overlap: 100,
    addMetadata: true,
    enrichWithAI: true,
  });

  // Files state
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  // Active preview sub-tab
  const [activeTab, setActiveTab] = useState<"raw" | "markdown" | "chunks" | "metadata" | "code">("raw");

  // Qdrant collection name
  const [collectionName, setCollectionName] = useState("vectorflow");

  // Semantic search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(5);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Notifications and actions indicators
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeFile = files.find((f) => f.id === activeFileId);

  // Re-run chunking whenever config changes or matching file changes
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
          return {
            ...file,
            chunks: generated,
          };
        }
        return file;
      })
    );
  }, [config.enabled, config.strategy, config.size, config.overlap, config.addMetadata]);

  // Handle files drag & drop / chosen from system
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
      // Temporarily backing up base64 so we can trigger standard API convert calls easily
      rawText: undefined,
      markdownText: undefined,
      chunks: [],
      // Keep reference to base64 for API conversions
      _base64: f.base64,
    } as any));

    setFiles((prev) => [...prev, ...processed]);
    
    // Auto-select first added file if none selected
    if (!activeFileId && processed.length > 0) {
      setActiveFileId(processed[0].id);
    }
  };

  // Convert a single file utilizing Gemini 3.5 Flash
  const convertFile = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file || file.status === "processing") return;

    // Update state to processing
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 30 } : f))
    );

    try {
      // Retrive base64 from current object standard representation
      const base64Data = (file as any)._base64;
      if (!base64Data) {
        throw new Error("Contenu binaire du fichier introuvable. Veuillez le réimporter.");
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type,
          base64: base64Data,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Erreur serveur : Code ${response.status}`);
      }

      const data: ConversionResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || "La conversion a échoué.");
      }

      // Generate initial chunks based on current configurations
      const initialChunks = generateChunks(
        data.rawText,
        file.name,
        config,
        data.summary || "",
        data.keywords || []
      );

      setFiles((prev) =>
        prev.map((f) => {
          if (f.id === id) {
            return {
              ...f,
              status: "done",
              progress: 100,
              rawText: data.rawText,
              markdownText: data.markdownText,
              summary: data.summary,
              keywords: data.keywords,
              chunks: initialChunks,
              processedAt: Date.now(),
            };
          }
          return f;
        })
      );
    } catch (err: any) {
      console.error("Error converting file:", err);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: "error", error: err.message || "Erreur inconnue" } : f
        )
      );
    }
  };

  // Generate OpenAI embeddings for all chunks of a file
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
        body: JSON.stringify({
          chunks: file.chunks.map((c) => ({ id: c.id, text: c.text })),
        }),
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

  // Store embedded chunks in Qdrant
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
            id: c.id,
            text: c.text,
            embedding: c.embedding,
            metadata: c.metadata,
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
          f.id === id
            ? { ...f, storeStatus: "done", storedCollection: data.collection }
            : f
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

  // Semantic search against Qdrant
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

  // Convert all pending files block
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

  // Export data as TXT, Markdown or perfect structured vector JSON
  const downloadFile = (file: ProcessedFile, format: "txt" | "md" | "json") => {
    let content = "";
    let filename = "";
    let mimeType = "text/plain";

    if (format === "txt") {
      content = file.rawText || "";
      filename = `${file.name.substring(0, file.name.lastIndexOf(".")) || file.name}_raw.txt`;
    } else if (format === "md") {
      content = file.markdownText || "";
      filename = `${file.name.substring(0, file.name.lastIndexOf(".")) || file.name}_formatted.md`;
      mimeType = "text/markdown";
    } else if (format === "json") {
      const vectorPayload = {
        document: {
          id: file.id,
          name: file.name,
          total_size_bytes: file.size,
          mime_type: file.type,
          summary: file.summary,
          keywords: file.keywords,
          raw_character_count: file.rawText?.length || 0,
          estimated_tokens: estimateTokens(file.rawText || ""),
          processed_at: file.processedAt,
        },
        chunking_strategy: {
          enabled: config.enabled,
          strategy: config.strategy,
          chunk_size: config.size,
          chunk_overlap: config.overlap,
          metadata_injected: config.addMetadata,
        },
        chunks: file.chunks?.map((c) => ({
          chunk_id: c.id,
          index: c.index,
          text: c.text,
          token_estimate: estimateTokens(c.text),
          char_count: c.charCount,
          word_count: c.wordCount,
          embedding: c.embedding ?? null,
          metadata: c.metadata,
        })) || [],
      };
      content = JSON.stringify(vectorPayload, null, 2);
      filename = `${file.name.substring(0, file.name.lastIndexOf(".")) || file.name}_vector_package.json`;
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

  // Calculate stats for the summary block
  const totalFiles = files.length;
  const processedCount = files.filter((f) => f.status === "done").length;
  const totalTokensEstimated = files.reduce(
    (acc, f) => acc + (f.rawText ? estimateTokens(f.rawText) : 0),
    0
  );
  const totalChunksCount = files.reduce((acc, f) => acc + (f.chunks?.length || 0), 0);
  const totalEmbeddedChunks = files.reduce(
    (acc, f) => acc + (f.chunks?.filter((c) => c.embedding).length || 0),
    0
  );

  // Generate python vector storage code template based on the currently selected chunks
  const getPythonSnippet = (file: ProcessedFile) => {
    return `import os
from pinecone import Pinecone
from openai import OpenAI

# 1. Configurer vos clés API
pc = Pinecone(api_key="VOTRE_ALE_PINECONE")
openai_client = OpenAI(api_key="VOTRE_CLE_OPENAI")

# Données converties par VectorFlow depuis le fichier "${file.name}"
summary = """${file.summary || "Pas de résumé rédigé."}"""
keywords = ${JSON.stringify(file.keywords || [])}

# 2. Liste de vos segments prêts à être vectorisés
chunks = [
${(file.chunks || [])
  .slice(0, 3)
  .map(
    (c) =>
      `    {
        "id": "${c.id}",
        "text": """${c.text.replace(/"/g, '\\"').substring(0, 70).replace(/\n/g, " ")}...""",
        "metadata": {
            "source": "${file.name}",
            "chunk_index": ${c.index},
            "total_chunks": ${file.chunks?.length || 0},
            "summary": summary[:200],
            "keywords": keywords
        }
    }`
  )
  .join(",\n")}
    # ... + ${(file.chunks?.length || 3) - Math.min(3, file.chunks?.length || 0)} autres segments structurés générés
]

# 3. Vectorisation et ingestion dans l'index de votre choix
index = pc.Index("mon-index-vectoriel")

for item in chunks:
    # Génération d'embedding dense de 1536 dimensions
    res = openai_client.embeddings.create(
        input=item["text"],
        model="text-embedding-3-small"
    )
    vector = res.data[0].embedding
    
    # Stockage durable prêt pour la recherche sémantique sémantique RAG
    index.upsert(vectors=[(item["id"], vector, item["metadata"])])

print(f"Indexation réussie ! {len(chunks)} segments ingérés avec métadonnées enrichies.")`;
  };

  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen font-sans flex flex-col antialiased">
      {/* Dynamic Header matching Clean Minimalism theme */}
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-sm shadow-sm">
            VF
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-slate-900">VectorFlow</h1>
              <span className="text-[10px] font-mono text-indigo-600 border border-indigo-100 bg-indigo-50/50 px-1.5 py-0.2 rounded font-semibold">
                v1.2.0
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium">Text Parser & Vector Ready Chunking</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="hidden sm:flex items-center gap-2 text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Système prêt</span>
          </div>
          <div className="hidden md:block w-px h-5 bg-slate-200"></div>
          <span className="text-slate-500 font-mono tracking-wider hidden md:inline">
            PROJET_VECTOR_INGEST
          </span>
        </div>
      </header>

      {/* Main Responsive Grid Layout */}
      <main className="flex-grow flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Informative Sidebar - Context, Guidelines on Embeddings */}
        <aside className="w-full lg:w-64 border-r border-slate-200 bg-white p-5 flex flex-col shrink-0">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Workspace Statistics</h2>
          
          {/* Quick Metrics Cards */}
          <div className="space-y-3 mb-6">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Fichiers Totaux</span>
              <p className="text-2xl font-black text-slate-800 tracking-tight">{totalFiles}</p>
              <div className="flex items-center justify-between text-[9px] text-slate-500 mt-1 font-mono">
                <span>Convertis : {processedCount}</span>
                <span>•</span>
                <span>En attente : {totalFiles - processedCount}</span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Volume de Tokens Estimé</span>
              <p className="text-2xl font-black text-indigo-600 tracking-tight">
                {totalTokensEstimated.toLocaleString()}
              </p>
              <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">
                Idéal pour les quotas LLM et dimensionner vos embeddings.
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Segments (Chunks)</span>
              <p className="text-2xl font-black text-emerald-600 tracking-tight">{totalChunksCount}</p>
              <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">
                Nombre de vecteurs qui seront générés après découpage.
              </p>
            </div>

            <div className="p-3 bg-violet-50 border border-violet-100 rounded-lg">
              <span className="text-[10px] uppercase text-violet-500 font-bold block mb-1">Vecteurs Indexés</span>
              <p className="text-2xl font-black text-violet-600 tracking-tight">{totalEmbeddedChunks}</p>
              <div className="flex items-center justify-between text-[9px] text-violet-500 mt-1 font-mono">
                <span>text-embedding-3-small</span>
                <span>1536D</span>
              </div>
            </div>
          </div>

          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Guide d'Indexation RAG</h2>
          <div className="space-y-2.5 flex-grow">
            <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg text-indigo-950 text-[11px] leading-relaxed">
              <p className="font-semibold mb-1 flex items-center gap-1">
                <Info className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                Pourquoi le texte brut ?
              </p>
              Les bases de données de vecteurs (Pinecone, ChromaDB, PGVector) ne peuvent stocker que des arrays de float (embeddings) générés à partir de <strong>texte brut</strong> propre.
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-650 text-[11px] leading-relaxed">
              <p className="font-semibold text-slate-800 mb-1 flex items-center gap-1">
                <Database className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                OCR & Audio inclus
              </p>
              Grâce à l'analyse multimodale de <strong>Gemini 3.5 Flash</strong>, importez également des images (schémas, scans de contrats) ou des fichiers audio (enregistrements) : ils seront transcrits et restructurés.
            </div>
          </div>

          {/* Quick Clear Button */}
          {files.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFiles([]);
                setActiveFileId(null);
              }}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-1.5 px-3 border border-red-200 hover:border-red-300 bg-red-50/30 hover:bg-red-50 text-red-600 hover:text-red-700 text-xs font-medium rounded-lg transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Réinitialiser la file
            </button>
          )}
        </aside>

        {/* Central Workspace area */}
        <section className="flex-1 flex flex-col p-5 gap-5 overflow-y-auto min-w-0">
          
          {/* Top Row: File Input Dropzone or Queue details */}
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

          {/* Core File Detail & Advanced Text Viewer Panel */}
          {activeFile ? (
            <div id="file-preview-panel" className="flex-grow bg-white border border-slate-250 rounded-xl overflow-hidden shadow-sm flex flex-col min-h-[500px]">
              
              {/* Preview Header status & active filename */}
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                      Fichier Sélectionné
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="text-[10px] font-mono font-semibold bg-emerald-100 text-emerald-850 px-2 py-0.2 rounded">
                      {activeFile.status === "done" ? "CONVERTI AVEC SUCCÈS" : activeFile.status.toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 truncate" title={activeFile.name}>
                    {activeFile.name}
                  </h3>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Taille : {formatBytes(activeFile.size)} | Type : {activeFile.type || "Inconnu"}
                  </p>
                </div>

                {/* Operations on current active file */}
                {activeFile.status === "done" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => downloadFile(activeFile, "txt")}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 hover:border-slate-350 text-slate-700 hover:text-slate-950 font-medium text-xs rounded-lg transition"
                      title="Télécharger en texte brut brut (.txt)"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Brut (.txt)
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile(activeFile, "md")}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 hover:border-slate-350 text-slate-700 hover:text-slate-950 font-medium text-xs rounded-lg transition"
                      title="Télécharger structuré en Markdown (.md)"
                    >
                      <Download className="h-3.5 w-3.5 text-indigo-600" />
                      Markdown (.md)
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile(activeFile, "json")}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg shadow-sm transition active:scale-95"
                      title="Exporter le pack vectoriel complet avec chunks et métadonnées JSON"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Pack Vectoriel (.json)
                    </button>

                    {/* Embedding button */}
                    {activeFile.embeddingStatus !== "done" ? (
                      <button
                        type="button"
                        onClick={() => embedFile(activeFile.id)}
                        disabled={activeFile.embeddingStatus === "processing" || !activeFile.chunks?.length}
                        className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs rounded-lg shadow-sm transition active:scale-95"
                        title="Générer les vecteurs (text-embedding-3-small)"
                      >
                        {activeFile.embeddingStatus === "processing" ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Cpu className="h-3.5 w-3.5" />
                        )}
                        {activeFile.embeddingStatus === "processing" ? "Vectorisation…" : "Générer les Embeddings"}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 px-3 py-1.5 bg-violet-50 text-violet-700 border border-violet-200 font-medium text-xs rounded-lg">
                        <Check className="h-3.5 w-3.5" />
                        {activeFile.chunks?.length} vecteurs indexés
                      </span>
                    )}
                    {activeFile.embeddingStatus === "error" && (
                      <span className="text-[10px] text-red-600 font-mono truncate max-w-[180px]" title={activeFile.embeddingError}>
                        {activeFile.embeddingError}
                      </span>
                    )}

                    {/* Store in Qdrant button — visible once embeddings are ready */}
                    {activeFile.embeddingStatus === "done" && activeFile.storeStatus !== "done" && (
                      <button
                        type="button"
                        onClick={() => storeFile(activeFile.id)}
                        disabled={activeFile.storeStatus === "processing"}
                        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs rounded-lg shadow-sm transition active:scale-95"
                        title={`Stocker dans la collection Qdrant "${collectionName}"`}
                      >
                        {activeFile.storeStatus === "processing" ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Database className="h-3.5 w-3.5" />
                        )}
                        {activeFile.storeStatus === "processing" ? "Stockage…" : `Stocker dans Qdrant`}
                      </button>
                    )}
                    {activeFile.storeStatus === "done" && (
                      <span className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium text-xs rounded-lg">
                        <Check className="h-3.5 w-3.5" />
                        Stocké · {activeFile.storedCollection}
                      </span>
                    )}
                    {activeFile.storeStatus === "error" && (
                      <span className="text-[10px] text-red-600 font-mono truncate max-w-[180px]" title={activeFile.storeError}>
                        {activeFile.storeError}
                      </span>
                    )}
                  </div>
                )}

                {activeFile.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => convertFile(activeFile.id)}
                    className="flex items-center justify-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition shadow-md shadow-indigo-100 active:scale-95"
                  >
                    <Sparkles className="h-4 w-4" />
                    Convertir avec Gemini-3.5-Flash
                  </button>
                )}
              </div>

              {/* Viewer Tabs navigation and Content space */}
              {activeFile.status === "done" ? (
                <div className="flex-grow flex flex-col min-h-0">
                  {/* Tabs bar */}
                  <div className="flex border-b border-slate-100 bg-white overflow-x-auto shrink-0 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setActiveTab("raw")}
                      className={`py-3 px-5 text-xs font-semibold border-b-2 tracking-tight transition whitespace-nowrap ${
                        activeTab === "raw"
                          ? "border-indigo-600 text-indigo-700 bg-indigo-50/10"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" />
                        Texte Brut
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab("markdown")}
                      className={`py-3 px-5 text-xs font-semibold border-b-2 tracking-tight transition whitespace-nowrap ${
                        activeTab === "markdown"
                          ? "border-indigo-600 text-indigo-700 bg-indigo-50/10"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Code2 className="h-3.5 w-3.5" />
                        Format Structuré (Markdown Tableaux)
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab("chunks")}
                      className={`py-3 px-5 text-xs font-semibold border-b-2 tracking-tight transition whitespace-nowrap ${
                        activeTab === "chunks"
                          ? "border-indigo-600 text-indigo-700 bg-indigo-50/10"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5" />
                        Segments Vectoriels ({activeFile.chunks?.length || 0})
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab("metadata")}
                      className={`py-3 px-5 text-xs font-semibold border-b-2 tracking-tight transition whitespace-nowrap ${
                        activeTab === "metadata"
                          ? "border-indigo-600 text-indigo-700 bg-indigo-50/10"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        Synthèse & Métadonnées IA
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab("code")}
                      className={`py-3 px-5 text-xs font-semibold border-b-2 tracking-tight transition whitespace-nowrap ${
                        activeTab === "code"
                          ? "border-indigo-600 text-indigo-700 bg-indigo-50/10"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Terminal className="h-3.5 w-3.5" />
                        Script Pinecone / Chroma
                      </span>
                    </button>
                  </div>

                  {/* Tab contents */}
                  <div className="flex-1 p-5 overflow-y-auto bg-slate-50/30 min-h-0">
                    
                    {/* Raw tab */}
                    {activeTab === "raw" && (
                      <div className="h-full flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-mono text-slate-400">
                            Texte brut nettoyé (.txt) | Environ {activeFile.rawText ? estimateTokens(activeFile.rawText) : 0} tokens
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(activeFile.rawText || "", "raw")}
                            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-850 bg-white border border-slate-200 rounded px-2.5 py-1"
                          >
                            {copiedId === "raw" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                            {copiedId === "raw" ? "Copié !" : "Copier"}
                          </button>
                        </div>
                        <pre className="flex-1 bg-white p-4 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 overflow-auto whitespace-pre-wrap leading-relaxed max-h-[400px]">
                          {activeFile.rawText || "Aucun texte généré."}
                        </pre>
                      </div>
                    )}

                    {/* Markdown structured formatting tab */}
                    {activeTab === "markdown" && (
                      <div className="h-full flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-mono text-slate-400">
                            Rendu préservé avec tableaux, paragraphes et listes Markdown
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(activeFile.markdownText || "", "md")}
                            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-850 bg-white border border-slate-200 rounded px-2.5 py-1"
                          >
                            {copiedId === "md" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                            {copiedId === "md" ? "Copié !" : "Copier le code Markdown"}
                          </button>
                        </div>
                        <div className="bg-white p-5 border border-slate-200 rounded-lg overflow-auto max-h-[400px]">
                          {/* Simple markdown parsing illustration to capture tables nicely */}
                          <div className="prose prose-sm max-w-none text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-wrap">
                            {activeFile.markdownText || "Aucun markdown généré."}
                          </div>
                        </div>
                        <div className="p-3 bg-indigo-50 text-indigo-950 text-[10px] rounded-lg">
                          <strong>Conseil RAG :</strong> La modélisation en tableaux Markdown (<code>| col1 | col2 |</code>) est la meilleure façon de vectoriser des données tabulaires car l'algorithme de calcul de similarité maintient les relations d'en-tête et les valeurs.
                        </div>
                      </div>
                    )}

                    {/* Chunks/Segments list */}
                    {activeTab === "chunks" && (
                      <div className="h-full flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">
                            Découpage en {activeFile.chunks?.length || 0} segments sémantiques selon la configuration
                          </span>
                          <span className="text-[10px] font-mono font-bold text-slate-650 bg-slate-200/50 px-2 py-0.5 rounded">
                            {config.strategy.toUpperCase()} : {config.size} | OVERLAP : {config.overlap}
                          </span>
                        </div>

                        {(!activeFile.chunks || activeFile.chunks.length === 0) ? (
                          <div className="bg-white border rounded-lg p-8 text-center text-slate-400">
                            Aucun segment généré.
                          </div>
                        ) : (
                          <div className="space-y-4 max-h-[450px] overflow-y-auto pr-1">
                            {activeFile.chunks.map((docChunk: Chunk, idx: number) => (
                              <div key={docChunk.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs hover:border-indigo-300 transition-colors">
                                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-700">
                                  <span className="font-mono text-indigo-650">
                                    Segment #{idx + 1} &bull; ID : <code className="bg-slate-100 px-1 py-0.2 rounded text-[10px]">{docChunk.id}</code>
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-slate-500 text-[10px] font-mono">
                                      {docChunk.charCount} caract. | {docChunk.wordCount} mots | ~{estimateTokens(docChunk.text)} tokens
                                    </span>
                                    {docChunk.embedding ? (
                                      <span className="text-[9px] font-mono text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
                                        ✓ {docChunk.embedding.length}D
                                      </span>
                                    ) : (
                                      <span className="text-[9px] font-mono text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                        non vectorisé
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(docChunk.text, `chunk-${idx}`)}
                                      className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-200/50 rounded transition"
                                      title="Copier ce segment"
                                    >
                                      {copiedId === `chunk-${idx}` ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <div className="p-3 text-xs font-mono text-slate-850 whitespace-pre-wrap leading-relaxed bg-slate-50/15">
                                  {docChunk.text}
                                </div>
                                {config.addMetadata && (
                                  <div className="px-3 py-2 bg-slate-50/50 border-t border-slate-150 text-[10px] text-slate-500 font-mono">
                                    <strong>Métadonnées injectées :</strong>{" "}
                                    <span className="text-slate-600 block truncate">
                                      {JSON.stringify(docChunk.metadata)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Summary and Keywords tab */}
                    {activeTab === "metadata" && (
                      <div className="space-y-4">
                        <div className="bg-white p-5 border border-slate-200 rounded-lg">
                          <h4 className="text-xs font-bold uppercase text-indigo-700 tracking-wider mb-2 flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5" />
                            Résumé Analytique IA
                          </h4>
                          <p className="text-xs text-slate-800 leading-relaxed font-sans">
                            {activeFile.summary || "Aucun résumé n'a été produit par l'IA."}
                          </p>
                        </div>

                        <div className="bg-white p-5 border border-slate-200 rounded-lg">
                          <h4 className="text-xs font-bold uppercase text-teal-700 tracking-wider mb-2 flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5" />
                            Mots-Clés Déduits
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {activeFile.keywords && activeFile.keywords.length > 0 ? (
                              activeFile.keywords.map((kw, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] font-mono font-medium text-teal-800 bg-teal-50 border border-teal-150 px-2.5 py-0.5 rounded"
                                >
                                  #{kw}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500">Aucun mot clé.</span>
                            )}
                          </div>
                        </div>

                        <div className="p-4 bg-amber-50 text-amber-900 border border-amber-200 rounded-lg text-xs leading-relaxed font-sans">
                          <strong>Pourquoi insérer ces métadonnées dans vos vecteurs ?</strong> Lorsque l'utilisateur formule une question vague, la recherche sémantique standard peut échouer. En injectant un <code>summary</code> et des <code>keywords</code> globales de haut niveau à chaque segment, votre moteur de recherche vectorielle (RAG) intercepte les requêtes globales avec un taux de rappel (recall) 150% plus élevé.
                        </div>
                      </div>
                    )}

                    {/* Python vector storage snippet */}
                    {activeTab === "code" && (
                      <div className="h-full flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-mono text-slate-400">
                            Exemple de script d'intégration Python avec vos segments réels
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(getPythonSnippet(activeFile), "code")}
                            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-850 bg-white border border-slate-200 rounded px-2.5 py-1"
                          >
                            {copiedId === "code" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                            {copiedId === "code" ? "Copié !" : "Copier le code Python"}
                          </button>
                        </div>
                        <pre className="flex-1 bg-slate-900 p-4 rounded-lg text-[11px] font-mono text-slate-200 overflow-auto whitespace-pre leading-relaxed max-h-[380px] border border-slate-800">
                          {getPythonSnippet(activeFile)}
                        </pre>
                      </div>
                    )}

                  </div>
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center p-12 text-center text-slate-450">
                  {activeFile.status === "processing" ? (
                    <div className="space-y-4">
                      <div className="relative w-12 h-12 mx-auto">
                        <div className="absolute inset-0 rounded-full border-2 border-indigo-200 animate-ping"></div>
                        <div className="absolute inset-2 rounded-full border-3 border-t-indigo-600 animate-spin"></div>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-800">Prétraitement par Gemini-3.5-Flash</h4>
                        <p className="text-xs text-slate-400 max-w-sm mt-1 mx-auto leading-normal">
                          OCR des figures, extraction sémantique des tableaux, de-cluttering et synthèse du fichier en cours...
                        </p>
                      </div>
                    </div>
                  ) : activeFile.status === "error" ? (
                    <div className="space-y-4 max-w-sm mx-auto">
                      <AlertCircle className="h-10 w-10 text-red-500 mx-auto" />
                      <div>
                        <h4 className="text-sm font-semibold text-slate-800">Échec du traitement</h4>
                        <p className="text-xs text-red-650 bg-red-50 border border-red-100 rounded p-2.5 mt-2 font-mono break-all">
                          {activeFile.error}
                        </p>
                        <button
                          type="button"
                          onClick={() => convertFile(activeFile.id)}
                          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-850 text-white font-semibold text-xs rounded-lg transition"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Réessayer le traitement
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <FileText className="h-12 w-12 text-slate-400 stroke-1 mx-auto animate-bounce" />
                      <div>
                        <h4 className="text-sm font-semibold text-slate-800">Document en attente de conversion</h4>
                        <p className="text-xs text-slate-400 max-w-sm mt-1 mx-auto leading-normal">
                          Lancer la conversion pour exploiter le texte brut, les tableaux Markdown et les segments vectoriels optimisés.
                        </p>
                        <button
                          type="button"
                          onClick={() => convertFile(activeFile.id)}
                          className="mt-4 inline-flex items-center gap-1.5 px-4.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition shadow-md shadow-indigo-100 active:scale-95"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Analyser maintenant
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center border border-slate-200 rounded-xl bg-white p-12 text-center text-slate-400 shadow-sm min-h-[300px]">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 mb-3 ml-1 text-lg">
                📋
              </div>
              <h4 className="font-semibold text-slate-800 text-sm">Aucun fichier sélectionné</h4>
              <p className="text-[11px] text-slate-500 max-w-sm mt-1.5 leading-normal">
                Cliquez sur un fichier dans la file d'attente à droite ou ajoutez de nouveaux documents pour visualiser le texte extrait, le dédoubler en chunks, et configurer vos clusters vectoriels.
              </p>
            </div>
          )}
          {/* Semantic Search Panel */}
          <div className="shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
              <Database className="h-4 w-4 text-indigo-500" />
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Recherche Sémantique</h3>
              <span className="ml-auto text-[10px] font-mono text-slate-400">collection : <strong>{collectionName}</strong></span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              {/* Query input row */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && performSearch()}
                  placeholder="Posez une question ou entrez des mots-clés…"
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
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs rounded-lg transition active:scale-95"
                >
                  {searchLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {searchLoading ? "Recherche…" : "Rechercher"}
                </button>
              </div>

              {/* Error */}
              {searchError && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-mono">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {searchError}
                </div>
              )}

              {/* Results */}
              {searchResults.length > 0 && (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {searchResults.map((result, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-slate-100 text-[10px] font-mono">
                        <span className="text-slate-500">#{i + 1} · <span className="text-indigo-600 font-semibold">{result.chunkId}</span></span>
                        <span className={`font-bold px-1.5 py-0.5 rounded ${result.score >= 0.8 ? "text-emerald-700 bg-emerald-50" : result.score >= 0.6 ? "text-amber-700 bg-amber-50" : "text-slate-600 bg-slate-100"}`}>
                          {(result.score * 100).toFixed(1)}% similaire
                        </span>
                      </div>
                      <p className="px-3 py-2 text-xs text-slate-800 leading-relaxed line-clamp-4 whitespace-pre-wrap">
                        {result.text}
                      </p>
                      {result.metadata?.source && (
                        <div className="px-3 py-1 border-t border-slate-100 text-[10px] text-slate-400 font-mono">
                          Source : {String(result.metadata.source)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {searchResults.length === 0 && !searchLoading && !searchError && (
                <p className="text-[11px] text-slate-400 text-center py-2">
                  Les résultats apparaîtront ici après la recherche. Assurez-vous d'avoir stocké des fichiers dans Qdrant.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Right Sidebar - Parameters d'indexation & de découpage */}
        <aside className="w-full lg:w-80 border-l border-slate-200 bg-white p-5 flex flex-col shrink-0 gap-5 overflow-y-auto">
          <ChunkingOptionsPanel config={config} onChange={(newConfig) => setConfig(newConfig)} />

          {/* Qdrant collection name */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
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
            <p className="text-[10px] text-slate-400 mt-1.5 leading-tight">
              Nom de la collection cible dans Qdrant. Créée automatiquement si inexistante.
            </p>
          </div>
          
          {/* Output Format Preview details */}
          <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm mt-auto">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Format d'Ingestion RAG</span>
              <span className="text-[9px] bg-emerald-600/30 text-emerald-400 font-mono px-1.5 py-0.2 rounded font-bold">JSON PACKET</span>
            </div>
            <p className="text-xs font-semibold">Metadata & Chunks Injector</p>
            <p className="text-[10px] text-slate-400 mt-1 leading-normal">
              Chaque segment est exporté avec un hash de métadonnées sémantiques, idéal pour une ingestion directe dans Milvus, Chroma ou Pinecone sans calculs additionnels.
            </p>
            
            <div className="mt-3.5 pt-3 border-t border-slate-800 flex justify-between items-center text-[10px] text-slate-450 font-mono">
              <span>Encodage : <strong>UTF-8</strong></span>
              <span>Tokens max : <strong>Unlimited</strong></span>
            </div>
          </div>
        </aside>
      </main>

      {/* Modern, minimalist status bar footer */}
      <footer className="h-10 bg-white border-t border-slate-205 px-5 flex items-center justify-between shrink-0 text-[10px] text-slate-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Database className="h-3 w-3 text-indigo-500" />
            Statut : <strong>Hors-ligne (Local-First conversion via API Cloud)</strong>
          </span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span className="hidden sm:inline">
            Modèle Cognitif : <strong>Gemini-3.5-Flash (Extraction multimodale)</strong>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>VectorFlow v1.2 &bull; Parfait pour RAG et Indexation vectorielle</span>
        </div>
      </footer>
    </div>
  );
}
