import os
import math
import logging
from functools import lru_cache
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

logger = logging.getLogger(__name__)

# Module-level cache
_chunks = []
_embeddings = []
_embed_model = None

def get_embed_model():
    global _embed_model
    if _embed_model is None:
        if SentenceTransformer is None:
            logger.warning("sentence-transformers not installed. RAG will not work.")
            return None
        # all-MiniLM-L6-v2 is ultra-lightweight (80MB) and fast on CPU
        _embed_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _embed_model

def cosine_similarity(v1, v2) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)

def load_knowledge_base():
    """Load text and generate local embeddings for the knowledge base."""
    global _chunks, _embeddings
    if _chunks:
        return  # already loaded
    
    kb_path = os.path.join(os.path.dirname(__file__), "knowledge.txt")
    if not os.path.exists(kb_path):
        logger.warning(f"Knowledge base not found at {kb_path}")
        return
    
    with open(kb_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Split by double newline to get distinct paragraphs/sections
    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
    if not paragraphs:
        logger.warning("Knowledge base is empty.")
        return
        
    _chunks = paragraphs
    
    try:
        model = get_embed_model()
        if not model:
            return
        
        # Embed all chunks offline
        _embeddings = model.encode(_chunks, convert_to_numpy=False)
        logger.info(f"Successfully loaded and locally embedded {len(_chunks)} chunks.")
    except Exception as e:
        logger.error(f"Error embedding knowledge base: {e}")
        _chunks = []
        _embeddings = []

@lru_cache(maxsize=1024)
def _retrieve_cached(query: str, top_k: int) -> str:
    try:
        model = get_embed_model()
        if not model:
            return ""
            
        query_emb = model.encode([query], convert_to_numpy=False)[0]
        
        scored_chunks = []
        for i, chunk_emb in enumerate(_embeddings):
            score = cosine_similarity(query_emb, chunk_emb)
            scored_chunks.append((score, _chunks[i]))
            
        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        # Filter chunks that are sufficiently similar
        top_chunks = [chunk for score, chunk in scored_chunks[:top_k] if score > 0.3]
        
        if not top_chunks:
            return ""
            
        return "\n\n".join(top_chunks)
    except Exception as e:
        logger.error(f"Error in RAG retrieval: {e}")
        return ""

def retrieve(query: str, top_k: int = 3) -> str:
    """Retrieve top_k relevant chunks for the given query."""
    if not _chunks or not _embeddings:
        load_knowledge_base()
        
    if not _chunks or not _embeddings:
        return ""
        
    return _retrieve_cached(query, top_k)
