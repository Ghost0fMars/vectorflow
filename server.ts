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

dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

const app = express();
const PORT = parseInt(process.env.PORT || "5000");

// Increase payload limit to handle documents and audio base64 uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Python embedding server (embed_server.py, port 8001)
const EMBED_URL = (process.env.EMBED_LLM_URL || "http://localhost:8001") + "/v1/embeddings";
const EMBED_MODEL = process.env.EMBED_MODEL || "intfloat/multilingual-e5-base";

async function computeEmbeddings(texts: string[]): Promise<number[][]> {
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
        `Le serveur d'embeddings est injoignable (${EMBED_URL}). Lancez-le avec : python3 embed_server.py`
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
    execFile(cmd, args, { encoding: "buffer" }, (err, stdout) => {
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
    } else if (isTextDecodable(mimeType)) {
      fileContent = Buffer.from(base64, "base64").toString("utf-8");
    } else {
      return res.status(415).json({
        success: false,
        error: `Le type de fichier "${mimeType}" n'est pas supporté en mode local. Formats acceptés : PDF, TXT, CSV, JSON, XML, Markdown, code source. Les images et fichiers audio nécessitent un modèle multimodal.`,
      });
    }

    const rawText = fileContent.trim();

    res.json({
      success: true,
      rawText,
      markdownText: rawText,
      summary: "Description non disponible",
      keywords: [],
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

// Setup dev server or static serve logic
async function bootstrap() {
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
