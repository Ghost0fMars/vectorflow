import express from "express";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import os from "os";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
import { QdrantClient } from "@qdrant/js-client-rest";
import mammoth from "mammoth";
import JSZip from "jszip";

dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

const app = express();
const PORT = parseInt(process.env.PORT || "5000");

// Increase payload limit to handle documents and audio base64 uploads
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

// Ollama configuration
const USE_OLLAMA = process.env.USE_OLLAMA === "true";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text:latest";
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "gemma3:12b";

// Python embedding server (embed_server.py, port 8001 - fallback)
const EMBED_URL = (process.env.EMBED_LLM_URL || "http://localhost:8001") + "/v1/embeddings";
const EMBED_MODEL = process.env.EMBED_MODEL || "intfloat/multilingual-e5-base";

async function computeEmbeddings(texts: string[]): Promise<number[][]> {
  if (USE_OLLAMA) {
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: texts, model: OLLAMA_EMBED_MODEL }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Ollama embedding error ${resp.status}: ${body}`);
      }

      const json = await resp.json() as { embeddings: number[][] };
      return json.embeddings;
    } catch (e: any) {
      if (e?.cause?.code === "ECONNREFUSED" || e?.message?.includes("fetch failed")) {
        throw new Error(
          `Ollama est injoignable (${OLLAMA_URL}). Assurez-vous qu'Ollama est démarré et que le modèle '${OLLAMA_EMBED_MODEL}' est installé (ex: ollama pull ${OLLAMA_EMBED_MODEL}).`
        );
      }
      throw e;
    }
  } else {
    let resp: Response;
    try {
      resp = await fetch(EMBED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: texts, model: EMBED_MODEL }),
      });
    } catch (e: any) {
      if (e?.cause?.code === "ECONNREFUSED") {
        throw new Error(
          `Le serveur d'embeddings est injoignable (${EMBED_URL}). Lancez-le avec : python3 embed_server.py ou activez Ollama dans le fichier .env.`
        );
      }
      throw e;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Embedding server ${resp.status}: ${body}`);
    }
    const json = await resp.json() as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

async function generateSummaryAndKeywords(text: string): Promise<{ summary: string; keywords: string[] }> {
  const maxChars = 8000;
  const truncatedText = text.length > maxChars ? text.slice(0, maxChars) + "..." : text;

  try {
    const prompt = `Analyse le texte suivant et retourne un objet JSON contenant exactement deux clés:
- "summary": un résumé clair, informatif et concis du texte en français (environ 2-3 phrases).
- "keywords": une liste de 3 à 5 mots-clés importants en français.

Texte à analyser :
${truncatedText}`;

    const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_CHAT_MODEL,
        prompt,
        format: "json",
        stream: false,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Ollama generation failed with status ${resp.status}: ${errText}`);
    }

    const json = await resp.json() as { response: string };
    const parsed = JSON.parse(json.response) as { summary: string; keywords: string[] };

    return {
      summary: parsed.summary || "Aucun résumé disponible",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch (e: any) {
    console.error("Failed to generate AI enrichment with Ollama:", e);
    return {
      summary: "Description non disponible (erreur d'enrichissement IA)",
      keywords: [],
    };
  }
}

// MIME types that can be decoded from base64 to plain text
function isTextDecodable(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/x-yaml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/typescript"
  );
}

// Initialize Qdrant client lazily
const QDRANT_VECTOR_SIZE = parseInt(process.env.EMBED_VECTOR_SIZE || "768"); // multilingual-e5-base hidden size

let qdrantClient: QdrantClient | null = null;
function getQdrantClient(): QdrantClient {
  if (!qdrantClient) {
    const url = process.env.QDRANT_URL || "http://localhost:6333";
    const apiKey = process.env.QDRANT_API_KEY || undefined;
    qdrantClient = new QdrantClient({ url, apiKey });
  }
  return qdrantClient;
}

// Ensure a Qdrant collection exists with cosine similarity
async function ensureCollection(client: QdrantClient, name: string): Promise<void> {
  const { collections } = await client.getCollections();
  if (!collections.some((c) => c.name === name)) {
    await client.createCollection(name, {
      vectors: { size: QDRANT_VECTOR_SIZE, distance: "Cosine" },
    });
  }
}

// Run a command and return its stdout decoded as UTF-8 from raw bytes.
// This avoids mojibake when the system locale is not UTF-8 (e.g. pdftotext/tesseract output).
function execFileUtf8(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(Buffer.from(stdout as unknown as Buffer).toString("utf8"));
    });
  });
}

// Convert an arbitrary string ID to a deterministic UUID for Qdrant
function toUUID(id: string): string {
  const h = crypto.createHash("sha256").update(id).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// REST API endpoint to convert files to plain text and extract metadata
app.post("/api/convert", async (req, res) => {
  try {
    const { name, mimeType, base64 } = req.body;

    if (!name || !mimeType || !base64) {
      return res.status(400).json({
        success: false,
        error: "Missing parameters: 'name', 'mimeType', and 'base64' are required.",
      });
    }

    const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
    const decodedSize = Math.floor((base64.length * 3) / 4);
    if (decodedSize > MAX_FILE_BYTES) {
      return res.status(413).json({
        success: false,
        error: `Fichier trop volumineux (${(decodedSize / 1024 / 1024).toFixed(1)} Mo). La limite est de ${MAX_FILE_BYTES / 1024 / 1024} Mo.`,
      });
    }

    let fileContent: string;

    if (mimeType === "application/pdf") {
      const buffer = Buffer.from(base64, "base64");
      const tmpDir = path.join(os.tmpdir(), `vf_${Date.now()}`);
      fs.mkdirSync(tmpDir);
      const tmpFile = path.join(tmpDir, "input.pdf");
      try {
        fs.writeFileSync(tmpFile, buffer);

        // Attempt 1: pdftotext (fast, native text PDFs)
        const pdfText = await execFileUtf8("pdftotext", ["-layout", "-enc", "UTF-8", tmpFile, "-"]);

        const { stdout: pdfInfo } = await execFileAsync("pdfinfo", [tmpFile]).catch(() => ({ stdout: "" }));
        const pageMatch = pdfInfo.match(/Pages:\s+(\d+)/);
        const pageCount = pageMatch ? parseInt(pageMatch[1]) : 1;
        const charsPerPage = pdfText.replace(/\s/g, "").length / pageCount;

        if (charsPerPage >= 100) {
          fileContent = pdfText;
        } else {
          // Attempt 2: OCR via pdftoppm + tesseract (scanned PDFs)
          const imgPrefix = path.join(tmpDir, "page");
          await execFileAsync("pdftoppm", ["-r", "300", "-png", tmpFile, imgPrefix]);

          const pages = fs.readdirSync(tmpDir)
            .filter((f) => f.endsWith(".png"))
            .sort();

          if (pages.length === 0) throw new Error("pdftoppm n'a produit aucune image.");

          const pageTexts: string[] = [];
          for (const p of pages) {
            const text = await execFileUtf8("tesseract", [
              path.join(tmpDir, p), "stdout", "-l", "fra+eng", "--psm", "1",
            ]);
            pageTexts.push(text);
          }
          fileContent = pageTexts.join("\n\n");
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      if (!fileContent.trim()) {
        return res.status(422).json({
          success: false,
          error: "Impossible d'extraire du texte de ce PDF (protégé ou image sans contenu reconnaissable).",
        });
      }
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      const buffer = Buffer.from(base64, "base64");
      const result = await mammoth.extractRawText({ buffer });
      fileContent = result.value;
    } else if (mimeType === "application/vnd.oasis.opendocument.text") {
      const buffer = Buffer.from(base64, "base64");
      const zip = await JSZip.loadAsync(buffer);
      const contentXml = await zip.file("content.xml")?.async("string");
      if (!contentXml) throw new Error("Fichier ODT invalide : content.xml introuvable.");
      fileContent = contentXml
        .replace(/<text:line-break[^/]*/g, "\n")
        .replace(/<\/text:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, "\n\n");
    } else if (isTextDecodable(mimeType)) {
      fileContent = Buffer.from(base64, "base64").toString("utf-8");
    } else {
      return res.status(415).json({
        success: false,
        error: `Le type de fichier "${mimeType}" n'est pas supporté en mode local. Formats acceptés : PDF, DOCX, ODT, TXT, CSV, JSON, XML, Markdown, code source. Les images et fichiers audio nécessitent un modèle multimodal.`,
      });
    }

    const rawText = fileContent.trim();

    let summary = "Description non disponible";
    let keywords: string[] = [];

    // Check if the user requested AI enrichment and Ollama is active
    if (req.body.enrichWithAI && USE_OLLAMA) {
      const enrichment = await generateSummaryAndKeywords(rawText);
      summary = enrichment.summary;
      keywords = enrichment.keywords;
    }

    res.json({
      success: true,
      rawText,
      markdownText: rawText,
      summary,
      keywords,
    });

  } catch (error: any) {
    console.error("Full file conversion error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Erreur lors du traitement du fichier par le modèle local.",
    });
  }
});

// REST API endpoint to generate vector embeddings from text chunks
app.post("/api/embed", async (req, res) => {
  try {
    const { chunks } = req.body as { chunks: { id: string; text: string }[] };

    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Le paramètre 'chunks' est requis (tableau non vide).",
      });
    }

    const BATCH_SIZE = 64;
    const allEmbeddings: { id: string; vector: number[] }[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await computeEmbeddings(batch.map((c) => c.text));
      batch.forEach((c, idx) => {
        allEmbeddings.push({ id: c.id, vector: vectors[idx] });
      });
    }

    res.json({ success: true, embeddings: allEmbeddings });
  } catch (error: any) {
    console.error("Embedding error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Erreur lors de la génération des embeddings.",
    });
  }
});

// REST API endpoint to store embedded chunks in Qdrant
app.post("/api/store", async (req, res) => {
  try {
    const { collectionName, chunks } = req.body as {
      collectionName: string;
      chunks: {
        id: string;
        text: string;
        embedding: number[];
        metadata: Record<string, unknown>;
      }[];
    };

    if (!collectionName || !chunks?.length) {
      return res.status(400).json({
        success: false,
        error: "'collectionName' et 'chunks' (non vide) sont requis.",
      });
    }

    const client = getQdrantClient();
    await ensureCollection(client, collectionName);

    const points = chunks.map((c) => ({
      id: toUUID(c.id),
      vector: c.embedding,
      payload: { chunk_id: c.id, text: c.text, ...c.metadata },
    }));

    await client.upsert(collectionName, { wait: true, points });

    res.json({ success: true, stored: points.length, collection: collectionName });
  } catch (error: any) {
    console.error("Qdrant store error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Erreur lors du stockage dans Qdrant.",
    });
  }
});

// REST API endpoint to list existing Qdrant collections
app.get("/api/collections", async (_req, res) => {
  try {
    const client = getQdrantClient();
    const { collections } = await client.getCollections();

    const detailed = await Promise.all(
      collections.map(async (c) => {
        try {
          const info = await client.getCollection(c.name);
          return { name: c.name, vectorsCount: info.indexed_vectors_count ?? 0 };
        } catch {
          return { name: c.name, vectorsCount: 0 };
        }
      })
    );

    res.json({ success: true, collections: detailed });
  } catch (error: any) {
    console.error("Qdrant list error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Impossible de contacter Qdrant.",
    });
  }
});

// REST API endpoint for semantic search in Qdrant
app.post("/api/search", async (req, res) => {
  try {
    const { query, collectionName, limit = 5 } = req.body as {
      query: string;
      collectionName: string;
      limit?: number;
    };

    if (!query || !collectionName) {
      return res.status(400).json({
        success: false,
        error: "'query' et 'collectionName' sont requis.",
      });
    }

    const [queryVector] = await computeEmbeddings([query]);

    // Search similar vectors in Qdrant
    const client = getQdrantClient();
    const hits = await client.search(collectionName, {
      vector: queryVector,
      limit,
      with_payload: true,
    });

    const results = hits.map((h) => ({
      score: h.score,
      text: h.payload?.text ?? "",
      chunkId: h.payload?.chunk_id ?? String(h.id),
      metadata: Object.fromEntries(
        Object.entries(h.payload ?? {}).filter(([k]) => k !== "text")
      ),
    }));

    res.json({ success: true, results });
  } catch (error: any) {
    console.error("Qdrant search error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Erreur lors de la recherche sémantique.",
    });
  }
});

// REST API endpoint to synthesize a response using RAG and Ollama
app.post("/api/synthesize", async (req, res) => {
  try {
    const { query, results } = req.body as {
      query: string;
      results: { score: number; text: string }[];
    };

    if (!query || !results || !Array.isArray(results)) {
      return res.status(400).json({
        success: false,
        error: "'query' et 'results' sont requis.",
      });
    }

    if (!USE_OLLAMA) {
      return res.status(400).json({
        success: false,
        error: "La synthèse de réponses nécessite d'activer Ollama (USE_OLLAMA=true dans le fichier .env).",
      });
    }

    if (results.length === 0) {
      return res.json({
        success: true,
        answer: "Aucun segment trouvé pour répondre à la question.",
      });
    }

    const context = results.map((r, i) => `[Segment #${i + 1}]\n${r.text}`).join("\n\n");

    const prompt = `Tu es un assistant IA expert. Réponds à la question de l'utilisateur de manière précise, claire et exhaustive en français en te basant UNIQUEMENT sur les segments de document fournis ci-dessous.
Si les segments ne contiennent pas l'information pour répondre, dis-le poliment mais ne tente pas d'inventer.

=== SEGMENTS DE DOCUMENT ===
${context}
============================

Question : ${query}

Réponse synthétisée en français :`;

    const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_CHAT_MODEL,
        prompt,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Ollama generation failed with status ${resp.status}: ${errText}`);
    }

    const json = await resp.json() as { response: string };
    
    res.json({
      success: true,
      answer: json.response.trim(),
    });
  } catch (error: any) {
    console.error("Synthesize error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Erreur lors de la génération de la réponse.",
    });
  }
});

// Helper function to scroll and retrieve all points from a Qdrant collection
async function scrollAllPoints(collectionName: string): Promise<any[]> {
  const client = getQdrantClient();
  let offset: any = null;
  const allPoints: any[] = [];
  do {
    const response = await client.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: true,
      with_vector: true,
    });
    allPoints.push(...response.points);
    offset = response.next_page_offset;
  } while (offset !== null);
  return allPoints;
}

// Utility to escape CSV cell contents
function escapeCSV(val: any): string {
  if (val === undefined || val === null) return "";
  let str = typeof val === "string" ? val : JSON.stringify(val);
  str = str.replace(/"/g, '""');
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str}"`;
  }
  return str;
}

// JSON export endpoint
app.get("/api/export/json", async (req, res) => {
  try {
    const { collection } = req.query;
    if (!collection || typeof collection !== "string") {
      return res.status(400).json({ success: false, error: "Le paramètre 'collection' est requis." });
    }
    const points = await scrollAllPoints(collection);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=${collection}_export.json`);
    res.send(JSON.stringify({ collection, points }, null, 2));
  } catch (error: any) {
    console.error("JSON export error:", error);
    res.status(500).json({ success: false, error: error.message || "Erreur lors de l'exportation JSON." });
  }
});

// CSV export endpoint
app.get("/api/export/csv", async (req, res) => {
  try {
    const { collection } = req.query;
    if (!collection || typeof collection !== "string") {
      return res.status(400).json({ success: false, error: "Le paramètre 'collection' est requis." });
    }
    const points = await scrollAllPoints(collection);
    
    let csv = "\uFEFFid,document_name,chunk_index,text,metadata,embedding\n";
    for (const p of points) {
      const payload = p.payload || {};
      const id = p.id;
      const docName = payload.source || payload.fileName || "";
      const chunkIndex = payload.chunkIndex ?? "";
      const text = payload.text || "";
      
      const metadata = { ...payload };
      delete metadata.text;
      const metadataStr = JSON.stringify(metadata);
      
      const embeddingStr = p.vector ? JSON.stringify(p.vector) : "";
      
      csv += `${escapeCSV(id)},${escapeCSV(docName)},${escapeCSV(chunkIndex)},${escapeCSV(text)},${escapeCSV(metadataStr)},${escapeCSV(embeddingStr)}\n`;
    }
    
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${collection}_export.csv`);
    res.send(csv);
  } catch (error: any) {
    console.error("CSV export error:", error);
    res.status(500).json({ success: false, error: error.message || "Erreur lors de l'exportation CSV." });
  }
});

// SQLite export endpoint (calls export_sqlite.py script)
app.get("/api/export/sqlite", async (req, res) => {
  try {
    const { collection } = req.query;
    if (!collection || typeof collection !== "string") {
      return res.status(400).json({ success: false, error: "Le paramètre 'collection' est requis." });
    }
    const points = await scrollAllPoints(collection);
    
    const tmpDir = path.join(os.tmpdir(), `vf_sql_${Date.now()}`);
    fs.mkdirSync(tmpDir);
    const jsonPath = path.join(tmpDir, "data.json");
    const dbPath = path.join(tmpDir, `${collection}.db`);
    
    try {
      fs.writeFileSync(jsonPath, JSON.stringify({ points }));
      
      // Execute the python script to convert JSON to SQLite db
      await execFileAsync("python3", ["export_sqlite.py", jsonPath, dbPath]);
      
      if (!fs.existsSync(dbPath)) {
        throw new Error("Le fichier SQLite n'a pas été généré.");
      }
      
      res.download(dbPath, `${collection}.db`, (err) => {
        // Cleanup after download completes
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.error("Cleanup error:", cleanupErr);
        }
      });
    } catch (innerErr: any) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      throw innerErr;
    }
  } catch (error: any) {
    console.error("SQLite export error:", error);
    res.status(500).json({ success: false, error: error.message || "Erreur lors de l'exportation SQLite." });
  }
});

// Qdrant Snapshot export endpoint
app.get("/api/export/snapshot", async (req, res) => {
  try {
    const { collection } = req.query;
    if (!collection || typeof collection !== "string") {
      return res.status(400).json({ success: false, error: "Le paramètre 'collection' est requis." });
    }
    
    const client = getQdrantClient();
    const snapshotInfo = await client.createSnapshot(collection);
    const snapshotName = (snapshotInfo as any).name || (snapshotInfo as any).result?.name;
    
    if (!snapshotName) {
      throw new Error("Impossible d'obtenir le nom du snapshot créé depuis Qdrant.");
    }
    
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
    const apiKey = process.env.QDRANT_API_KEY;
    const downloadUrl = `${qdrantUrl}/collections/${collection}/snapshots/${snapshotName}`;
    
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["api-key"] = apiKey;
    }
    
    const response = await fetch(downloadUrl, { headers });
    if (!response.ok) {
      throw new Error(`Échec du téléchargement du snapshot depuis Qdrant: ${response.statusText}`);
    }
    
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename=${snapshotName}`);
    
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error("Snapshot export error:", error);
    res.status(500).json({ success: false, error: error.message || "Erreur lors de l'exportation du snapshot Qdrant." });
  }
});


async function checkOllamaConnection() {
  if (!USE_OLLAMA) return;

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (resp.ok) {
      const data = await resp.json() as { models: { name: string }[] };
      const modelNames = data.models.map(m => m.name);
      console.log("\x1b[32m%s\x1b[0m", "✓ Ollama connecté avec succès !");
      console.log("Modèles disponibles dans Ollama :", modelNames.join(", "));
      
      const hasEmbed = modelNames.some(name => name.startsWith(OLLAMA_EMBED_MODEL));
      if (!hasEmbed) {
        console.log("\x1b[33m%s\x1b[0m", `⚠ Attention : Le modèle d'embedding '${OLLAMA_EMBED_MODEL}' n'est pas détecté dans Ollama.`);
        console.log(`Exécutez : ollama pull ${OLLAMA_EMBED_MODEL}`);
      }

      const hasChat = modelNames.some(name => name.startsWith(OLLAMA_CHAT_MODEL));
      if (!hasChat) {
        console.log("\x1b[33m%s\x1b[0m", `⚠ Attention : Le modèle de chat/synthèse '${OLLAMA_CHAT_MODEL}' n'est pas détecté dans Ollama.`);
        console.log(`Exécutez : ollama pull ${OLLAMA_CHAT_MODEL}`);
      }
    } else {
      console.log("\x1b[33m%s\x1b[0m", `⚠ Impossible de lister les modèles Ollama : ${resp.statusText}`);
    }
  } catch (e: any) {
    console.log("\x1b[31m%s\x1b[0m", `✗ Impossible de contacter Ollama sur ${OLLAMA_URL}.`);
    console.log("Assurez-vous qu'Ollama est démarré et fonctionne.");
  }
}

// Setup dev server or static serve logic
async function bootstrap() {
  // Run diagnostics for Ollama connection if active
  await checkOllamaConnection();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev server middleware integrated.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving production static assets from:", distPath);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Application available at http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Error starting server:", err);
});
