"""
routes/chat.py — CivicGuide AI enhanced chat endpoint.

Uses the Groq API (llama-3.1-8b-instant) with:
  - Intent classification (HOW_TO, ELIGIBILITY, DOCUMENTS, GENERAL, etc.)
  - Sentiment-aware routing (confused / frustrated users get extra help)
  - Follow-up question suggestions appended as a JSON footer after streaming
  - Thumbs-up / thumbs-down feedback endpoint (/api/feedback)
  - Smarter system prompt for structured, concise, cited responses
  - Expanded fuzzy matching patterns

Endpoints
---------
POST /api/chat        — Main streaming chat endpoint
POST /api/feedback    — Record user feedback (thumbs up/down) in server logs
"""

import re
import json
import unicodedata
import os
import logging
from collections import Counter
from functools import lru_cache

try:
    from groq import Groq
except ImportError:
    Groq = None

from flask import Blueprint, request, Response, stream_with_context, jsonify

from config import (
    GROQ_API_KEY, GROQ_MODEL, VOTING_AGE, SUPPORTED_LANGUAGES,
    CHAT_MAX_MESSAGE_LENGTH, CHAT_MAX_HISTORY_TURNS,
)
from utils import error_response, success_response
from rag import retrieve

chat_bp = Blueprint("chat", __name__)
logger = logging.getLogger(__name__)


# ── Groq Client (module-level singleton) ─────────────────────────────────
_client = None

def get_client():
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
    if len(s1) < len(s2):
        return _edit_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            curr_row.append(min(
                prev_row[j + 1] + 1,
                curr_row[j] + 1,
                prev_row[j] + (0 if c1 == c2 else 1),
            ))
        prev_row = curr_row
    return prev_row[-1]


@lru_cache(maxsize=1024)
def normalize_message(text: str) -> str:
    text = text.lower().strip()
    nfkd = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in nfkd if not unicodedata.combining(c))
    text = re.sub(r"[\s]+", " ", text)
    return text


def fuzzy_contains(haystack: str, needle: str, max_distance: int = 2) -> bool:
    if not needle or not haystack:
        return False
    if needle in haystack:
        return True
    if len(needle) <= 3:
        return False
    n_len = len(needle)
    for window_size in range(max(1, n_len - 1), n_len + 2):
        for i in range(len(haystack) - window_size + 1):
            window = haystack[i : i + window_size]
            dist = _edit_distance(window, needle)
            allowed = min(max_distance, max(1, n_len // 4))
            if n_len >= 8:
                allowed = max_distance
            if dist <= allowed:
                return True
    return False


def fuzzy_any(text: str, patterns: list, max_distance: int = 2) -> bool:
    return any(fuzzy_contains(text, p, max_distance) for p in patterns)


# ── Intent Classification ──────────────────────────────────────────────────

HOW_TO_VOTE_PATTERNS = [
    "how to vote", "how do i vote", "how can i vote",
    "voting process", "how to cast", "cast my vote",
    "steps to vote", "voting steps", "voting procedure",
    "कैसे वोट", "वोट कैसे डालें",
]

ELIGIBILITY_PATTERNS = [
    "am i eligible", "eligible to vote", "can i vote", "voting age",
    "minimum age", "who can vote", "क्या मैं मतदान कर सकता",
    "eligibility", "qualify", "allowed to vote",
]

REGISTRATION_PATTERNS = [
    "register", "registration", "form 6", "enroll", "voter id", "epic card",
    "voter card", "nvsp", "voter helpline app", "blo", "booth level officer",
    "पंजीकरण", "मतदाता पहचान",
]

DOCUMENTS_PATTERNS = [
    "documents", "document", "proof", "aadhaar", "id card", "pan card",
    "passport", "birth certificate", "what do i need", "required",
    "दस्तावेज़", "पहचान पत्र",
]

BOOTH_PATTERNS = [
    "polling booth", "polling station", "where to vote", "find booth",
    "booth location", "nearest booth", "मतदान केंद्र",
]

COUNTING_PATTERNS = [
    "counting", "result", "how are votes counted", "vote count",
    "matha ganat", "मतगणना", "winner", "declaration",
]

VAGUE_PATTERNS = [
    "tell me", "explain", "what about", "give me info", "more info",
    "details", "information",
]

SENTIMENT_CONFUSED = [
    "i don't understand", "confused", "not sure", "unclear",
    "can you explain", "what does that mean", "i'm lost", "help me",
    "समझ नहीं", "समझाइए",
]

SENTIMENT_FRUSTRATED = [
    "this is wrong", "not working", "useless", "wrong answer",
    "that's incorrect", "you are wrong", "bad answer",
]

SPECIFIC_KEYWORDS = [
    "register", "eligible", "booth", "id", "aadhaar", "epic",
    "nota", "evm", "commission", "lok sabha", "rajya sabha", "assembly",
    "voter", "vote", "election", "candidate", "ballot", "polling",
    "mcc", "form 6", "form 8", "vvpat", "blo", "1950",
]

VAGUE_WORD_THRESHOLD = 6


# ── Intent → Follow-up Questions Mapping ──────────────────────────────────

FOLLOWUP_MAP = {
    "HOW_TO_VOTE": [
        "What documents do I need at the polling booth?",
        "How does the VVPAT machine work?",
        "Can I vote without my Voter ID card?",
    ],
    "ELIGIBILITY": [
        "How do I register to vote for the first time?",
        "What is the minimum age to contest in elections?",
        "Can NRIs vote in Indian elections?",
    ],
    "REGISTRATION": [
        "What documents are needed for registration?",
        "How do I check if my name is on the voter list?",
        "How do I transfer my voter registration to a new city?",
    ],
    "DOCUMENTS": [
        "Can I vote without a Voter ID card?",
        "Is Aadhaar card alone sufficient to register?",
        "How do I correct errors in my Voter ID card?",
    ],
    "BOOTH": [
        "What happens at the polling booth step by step?",
        "Can I vote at any booth or only mine?",
        "What items are prohibited inside a polling booth?",
    ],
    "COUNTING": [
        "When are election results usually announced?",
        "Can a candidate challenge election results?",
        "How are postal ballots counted?",
    ],
    "GENERAL": [
        "What is NOTA and how does it work?",
        "What is the Model Code of Conduct?",
        "How does the EVM machine work?",
    ],
}


def classify_intent(text: str) -> str:
    """Classify the user's primary intent from the normalized message."""
    if fuzzy_any(text, HOW_TO_VOTE_PATTERNS):
        return "HOW_TO_VOTE"
    if fuzzy_any(text, ELIGIBILITY_PATTERNS):
        return "ELIGIBILITY"
    if fuzzy_any(text, REGISTRATION_PATTERNS):
        return "REGISTRATION"
    if fuzzy_any(text, DOCUMENTS_PATTERNS):
        return "DOCUMENTS"
    if fuzzy_any(text, BOOTH_PATTERNS):
        return "BOOTH"
    if fuzzy_any(text, COUNTING_PATTERNS):
        return "COUNTING"
    return "GENERAL"


def detect_sentiment(text: str) -> str:
    """Detect if the user is confused or frustrated."""
    if fuzzy_any(text, SENTIMENT_CONFUSED):
        return "confused"
    if fuzzy_any(text, SENTIMENT_FRUSTRATED):
        return "frustrated"
    return "neutral"


# ── System Prompt ──────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are CivicGuide AI — a friendly, knowledgeable assistant that helps Indian
citizens understand elections, civic processes, and voting rights.

## CORE MISSION
Help citizens participate in democracy confidently. Be accurate, concise, and
empowering. Every answer should leave the user feeling informed and capable.

## TYPO & MISSPELLING TOLERANCE
- Silently interpret the user's *intent* even if the message contains typos
  or broken grammar. Never mention spelling errors to the user.

## STRICT RESPONSE FORMAT
Keep answers brief (under 120 words). Use these sections only when needed:

**📋 Step-by-Step Process**
- Only for "How to…" questions. Max 4 short numbered steps.

**💡 Key Points to Remember**
- Max 3 concise bullets. Prefer this for factual answers.

**📄 Required Documents**
- Only when the user explicitly asks about documents.

**🔗 Official Resource**
- Include a link or reference (e.g., voters.eci.gov.in, Helpline 1950)
  when it is directly useful. One reference maximum.

## TONE & STYLE
- Write like you're talking to a first-time voter or school student.
- Use very short sentences. No jargon without explanation.
- Be warm, encouraging, and supportive.
- Address the user by first name when you know it.
- If the user seems confused, briefly restate the key point more simply.
- If the user seems frustrated, acknowledge it kindly before answering.

## ACCURACY
- All information must be accurate for India's current election system.
- Do not invent facts outside the provided knowledge base.
- If a question is outside your knowledge, say so honestly and direct the
  user to voters.eci.gov.in or Voter Helpline 1950.

## WHAT NOT TO DO
- Do NOT recommend any political party or candidate.
- Do NOT express personal political opinions.
- Do NOT provide legal advice beyond general civic information.
"""


# ── Context Builders ───────────────────────────────────────────────────────

def build_context_prefix(user_context: dict) -> str:
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


def build_decision_prefix(message: str, user_context: dict, intent: str, sentiment: str) -> str:
    msg_normalized = normalize_message(message)
    instructions   = []

    # Intent-based instruction
    if intent == "HOW_TO_VOTE":
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

    elif intent == "ELIGIBILITY":
        instructions.append(
            "[DECISION LOGIC] The user is asking about voting eligibility. "
            "Answer based on their age/context. If under 18, explain kindly when they qualify."
        )

    elif intent == "REGISTRATION":
        instructions.append(
            "[DECISION LOGIC] The user is asking about voter registration. "
            "Explain Form 6, the NVSP portal (voters.eci.gov.in), and the Voter Helpline App."
        )

    elif intent == "DOCUMENTS":
        instructions.append(
            "[DECISION LOGIC] The user is asking about required documents. "
            "List the key proof-of-age and proof-of-address documents concisely."
        )

    elif intent == "BOOTH":
        instructions.append(
            "[DECISION LOGIC] The user is asking about polling booths. "
            "Explain how to find their booth (voters.eci.gov.in or Helpline 1950) "
            "and what happens at the booth on polling day."
        )

    # Vague question gate
    word_count           = len(message.split())
    is_short             = word_count <= VAGUE_WORD_THRESHOLD
    has_specific_keyword = fuzzy_any(msg_normalized, SPECIFIC_KEYWORDS)

    if (
        is_short
        and intent == "GENERAL"
        and not has_specific_keyword
        and fuzzy_any(msg_normalized, VAGUE_PATTERNS)
    ):
        instructions.append(
            "[DECISION LOGIC] The user's question is vague or incomplete. "
            "Ask ONE specific clarifying question before answering."
        )

    # Sentiment-based instruction
    if sentiment == "confused":
        instructions.append(
            "[SENTIMENT] The user seems confused. Restate the key point more simply "
            "and use a friendly, patient tone."
        )
    elif sentiment == "frustrated":
        instructions.append(
            "[SENTIMENT] The user seems frustrated. Start by acknowledging their frustration "
            "briefly and warmly, then provide the correct information clearly."
        )

    return "\n".join(instructions)


def build_language_instruction(language: str) -> str:
    if language == "hindi":
        return (
            "[LANGUAGE] Respond entirely in Hindi (Devanagari script). "
            "Use simple, everyday Hindi. Keep the same structured format."
        )
    return ""


# ── Local Fallback Agent (Offline Knowledge Search) ─────────────────────

def local_agent_fallback(query: str, lang: str) -> str:
    kb_path = os.path.join(os.path.dirname(__file__), "..", "knowledge.txt")
    try:
        with open(kb_path, "r", encoding="utf-8") as f:
            content = f.read()
        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
    except Exception:
        paragraphs = []

    stopwords = {"how", "to", "what", "is", "the", "a", "an", "do", "i", "can", "in", "of", "for", "and"}
    query_words = [w for w in re.findall(r'\w+', query.lower()) if w not in stopwords]

    best_paras = []
    if query_words and paragraphs:
        scored_paras = []
        for p in paragraphs:
            p_lower = p.lower()
            score = sum(p_lower.count(qw) for qw in query_words)
            if score > 0:
                scored_paras.append((score, p))
        scored_paras.sort(key=lambda x: x[0], reverse=True)
        best_paras = [p for score, p in scored_paras[:2]]

    if not best_paras:
        return (
            "I am currently running in offline mode and couldn't find a specific answer "
            "for your query in my local database.\n\n"
            "**💡 What you can ask me right now:**\n"
            "- How do I register to vote?\n"
            "- What documents are required?\n"
            "- Am I eligible to vote?\n"
            "- What is NOTA?\n"
            "- How does the EVM work?\n"
        )

    res = "Based on official guidelines, here is what you need to know:\n\n"
    res += "**💡 Key Points to Remember**\n"
    for para in best_paras:
        first_sentence = para.split(". ")[0].strip()
        if ":" in first_sentence:
            title, desc = first_sentence.split(":", 1)
            res += f"- **{title}**: {desc}.\n"
        else:
            res += f"- {first_sentence}.\n"

    res += "\n**📋 Detailed Information**\n"
    for para in best_paras:
        res += f"{para}\n\n"

    return res


# ── Chat Endpoint ──────────────────────────────────────────────────────────

@chat_bp.route("/chat", methods=["POST"])
def chat():
    """
    Stream a CivicGuide AI response.

    Request JSON:
    {
        "message":      "How do I register to vote?",   (required)
        "history":      [ ... ],                        (optional)
        "user_context": { "name": "...", "age": ..., "location": "..." },
        "language":     "english" | "hindi"             (optional)
    }

    The response is a plain-text stream followed by a special JSON footer:
        \\n\\n[SUGGESTIONS]{"suggestions": [...]}[/SUGGESTIONS]

    The frontend strips this footer and uses it to render follow-up chips.
    """
    data = request.get_json(silent=True)

    if not data or "message" not in data:
        return error_response("Missing 'message' field in request body")

    user_message = data["message"].strip()
    if not user_message:
        return error_response("'message' cannot be empty")
    if len(user_message) > CHAT_MAX_MESSAGE_LENGTH:
        return error_response(
            f"Message too long: max {CHAT_MAX_MESSAGE_LENGTH} characters "
            f"(received {len(user_message)})"
        )

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

    raw_context = data.get("user_context") or {}
    if not isinstance(raw_context, dict):
        raw_context = {}

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

    # ── Intent & Sentiment Classification ──────────────────────────────────
    normalized_msg = normalize_message(user_message)
    intent    = classify_intent(normalized_msg)
    sentiment = detect_sentiment(normalized_msg)

    # ── RAG Retrieval ───────────────────────────────────────────────────────
    retrieved_context = retrieve(normalized_msg)
    knowledge_prefix = (
        f"[OFFICIAL KNOWLEDGE BASE]\n{retrieved_context}\n[END KNOWLEDGE BASE]\n"
        "Use the official knowledge base above to answer accurately. "
        "Do not invent facts outside of this knowledge base if the answer is within it."
    ) if retrieved_context else ""

    # ── Build Augmented Prompt ──────────────────────────────────────────────
    prompt_parts = filter(None, [
        build_context_prefix(user_context),
        build_decision_prefix(user_message, user_context, intent, sentiment),
        build_language_instruction(language),
        knowledge_prefix,
        (
            f"[TYPO NOTICE] The user's original message is shown below. "
            f"It may contain spelling mistakes — interpret the intent, not the literal text.\n"
            f"User question: {user_message}"
        ),
    ])
    augmented_message = "\n".join(prompt_parts)

    # ── Determine follow-up suggestions ────────────────────────────────────
    suggestions = FOLLOWUP_MAP.get(intent, FOLLOWUP_MAP["GENERAL"])
    suggestions_footer = (
        "\n\n[SUGGESTIONS]"
        + json.dumps({"suggestions": suggestions})
        + "[/SUGGESTIONS]"
    )

    # ── Call Groq API ───────────────────────────────────────────────────────
    try:
        client = get_client()

        groq_messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        for turn in history:
            role = "assistant" if turn["role"] == "model" else "user"
            groq_messages.append({"role": role, "content": turn["parts"][0]})

        groq_messages.append({"role": "user", "content": augmented_message})

        response_stream = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=groq_messages,
            temperature=0.65,
            max_tokens=512,
            stream=True,
        )

        def generate():
            try:
                for chunk in response_stream:
                    if chunk.choices[0].delta.content is not None:
                        yield chunk.choices[0].delta.content
                # Append suggestions footer after AI text is done
                yield suggestions_footer
            except Exception as e:
                err_str = str(e)
                logger.error("Streaming chunk error: %s", e, exc_info=True)
                if "429" in err_str or "quota" in err_str.lower() or "limit" in err_str.lower():
                    yield local_agent_fallback(user_message, language)
                    yield suggestions_footer
                else:
                    yield "\n\nI encountered an issue generating a response. Please try again."

        return Response(stream_with_context(generate()), mimetype="text/plain")

    except Exception as exc:
        err_str = str(exc)
        logger.error("Chat endpoint error: %s", exc, exc_info=True)
        if (
            "429" in err_str
            or "quota" in err_str.lower()
            or "GROQ_API_KEY" in err_str
            or "api_key" in err_str.lower()
        ):
            def generate_mock():
                yield local_agent_fallback(user_message, language)
                yield suggestions_footer
            return Response(stream_with_context(generate_mock()), mimetype="text/plain")

        return error_response(
            "AI service is temporarily unavailable. Please try again shortly.", status=500
        )


# ── Feedback Endpoint ──────────────────────────────────────────────────────

@chat_bp.route("/feedback", methods=["POST"])
def feedback():
    """
    Record user feedback (thumbs up / thumbs down) on an AI response.

    Request JSON:
    {
        "rating":   "up" | "down",          (required)
        "message":  "The user's question",  (optional, for context)
        "reply":    "The AI's answer",      (optional, for context)
        "intent":   "HOW_TO_VOTE",          (optional)
    }

    Response JSON (200):
    { "ok": true }
    """
    data = request.get_json(silent=True)
    if not data:
        return error_response("Missing request body")

    rating = data.get("rating", "").strip().lower()
    if rating not in ("up", "down"):
        return error_response("'rating' must be 'up' or 'down'")

    # Log feedback for analysis — no DB needed for now
    logger.info(
        "FEEDBACK rating=%s | intent=%s | message=%.80s | reply=%.80s",
        rating,
        data.get("intent", "unknown"),
        data.get("message", "")[:80],
        data.get("reply", "")[:80],
    )

    return jsonify({"ok": True})
