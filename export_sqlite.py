import sys
import json
import sqlite3
import os

def export(json_path, db_path):
    print(f"Reading JSON from {json_path}...", flush=True)
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"Connecting to SQLite database at {db_path}...", flush=True)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        name TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        processed_at INTEGER
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        chunk_index INTEGER,
        text TEXT,
        char_count INTEGER,
        word_count INTEGER,
        metadata TEXT, -- JSON string
        embedding TEXT, -- JSON array of floats
        FOREIGN KEY(document_id) REFERENCES documents(id)
    )
    """)
    
    # Extract unique documents from points payload
    docs = {}
    points = data.get("points", [])
    print(f"Processing {len(points)} points...", flush=True)

    for point in points:
        payload = point.get("payload", {})
        # Fallbacks for document identification
        doc_id = payload.get("source") or payload.get("fileName") or "unknown_doc"
        if doc_id not in docs:
            docs[doc_id] = {
                "id": doc_id,
                "name": payload.get("source") or payload.get("fileName") or "unknown",
                "mime_type": payload.get("type") or "unknown",
                "size_bytes": 0,
                "processed_at": 0
            }
            
    # Insert documents
    print(f"Inserting {len(docs)} documents...", flush=True)
    for doc in docs.values():
        cursor.execute(
            "INSERT OR REPLACE INTO documents (id, name, mime_type, size_bytes, processed_at) VALUES (?, ?, ?, ?, ?)",
            (doc["id"], doc["name"], doc["mime_type"], doc["size_bytes"], doc["processed_at"])
        )
        
    # Insert chunks
    print("Inserting chunks...", flush=True)
    for point in points:
        payload = point.get("payload", {})
        chunk_id = point.get("id")
        doc_id = payload.get("source") or payload.get("fileName") or "unknown_doc"
        chunk_index = payload.get("chunkIndex", 0)
        text = payload.get("text", "")
        
        # Build metadata (excluding text to avoid redundancy)
        metadata = {k: v for k, v in payload.items() if k not in ["text"]}
        metadata_str = json.dumps(metadata)
        
        embedding = point.get("vector")
        embedding_str = json.dumps(embedding) if embedding else None
        
        cursor.execute(
            "INSERT OR REPLACE INTO chunks (id, document_id, chunk_index, text, char_count, word_count, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (chunk_id, doc_id, chunk_index, text, len(text), len(text.split()), metadata_str, embedding_str)
        )
        
    conn.commit()
    conn.close()
    print("Export complete!", flush=True)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python export_sqlite.py <json_path> <db_path>")
        sys.exit(1)
    export(sys.argv[1], sys.argv[2])
