import { Chunk, ChunkingConfig } from "../types";

/**
 * Splits string text into chunks based on characters with specific size and overlap
 */
function chunkByChars(text: string, size: number, overlap: number): string[] {
  if (size <= 0) return [text];
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    
    // Move starting position forward by (size - overlap)
    const step = size - overlap;
    if (step <= 0) {
      // Prevent infinite loop if overlap >= size
      start += size;
    } else {
      start += step;
    }
    
    // Break if we hit the end
    if (end >= text.length) break;
  }
  
  return chunks;
}

/**
 * Splits string text into chunks based on words with specific size and overlap
 */
function chunkByWords(text: string, size: number, overlap: number): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || words[0] === "") return [];
  if (size <= 0) return [text];
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < words.length) {
    const end = Math.min(start + size, words.length);
    chunks.push(words.slice(start, end).join(" "));
    
    const step = size - overlap;
    if (step <= 0) {
      start += size;
    } else {
      start += step;
    }
    
    if (end >= words.length) break;
  }
  
  return chunks;
}

/**
 * Splits string text into chunks based on paragraphs
 */
function chunkByParagraphs(text: string, maxParagraphsPerChunk: number = 2): string[] {
  const paragraphs = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];
  
  const chunks: string[] = [];
  for (let i = 0; i < paragraphs.length; i += maxParagraphsPerChunk) {
    const slice = paragraphs.slice(i, i + maxParagraphsPerChunk);
    chunks.push(slice.join("\n\n"));
  }
  
  return chunks;
}

/**
 * Core chunker that transforms full raw text into standard vectors metadata chunks
 */
export function generateChunks(
  text: string,
  fileName: string,
  config: ChunkingConfig,
  summary: string = "",
  keywords: string[] = []
): Chunk[] {
  if (!text) return [];

  let textSegments: string[] = [];
  const { strategy, size, overlap } = config;

  switch (strategy) {
    case 'char':
      textSegments = chunkByChars(text, size, overlap);
      break;
    case 'word':
      textSegments = chunkByWords(text, size, overlap);
      break;
    case 'paragraph':
      // Using chunk size as paragraphs count if strategy is paragraph
      textSegments = chunkByParagraphs(text, Math.max(1, Math.floor(size / 100)));
      break;
    default:
      textSegments = chunkByChars(text, 1000, 100);
  }

  return textSegments.map((segment, index) => {
    const words = segment.trim().split(/\s+/).filter(Boolean).length;
    return {
      id: `chunk-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}-${index}`,
      fileName,
      index,
      text: segment,
      charCount: segment.length,
      wordCount: words,
      metadata: {
        source: fileName,
        chunkIndex: index,
        totalChunks: textSegments.length,
        title: `${fileName} - Segment ${index + 1}`,
        ...(config.addMetadata ? { summary, keywords } : {})
      }
    };
  });
}

/**
 * Estimates number of tokens (rough estimate: 1 token ~ 4 characters in French/English)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.round(text.length / 4);
}

/**
 * Format bytes to readable size string
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
