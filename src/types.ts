export type FileStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Chunk {
  id: string;
  fileName: string;
  index: number;
  text: string;
  charCount: number;
  wordCount: number;
  embedding?: number[];
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks: number;
    title: string;
    summary?: string;
    keywords?: string[];
  };
}

export interface ProcessedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: FileStatus;
  progress: number;
  error?: string;
  rawText?: string;
  markdownText?: string;
  summary?: string;
  keywords?: string[];
  chunks?: Chunk[];
  processedAt?: number;
  embeddingStatus?: 'idle' | 'processing' | 'done' | 'error';
  embeddingError?: string;
  storeStatus?: 'idle' | 'processing' | 'done' | 'error';
  storeError?: string;
  storedCollection?: string;
}

export interface ChunkingConfig {
  enabled: boolean;
  strategy: 'char' | 'word' | 'paragraph';
  size: number;
  overlap: number;
  addMetadata: boolean;
  enrichWithAI: boolean;
}

export interface ConversionResponse {
  success: boolean;
  rawText: string;
  markdownText: string;
  summary?: string;
  keywords?: string[];
  error?: string;
}

export interface EmbedResponse {
  success: boolean;
  embeddings?: { id: string; vector: number[] }[];
  error?: string;
}

export interface StoreResponse {
  success: boolean;
  stored?: number;
  collection?: string;
  error?: string;
}

export interface QdrantCollection {
  name: string;
  vectorsCount?: number;
}

export interface SearchResult {
  score: number;
  text: string;
  chunkId: string;
  metadata: Record<string, unknown>;
}

export interface SearchResponse {
  success: boolean;
  results?: SearchResult[];
  error?: string;
}
