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
"""

from google import genai
from google.genai import types
from flask import Blueprint, request, Response, stream_with_context

from config import (
    GEMINI_API_KEY, GEMINI_MODEL, VOTING_AGE, SUPPORTED_LANGUAGES,
    CHAT_MAX_MESSAGE_LENGTH, CHAT_MAX_HISTORY_TURNS,
)
from utils import error_response, success_response
from rag import retrieve

chat_bp = Blueprint("chat", __name__)


# ── Gemini Client (module-level singleton) ─────────────────────────────────
# Initialised once; reused across all requests in this process.
# Will be None if GEMINI_API_KEY is missing — checked at request time.
_client: genai.Client | None = None


def get_client() -> genai.Client:
    """
    Return the module-level Gemini client, creating it on first call.

    Raises:
        EnvironmentError: If GEMINI_API_KEY is missing or empty.
    """
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise EnvironmentError(
                "GEMINI_API_KEY is not set. "
                "Add it to backend/.env or your environment variables."
            )
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


# ── System Prompt ──────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are CivicGuide AI — a beginner-friendly assistant that helps Indian citizens
understand elections, civic processes, and voting.

## YOUR GOAL
Make every response clear, structured, and easy to understand — even for someone
who has never voted before or knows nothing about elections.

## STRICT RESPONSE FORMAT
Always structure your response using the following sections (only include sections
that are relevant to the question):

**📋 Step-by-Step Process**
- Number each step clearly (1, 2, 3...)
- One action per step — keep it short and specific
- Use simple verbs: "Visit", "Fill", "Submit", "Wait", "Collect"

**💡 Key Points to Remember**
- Bullet list of the most important facts
- Include deadlines, eligibility rules, or common mistakes to avoid
- Max 5 bullets — be concise

**📄 Required Documents**
- Bullet list of documents needed (if applicable)
- Mention both primary and alternative documents where relevant

## TONE & STYLE RULES
- Write like you're explaining to a first-time voter or a school student
- Use short sentences — never more than 2 lines per point
- Avoid legal jargon; if a term is unavoidable, explain it in brackets
- Never write long paragraphs — always use lists or short bullets
- Be warm, encouraging, and supportive
- Address the user by their first name when you know it
- If the question is unclear, ask one clarifying question before answering

## ACCURACY
- All information must be accurate for India's current election system
- Reference the Election Commission of India (ECI) guidelines where relevant
- If you are unsure about something, clearly say so rather than guessing
"""


# ── Decision-Routing Patterns ──────────────────────────────────────────────
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

SPECIFIC_KEYWORDS: frozenset[str] = frozenset([
    "register", "eligible", "booth", "id", "aadhaar", "epic",
    "nota", "evm", "commission", "lok sabha", "rajya sabha", "assembly",
])


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

    Rules:
    1. How-to-vote gate — redirect under-age users to eligibility guidance.
    2. Vague question gate — ask Gemini to request clarification first.
    """
    msg_lower    = message.lower()
    instructions = []

    # Rule 1: How-to-vote eligibility gate
    if any(pattern in msg_lower for pattern in HOW_TO_VOTE_PATTERNS):
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

    # Rule 2: Vague question gate
    word_count           = len(message.split())
    is_short             = word_count <= VAGUE_WORD_THRESHOLD
    has_specific_keyword = any(kw in msg_lower for kw in SPECIFIC_KEYWORDS)
    is_how_to_vote_query = any(p in msg_lower for p in HOW_TO_VOTE_PATTERNS)

    if (
        is_short
        and not is_how_to_vote_query
        and not has_specific_keyword
        and any(p in msg_lower for p in VAGUE_PATTERNS)
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


def history_to_contents(history: list[dict]) -> list[types.Content]:
    """
    Convert the [{role, parts: [str]}] history format stored client-side
    into the list[types.Content] format required by the new google.genai SDK.

    Args:
        history: List of turn dicts already sanitized and capped by the endpoint.

    Returns:
        List of types.Content objects ready to pass to client.chats.create().
    """
    contents = []
    for turn in history:
        role  = turn["role"]   # "user" | "model"
        parts = [types.Part.from_text(text=p) for p in turn["parts"] if isinstance(p, str)]
        if parts:
            contents.append(types.Content(role=role, parts=parts))
    return contents


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
    user_context = data.get("user_context") or {}
    if not isinstance(user_context, dict):
        user_context = {}

    language = data.get("language", "english")
    if not isinstance(language, str):
        language = "english"
    language = language.lower().strip()
    if language not in SUPPORTED_LANGUAGES:
        language = "english"

    # ── Retrieve knowledge base context (RAG) ──────────────────────────────
    retrieved_context = retrieve(user_message)
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
        f"User question: {user_message}",
    ])
    augmented_message = "\n".join(prompt_parts)

    # ── Call Gemini via new google.genai SDK ───────────────────────────────
    try:
        client  = get_client()
        session = client.chats.create(
            model=GEMINI_MODEL,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.7,
                max_output_tokens=1024,
            ),
            history=history_to_contents(history),
        )
        response_stream = session.send_message_stream(augmented_message)

        def generate():
            try:
                for chunk in response_stream:
                    if chunk.text:
                        yield chunk.text
            except Exception as e:
                yield f"\\n\\n[Error: {str(e)}]"
        
        return Response(stream_with_context(generate()), mimetype='text/plain')

    except EnvironmentError as exc:
        return error_response(str(exc), status=500)

    except Exception as exc:  # noqa: BLE001
        return error_response(f"AI service error: {exc}", status=500)
