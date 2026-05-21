"""
Local embedding server — OpenAI-compatible /v1/embeddings endpoint.
Model: intfloat/multilingual-e5-base  (768 dims, French/multilingual)
Port:  8001

Start: python3 embed_server.py
"""

import os
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn
from typing import Union

MODEL_NAME = os.getenv("EMBED_MODEL", "intfloat/multilingual-e5-base")
PORT = int(os.getenv("EMBED_SERVER_PORT", "8001"))
# Default to CPU — vLLM typically occupies the GPU and leaves no room for a second model.
# Set EMBED_DEVICE=cuda to override (only if vLLM is stopped or on a second GPU).
DEVICE = os.getenv("EMBED_DEVICE", "cpu")

tokenizer: AutoTokenizer | None = None
model: AutoModel | None = None


def load_model() -> None:
    global tokenizer, model
    print(f"Loading {MODEL_NAME} on {DEVICE}…", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModel.from_pretrained(MODEL_NAME).to(DEVICE)
    model.eval()
    print("Embedding model ready.", flush=True)


def mean_pool(model_output, attention_mask: torch.Tensor) -> torch.Tensor:
    token_emb = model_output.last_hidden_state
    mask_expanded = attention_mask.unsqueeze(-1).expand(token_emb.size()).float()
    return torch.sum(token_emb * mask_expanded, 1) / torch.clamp(mask_expanded.sum(1), min=1e-9)


from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    load_model()
    yield


app = FastAPI(lifespan=lifespan)


class EmbedRequest(BaseModel):
    model: str = MODEL_NAME
    input: Union[list[str], str]


@app.post("/v1/embeddings")
async def embeddings(req: EmbedRequest) -> dict:
    texts = req.input if isinstance(req.input, list) else [req.input]

    encoded = tokenizer(
        texts,
        padding=True,
        truncation=True,
        max_length=512,
        return_tensors="pt",
    )
    encoded = {k: v.to(DEVICE) for k, v in encoded.items()}

    with torch.no_grad():
        output = model(**encoded)

    vecs = mean_pool(output, encoded["attention_mask"])
    vecs = F.normalize(vecs, p=2, dim=1).cpu().tolist()

    return {
        "object": "list",
        "data": [{"object": "embedding", "embedding": v, "index": i} for i, v in enumerate(vecs)],
        "model": req.model,
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": MODEL_NAME, "device": DEVICE}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
