import express from "express";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

const app = express();
const PORT = 3000;

// Increase payload limit to handle documents and audio base64 uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini API client lazily
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY key is missing. Please add it in your Secrets / Env variables.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Initialize OpenAI client lazily
let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY manquante. Ajoutez-la dans votre fichier .env.");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// Initialize Qdrant client lazily
const QDRANT_VECTOR_SIZE = 1536; // text-embedding-3-small

let qdrantClient: QdrantClient | null = null;
function getQdrantClient(): QdrantClient {
  if (!qdrantClient) {
    const url = process.env.QDRANT_URL || "http://localhost:6333";
    const apiKey = process.env.QDRANT_API_KEY || undefined;
    qdrantClient = new QdrantClient({ url, apiKey });
  }
  return qdrantClient;
}

// Ensure a Qdrant collection exists with cosine similarity on 1536-dim vectors
async function ensureCollection(client: QdrantClient, name: string): Promise<void> {
  const { collections } = await client.getCollections();
  if (!collections.some((c) => c.name === name)) {
    await client.createCollection(name, {
      vectors: { size: QDRANT_VECTOR_SIZE, distance: "Cosine" },
    });
  }
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

    const ai = getGeminiClient();

    // Standard instruction for Gemini to structure the extraction
    const prompt = `You are a professional document extractor and formatting agent for vector indexing (RAG / embeddings).
Analyze the attached file "${name}" (MIME-Type: ${mimeType}) and extract its complete structured content.

Follow these strict output rules to provide high-quality chunks/vectors later:
1. Preserve formatting elements like headings, bullet lists, bold emphasis, and code snippets.
2. SPREADSHEETS AND TABLES MUST be converted into standard Markdown table syntax so coordinates, column headings, and cell relationships are preserved for vector similarity search.
3. IMAGES / VISUALS MUST be subjected to precise OCR. For diagrams, charts, flowcharts, or infographics, include a detailed analytical text rendering of the visual relations to capture the semantic information.
4. AUDIO files must be transcribed as accurately as possible. Output as clean paragraphs.
5. FILTER OUT clutter like repeating running page headers, footers, and page numbers to avoid polluting token blocks.
6. Provide exactly three parts in your response. Align them strictly inside these specific delimiter tags:

[TEXT_START]
Provide the full text extracted in standard RAW, clean plain text. Remove HTML tags, markdown symbols, and keep formatting basic (plain text).
[TEXT_END]

[MARKDOWN_START]
Provide the full formatted text in standard Markdown format (including Markdown tables, bullet lists, structural bold text, code blocks, etc.).
[MARKDOWN_END]

[METADATA_START]
Provide a JSON object containing EXACTLY two fields:
{
  "summary": "A brief, 2 to 3 sentences high-level description of what this document covers.",
  "keywords": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
[METADATA_END]

Ensure that you include these delimiters clearly so my machine parser can extract them accurately. Do not fail. Output as requested.`;

    // Direct conversion
    const imagePart = {
      inlineData: {
        data: base64,
        mimeType: mimeType,
      },
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [imagePart, { text: prompt }],
    });

    const responseText = response.text || "";

    // Parse output response using our tags
    let rawText = "";
    let markdownText = "";
    let summary = "";
    let keywords: string[] = [];

    // Extract Raw Text
    const rawMatch = responseText.match(/\[TEXT_START\]([\s\S]*?)\[TEXT_END\]/);
    if (rawMatch) {
      rawText = rawMatch[1].trim();
    } else {
      // Fallback
      rawText = responseText.replace(/\[MARKDOWN_START[\s\S]*$/, "").trim();
    }

    // Extract Markdown Text
    const mdMatch = responseText.match(/\[MARKDOWN_START\]([\s\S]*?)\[MARKDOWN_END\]/);
    if (mdMatch) {
      markdownText = mdMatch[1].trim();
    } else {
      markdownText = rawText || responseText;
    }

    // Extract Metadata JSON
    const metaMatch = responseText.match(/\[METADATA_START\]([\s\S]*?)\[METADATA_END\]/);
    if (metaMatch) {
      try {
        const metadataJson = JSON.parse(metaMatch[1].trim());
        summary = metadataJson.summary || "";
        keywords = metadataJson.keywords || [];
      } catch (e) {
        console.error("Error parsing generated metadata JSON", e);
      }
    }

    // Secondary fallback in case JSON extraction failed, try finding raw keys
    if (!summary || keywords.length === 0) {
      const summaryMatch = responseText.match(/"summary"\s*:\s*"([^"]+)"/);
      if (summaryMatch) summary = summaryMatch[1];
      
      const keywordsMatch = responseText.match(/"keywords"\s*:\s*\[([^\]]+)\]/);
      if (keywordsMatch) {
        keywords = keywordsMatch[1].split(",").map(k => k.replace(/"/g, "").trim());
      }
    }

    // Final checks
    if (!rawText && responseText) {
      rawText = responseText;
      markdownText = responseText;
    }

    res.json({
      success: true,
      rawText,
      markdownText,
      summary: summary || "Description non disponible",
      keywords: keywords.length > 0 ? keywords : ["fichiers", "conversion", "texte"],
    });

  } catch (error: any) {
    console.error("Full file conversion error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "An error occurred during file processing with Gemini.",
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

    const openai = getOpenAIClient();
    const BATCH_SIZE = 100;
    const allEmbeddings: { id: string; vector: number[] }[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch.map((c) => c.text),
      });
      response.data.forEach((item, idx) => {
        allEmbeddings.push({ id: batch[idx].id, vector: item.embedding });
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

    // Embed the query with the same model used for indexing
    const openai = getOpenAIClient();
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
    const queryVector = embeddingRes.data[0].embedding;

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
