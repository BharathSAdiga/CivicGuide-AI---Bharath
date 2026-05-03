"""
routes/chat.py — Gemini AI chat endpoint for CivicGuide AI.

Uses the current google-genai SDK (google.genai), replacing the deprecated
google.generativeai package.

Endpoints
---------
POST /api/chat
    Accepts a user message and optional conversation history, user context
    (name / age / location), and language preference. Applies decision-based
    routing before forwarding to Gemini so responses are always relevant.

Design decisions
----------------
- The Gemini client is initialised once at module level (CLIENT) to avoid
  creating a new HTTP connection per request.
- Decision routing (build_decision_prefix) runs BEFORE the Gemini call so the
  model always has the right framing — no post-processing needed.
- Language injection is done via a plain-text directive inside the prompt rather
  than a separate translation API call, keeping latency low.
- History is converted from [{role, parts}] Gemini format to the Content list
  format expected by the new SDK before each call.
- Fuzzy matching is applied to keyword detection so users with typos (e.g.
  "how to vot", "regsiter", "eligble") are still routed correctly.
"""

import re
import unicodedata
import os
from collections import Counter
from functools import lru_cache

try:
    from groq import Groq
except ImportError:
    Groq = None

from flask import Blueprint, request, Response, stream_with_context

from config import (
    GROQ_API_KEY, GROQ_MODEL, VOTING_AGE, SUPPORTED_LANGUAGES,
    CHAT_MAX_MESSAGE_LENGTH, CHAT_MAX_HISTORY_TURNS,
)
from utils import error_response, success_response
from rag import retrieve

chat_bp = Blueprint("chat", __name__)


# ── Groq Client (module-level singleton) ─────────────────────────────────
_client = None

def get_client():
    """
    Return the module-level Groq client.
    """
    global _client
    if _client is None:
        groq_key = os.getenv("GROQ_API_KEY", "")
        if not groq_key:
            raise EnvironmentError("GROQ_API_KEY is not set.")
        if Groq is None:
            raise ImportError("groq python package is not installed.")
        _client = Groq(api_key=groq_key)
    return _client


# ── Typo-Tolerant Fuzzy Matching ───────────────────────────────────────────

@lru_cache(maxsize=4096)
def _edit_distance(s1: str, s2: str) -> int:
    """
    Compute the Levenshtein edit distance between two strings.
    Used for fuzzy keyword matching to tolerate user typos.
    """
    if len(s1) < len(s2):
        return _edit_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            # Substitution, insertion, deletion
            curr_row.append(min(
                prev_row[j + 1] + 1,
                curr_row[j] + 1,
                prev_row[j] + (0 if c1 == c2 else 1),
            ))
        prev_row = curr_row
    return prev_row[-1]


@lru_cache(maxsize=1024)
def normalize_message(text: str) -> str:
    """
    Normalize user input for more reliable pattern matching.

    - Lowercases
    - Strips accents / diacritics (e.g. résumé → resume)
    - Collapses multiple spaces / punctuation runs into single space
    - Removes leading/trailing whitespace
    """
    text = text.lower().strip()
    # Strip Unicode accents (keeps Devanagari intact)
    nfkd = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Collapse whitespace & strip stray punctuation between words
    text = re.sub(r"[\s]+", " ", text)
    return text


def fuzzy_contains(haystack: str, needle: str, max_distance: int = 2) -> bool:
    """
    Check if *needle* appears anywhere inside *haystack* with at most
    *max_distance* character edits (Levenshtein distance).

    Works on a sliding-window basis: for each window of len(needle)±1
    characters in haystack, we check the edit distance.

    Short needles (≤3 chars) require exact match to avoid false positives.
    """
    if not needle or not haystack:
        return False

    # Exact match fast path
    if needle in haystack:
        return True

    # Short keywords must match exactly to avoid false positives
    if len(needle) <= 3:
        return False

    # Sliding window fuzzy search
    n_len = len(needle)
    for window_size in range(max(1, n_len - 1), n_len + 2):
        for i in range(len(haystack) - window_size + 1):
            window = haystack[i : i + window_size]
            dist = _edit_distance(window, needle)
            # Scale max allowed distance: longer words tolerate more errors
            allowed = min(max_distance, max(1, n_len // 4))
            if n_len >= 8:
                allowed = max_distance  # full tolerance for long patterns
            if dist <= allowed:
                return True
    return False


def fuzzy_any(text: str, patterns: list[str], max_distance: int = 2) -> bool:
    """Return True if *any* pattern fuzzy-matches inside text."""
    return any(fuzzy_contains(text, p, max_distance) for p in patterns)


# ── System Prompt ──────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are CivicGuide AI — a beginner-friendly assistant that helps Indian citizens
understand elections, civic processes, and voting.

## YOUR GOAL
Be extremely concise and to the point. Answer directly without fluff. Make every response clear, structured, and easy to understand.

## TYPO & MISSPELLING TOLERANCE
- Users may type with spelling mistakes, abbreviations, or broken grammar.
- ALWAYS interpret the user's *intent* even if the message is misspelled.
- Silently correct and respond as if the message was perfectly spelled.

## STRICT RESPONSE FORMAT
Keep your answers brief. Only use the following sections if they are absolutely necessary to answer the question:

**📋 Step-by-Step Process**
- Only use if the user asks "How to..."
- Max 3-4 short steps.

**💡 Key Points to Remember**
- Max 2-3 short bullets. Be very concise.

**📄 Required Documents**
- Only use if the user explicitly asks about documents or IDs.

## TONE & STYLE RULES
- Write like you're explaining to a first-time voter or a school student.
- Use very short sentences.
- Never write long paragraphs. Keep your total response under 100 words whenever possible.
- Be warm, encouraging, and supportive.
- Address the user by their first name when you know it.

## ACCURACY
- All information must be accurate for India's current election system.
- Do not invent facts outside of the provided knowledge base.
"""


# ── Decision-Routing Patterns ──────────────────────────────────────────────
# These patterns use fuzzy_any() for matching, so minor typos are tolerated.
HOW_TO_VOTE_PATTERNS: list[str] = [
    "how to vote", "how do i vote", "how can i vote",
    "voting process", "how to cast", "cast my vote",
    "steps to vote", "voting steps", "voting procedure",
    "कैसे वोट", "वोट कैसे डालें",
]

VAGUE_PATTERNS: list[str] = [
    "tell me", "explain", "what about", "and", "also",
    "give me info", "more info", "details", "information",
]

VAGUE_WORD_THRESHOLD: int = 6

SPECIFIC_KEYWORDS: list[str] = [
    "register", "eligible", "booth", "id", "aadhaar", "epic",
    "nota", "evm", "commission", "lok sabha", "rajya sabha", "assembly",
    "voter", "vote", "election", "candidate", "ballot", "polling",
]


# ── Context Builders ───────────────────────────────────────────────────────

def build_context_prefix(user_context: dict) -> str:
    """
    Build a plain-text block injected before the user's message so Gemini
    can personalise responses based on who the user is.

    Args:
        user_context: Dict with optional keys: name (str), age (int|str),
                      location (str).

    Returns:
        Multi-line context string, or empty string if context is empty.
    """
    name     = user_context.get("name", "").strip()
    age_raw  = user_context.get("age")
    location = user_context.get("location", "").strip()

    lines = ["[USER CONTEXT — use this to personalise your response]"]

    if name:
        lines.append(f"- User's name: {name}")

    if age_raw is not None:
        try:
            age = int(age_raw)
            lines.append(f"- User's age: {age}")
            if age < VOTING_AGE:
                lines.append(
                    f"- IMPORTANT: This user is {age} years old and NOT yet eligible "
                    f"to vote in India (minimum age is {VOTING_AGE}). "
                    "Acknowledge this kindly, explain when they will be eligible, "
                    "and suggest preparation steps (e.g., getting an Aadhaar card, "
                    "learning the process, encouraging family members to vote)."
                )
            else:
                lines.append(
                    "- This user IS eligible to vote in India. "
                    "Guide them through the relevant steps confidently."
                )
        except (ValueError, TypeError):
            pass

    if location:
        lines.append(
            f"- User's location: {location}. "
            "Where applicable, tailor information to this state/district."
        )

    lines.append("[END USER CONTEXT]\n")
    return "\n".join(lines)


def build_decision_prefix(message: str, user_context: dict) -> str:
    """
    Inject conditional routing instructions before the user's question.

    Uses fuzzy matching so typos like "how to vot", "regsiter", "eligble"
    still trigger the correct decision route.

    Rules:
    1. How-to-vote gate — redirect under-age users to eligibility guidance.
    2. Vague question gate — ask Gemini to request clarification first.
    """
    msg_normalized = normalize_message(message)
    instructions   = []

    # Rule 1: How-to-vote eligibility gate (fuzzy)
    if fuzzy_any(msg_normalized, HOW_TO_VOTE_PATTERNS):
        age = user_context.get("age") if user_context else None
        try:
            age_int = int(age) if age is not None else None
        except (ValueError, TypeError):
            age_int = None

        if age_int is not None and age_int < VOTING_AGE:
            instructions.append(
                f"[DECISION LOGIC] The user asked how to vote but is NOT yet eligible "
                f"(age {age_int}, minimum {VOTING_AGE}). "
                "First acknowledge they cannot vote yet, explain when they will be eligible, "
                "and suggest preparatory steps. Do NOT provide the full voting steps yet."
            )
        else:
            instructions.append(
                "[DECISION LOGIC] The user asked how to vote and appears eligible. "
                "Provide the full step-by-step voting process in your structured format."
            )

    # Rule 2: Vague question gate (fuzzy)
    word_count           = len(message.split())
    is_short             = word_count <= VAGUE_WORD_THRESHOLD
    has_specific_keyword = fuzzy_any(msg_normalized, SPECIFIC_KEYWORDS)
    is_how_to_vote_query = fuzzy_any(msg_normalized, HOW_TO_VOTE_PATTERNS)

    if (
        is_short
        and not is_how_to_vote_query
        and not has_specific_keyword
        and fuzzy_any(msg_normalized, VAGUE_PATTERNS)
    ):
        instructions.append(
            "[DECISION LOGIC] The user's question is vague or incomplete. "
            "Ask ONE specific clarifying question before answering."
        )

    return "\n".join(instructions)


def build_language_instruction(language: str) -> str:
    """Return a prompt directive for the response language."""
    if language == "hindi":
        return (
            "[LANGUAGE] Respond entirely in Hindi (Devanagari script). "
            "Use simple, everyday Hindi. Keep the same structured format."
        )
    return ""




# ── Chat Endpoint ──────────────────────────────────────────────────────────

@chat_bp.route("/chat", methods=["POST"])
def chat():
    """
    Process a chat message and return a Gemini AI response.

    Request JSON:
    {
        "message":      "How do I register to vote?",   (required)
        "history":      [ ... ],                        (optional)
        "user_context": { "name": "...", "age": ..., "location": "..." },
        "language":     "english" | "hindi"             (optional)
    }

    Response JSON (200):
    { "reply": "...", "model": "gemini-2.5-flash", "language": "english" }

    Error JSON (400 / 500):
    { "error": "..." }
    """
    data = request.get_json(silent=True)

    # ── Validate request body ──────────────────────────────────────────────
    if not data or "message" not in data:
        return error_response("Missing 'message' field in request body")

    # ── Validate message ───────────────────────────────────────────────────
    user_message = data["message"].strip()
    if not user_message:
        return error_response("'message' cannot be empty")
    if len(user_message) > CHAT_MAX_MESSAGE_LENGTH:
        return error_response(
            f"Message too long: max {CHAT_MAX_MESSAGE_LENGTH} characters "
            f"(received {len(user_message)})"
        )

    # ── Validate and sanitize history ──────────────────────────────────────
    raw_history = data.get("history", [])
    if not isinstance(raw_history, list):
        return error_response("'history' must be a list")

    history = [
        turn for turn in raw_history
        if (
            isinstance(turn, dict)
            and turn.get("role") in ("user", "model")
            and isinstance(turn.get("parts"), list)
            and all(isinstance(p, str) for p in turn["parts"])
        )
    ][-CHAT_MAX_HISTORY_TURNS:]

    # ── Parse optional fields ──────────────────────────────────────────────
    raw_context = data.get("user_context") or {}
    if not isinstance(raw_context, dict):
        raw_context = {}

    # Sanitize user_context fields to prevent prompt injection via name/location.
    # Each field is stripped and capped at a short, safe length.
    user_context = {
        "name":     str(raw_context.get("name", ""))[:60].strip(),
        "age":      int(raw_context["age"]) if isinstance(raw_context.get("age"), (int, float)) and 0 <= raw_context["age"] <= 130 else None,
        "location": str(raw_context.get("location", ""))[:80].strip(),
    }

    language = data.get("language", "english")
    if not isinstance(language, str):
        language = "english"
    language = language.lower().strip()
    if language not in SUPPORTED_LANGUAGES:
        language = "english"

    # ── Retrieve knowledge base context (RAG) ──────────────────────────────
    # Use the normalized message for better embedding similarity on typos
    normalized_for_rag = normalize_message(user_message)
    retrieved_context  = retrieve(normalized_for_rag)
    knowledge_prefix = (
        f"[OFFICIAL KNOWLEDGE BASE]\n{retrieved_context}\n[END KNOWLEDGE BASE]\n"
        "Use the official knowledge base above to answer the user's question accurately. "
        "Do not invent facts outside of this knowledge base if the answer is contained within it."
    ) if retrieved_context else ""

    # ── Build the augmented prompt ─────────────────────────────────────────
    prompt_parts = filter(None, [
        build_context_prefix(user_context),
        build_decision_prefix(user_message, user_context),
        build_language_instruction(language),
        knowledge_prefix,
        (
            f"[TYPO NOTICE] The user's original message is shown below. "
            f"It may contain spelling mistakes — interpret the intent, not the literal text.\n"
            f"User question: {user_message}"
        ),
    ])
    augmented_message = "\n".join(prompt_parts)

    # ── Local Fallback Agent (Offline Knowledge Search) ───────────────────
    def local_agent_fallback(query: str, lang: str) -> str:
        
        kb_path = os.path.join(os.path.dirname(__file__), "..", "knowledge.txt")
        try:
            with open(kb_path, "r", encoding="utf-8") as f:
                content = f.read()
            paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        except Exception:
            paragraphs = []
            
        # Clean query: extract words, remove common stop words
        stopwords = {"how", "to", "what", "is", "the", "a", "an", "do", "i", "can", "in", "of", "for", "and"}
        query_words = [w for w in re.findall(r'\w+', query.lower()) if w not in stopwords]
        
        best_paras = []
        if query_words and paragraphs:
            # Score paragraphs based on matching keywords
            scored_paras = []
            for p in paragraphs:
                p_lower = p.lower()
                score = sum(p_lower.count(qw) for qw in query_words)
                if score > 0:
                    scored_paras.append((score, p))
            
            scored_paras.sort(key=lambda x: x[0], reverse=True)
            best_paras = [p for score, p in scored_paras[:2]]
        
        # If no match or kb failed, use basic fallback
        if not best_paras:
            return (
                "I am currently running in offline mode and couldn't find a specific answer for your query in my local database.\n\n"
                "**💡 What you can ask me right now:**\n"
                "- How do I register to vote?\n"
                "- What documents are required?\n"
                "- Am I eligible to vote?\n"
                "- What is NOTA?\n"
            )

        # Build dynamic response mimicking the AI
        res = "Based on official guidelines, here is what you need to know:\n\n"
        
        # Add a structured Key Points section dynamically based on the retrieved text
        res += "**💡 Key Points to Remember**\n"
        for i, para in enumerate(best_paras):
            # Extract the title/first sentence
            first_sentence = para.split(". ")[0].strip()
            # Clean up title if it has a colon
            if ":" in first_sentence:
                title, desc = first_sentence.split(":", 1)
                res += f"- **{title}**: {desc}.\n"
            else:
                res += f"- {first_sentence}.\n"
        
        res += "\n**📋 Detailed Information**\n"
        for para in best_paras:
            res += f"{para}\n\n"
            
        return res

    # ── Call Groq API ───────────────────────────────
    try:
        client = get_client()
        
        # Build standard messages array for Groq/OpenAI format
        groq_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        
        # Add history
        for turn in history:
            role = "assistant" if turn["role"] == "model" else "user"
            groq_messages.append({"role": role, "content": turn["parts"][0]})
            
        # Add current augmented message
        groq_messages.append({"role": "user", "content": augmented_message})

        response_stream = client.chat.completions.create(
            model=GROQ_MODEL,  # Default fast/free Groq model
            messages=groq_messages,
            temperature=0.7,
            max_tokens=1024,
            stream=True
        )

        def generate():
            import logging
            try:
                for chunk in response_stream:
                    if chunk.choices[0].delta.content is not None:
                        yield chunk.choices[0].delta.content
            except Exception as e:
                err_str = str(e)
                logging.getLogger(__name__).error("Streaming chunk error: %s", e, exc_info=True)
                if "429" in err_str or "quota" in err_str.lower() or "limit" in err_str.lower():
                    yield local_agent_fallback(user_message, language)
                else:
                    yield "\n\nI encountered an issue generating a response. Please try again."
        
        return Response(stream_with_context(generate()), mimetype='text/plain')

    except Exception as exc:
        import logging
        err_str = str(exc)
        # Log the full error server-side but never expose it to the client.
        logging.getLogger(__name__).error("Chat endpoint error: %s", exc, exc_info=True)
        if "429" in err_str or "quota" in err_str.lower() or "GROQ_API_KEY" in err_str or "api_key" in err_str.lower():
            # Fallback for quota exhausted or missing key — client gets a safe message
            def generate_mock():
                yield local_agent_fallback(user_message, language)
            return Response(stream_with_context(generate_mock()), mimetype='text/plain')

        return error_response("AI service is temporarily unavailable. Please try again shortly.", status=500)
