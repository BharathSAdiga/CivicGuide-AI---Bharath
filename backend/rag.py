import os
import math
import logging
from google import genai
from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

# Module-level cache
_chunks = []
_embeddings = []
_client = None

def get_client() -> genai.Client:
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise EnvironmentError("GEMINI_API_KEY is not set.")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client

def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)

def load_knowledge_base():
    """Load text and generate embeddings for the knowledge base."""
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
        client = get_client()
        # Embed all chunks at once (Google GenAI API allows list of strings)
        response = client.models.embed_content(
            model='text-embedding-004',
            contents=_chunks
        )
        # Assuming response.embeddings is a list of objects with a .values attribute
        _embeddings = [emb.values for emb in response.embeddings]
        logger.info(f"Successfully loaded and embedded {len(_chunks)} chunks.")
    except Exception as e:
        logger.error(f"Error embedding knowledge base: {e}")
        _chunks = []
        _embeddings = []

def retrieve(query: str, top_k: int = 3) -> str:
    """Retrieve top_k relevant chunks for the given query."""
    if not _chunks or not _embeddings:
        load_knowledge_base()
        
    if not _chunks or not _embeddings:
        return ""
        
    try:
        client = get_client()
        query_response = client.models.embed_content(
            model='text-embedding-004',
            contents=query
        )
        query_emb = query_response.embeddings[0].values
        
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
