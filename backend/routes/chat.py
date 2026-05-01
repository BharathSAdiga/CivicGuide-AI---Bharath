"""
routes/chat.py — Gemini AI chat endpoint for CivicGuide AI.

Endpoints
---------
POST /api/chat
    Accepts a user message and optional conversation history, user context
    (name / age / location), and language preference.  Applies decision-based
    routing before forwarding to Gemini so responses are always relevant.

Design decisions
----------------
- The Gemini model is lazily initialised (get_gemini_model) so startup errors
  are surfaced at request time with a clear 500 message, not at import time.
- Decision routing (build_decision_prefix) runs BEFORE the Gemini call so the
  model always has the right framing — no post-processing needed.
- Language injection is done via a plain-text directive inside the prompt rather
  than a separate translation API call, keeping latency low.
- All public helper functions are module-level (not nested) so they are
  independently testable.
"""

import google.generativeai as genai
from flask import Blueprint, request

from config import GEMINI_API_KEY, GEMINI_MODEL, VOTING_AGE, SUPPORTED_LANGUAGES
from utils  import error_response, success_response

chat_bp = Blueprint("chat", __name__)


# ── System Prompt ──────────────────────────────────────────────────────────
# This is injected as the model's system instruction on every call.
# It defines the assistant's persona, response format, tone, and accuracy rules.
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
# Phrases that indicate the user is asking about the voting procedure itself.
# Used to gate the response based on the user's eligibility.
HOW_TO_VOTE_PATTERNS: list[str] = [
    "how to vote", "how do i vote", "how can i vote",
    "voting process", "how to cast", "cast my vote",
    "steps to vote", "voting steps", "voting procedure",
    "कैसे वोट", "वोट कैसे डालें",
]

# Filler phrases that alone signal a vague / incomplete question.
VAGUE_PATTERNS: list[str] = [
    "tell me", "explain", "what about", "and", "also",
    "give me info", "more info", "details", "information",
]

# Messages with fewer words than this threshold AND a vague pattern trigger
# a clarification request instead of a direct answer.
VAGUE_WORD_THRESHOLD: int = 6

# Keywords that — even in short messages — indicate a specific enough question
# that we should NOT ask for clarification.
SPECIFIC_KEYWORDS: frozenset[str] = frozenset([
    "register", "eligible", "booth", "id", "aadhaar", "epic",
    "nota", "evm", "commission", "lok sabha", "rajya sabha", "assembly",
])


# ── Gemini Model Factory ───────────────────────────────────────────────────

def get_gemini_model() -> genai.GenerativeModel:
    """
    Initialise and return the Gemini generative model.

    Raises:
        EnvironmentError: If GEMINI_API_KEY is missing or empty.

    Note:
        genai.configure() is idempotent — safe to call on every request.
        Consider caching the model instance at module level if latency matters.
    """
    if not GEMINI_API_KEY:
        raise EnvironmentError(
            "GEMINI_API_KEY is not set. "
            "Add it to backend/.env or your environment variables."
        )
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        system_instruction=SYSTEM_PROMPT,
    )


# ── Context Builders ───────────────────────────────────────────────────────

def build_context_prefix(user_context: dict) -> str:
    """
    Build a plain-text block injected before the user's message so Gemini
    can personalise responses based on who the user is.

    Args:
        user_context: Dict with optional keys: name (str), age (int|str),
                      location (str).

    Returns:
        Multi-line string to prepend to the augmented prompt, or empty
        string if user_context is falsy.
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
            # Age is not a valid integer — skip the age line silently.
            pass

    if location:
        lines.append(
            f"- User's location: {location}. "
            "Where applicable, tailor information to this state/district "
            "(e.g., local election commission offices, regional language options)."
        )

    lines.append("[END USER CONTEXT]\n")
    return "\n".join(lines)


def build_decision_prefix(message: str, user_context: dict) -> str:
    """
    Analyse the user's message and inject conditional instructions for Gemini
    BEFORE the question is sent.

    Two routing rules:
    1. "How to vote" gate — if the user is under voting age, redirect them to
       eligibility guidance instead of the full voting steps.
    2. Vague question gate — if the message is short and non-specific, ask
       Gemini to request one clarifying question before answering.

    Args:
        message:      Raw user message string.
        user_context: User context dict (may be empty).

    Returns:
        Instruction string to prepend, or empty string if no routing applies.
    """
    msg_lower    = message.lower()
    instructions = []

    # ── Rule 1: How-to-vote eligibility gate ──────────────────────────────
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
                "and suggest preparatory steps (getting Aadhaar, learning the process, "
                "encouraging family to vote). Do NOT provide the full voting steps yet."
            )
        else:
            instructions.append(
                "[DECISION LOGIC] The user asked how to vote and appears eligible. "
                "Provide the full step-by-step voting process in your structured format."
            )

    # ── Rule 2: Vague question gate ───────────────────────────────────────
    word_count = len(message.split())
    is_short   = word_count <= VAGUE_WORD_THRESHOLD
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
            "Ask ONE specific clarifying question to understand what they need "
            "before giving a full answer. Keep it friendly and concise."
        )

    return "\n".join(instructions)


def build_language_instruction(language: str) -> str:
    """
    Return a prompt directive that tells Gemini which language to respond in.

    Args:
        language: Normalised language string ("english" | "hindi").

    Returns:
        Instruction string, or empty string for the default (English).
    """
    if language == "hindi":
        return (
            "[LANGUAGE] Respond entirely in Hindi (Devanagari script). "
            "Use simple, everyday Hindi — avoid complex Sanskrit terms. "
            "Keep the same structured format (sections, numbered lists, bullets)."
        )
    # English is the default — no extra instruction needed.
    return ""


# ── Chat Endpoint ──────────────────────────────────────────────────────────

@chat_bp.route("/chat", methods=["POST"])
def chat():
    """
    Process a chat message and return a Gemini AI response.

    Request JSON:
    {
        "message":      "How do I register to vote?",   (required)
        "history":      [ ... ],                        (optional) prior turns
        "user_context": {                               (optional) personalisation
            "name":     "Asha",
            "age":      22,
            "location": "Chennai, Tamil Nadu"
        },
        "language": "english" | "hindi"                 (optional, default "english")
    }

    Response JSON (200):
    {
        "reply":    "...",
        "model":    "gemini-1.5-flash",
        "language": "english"
    }

    Error JSON (400 / 500):
    { "error": "..." }
    """
    data = request.get_json(silent=True)

    # ── Input validation ───────────────────────────────────────────────────
    if not data or "message" not in data:
        return error_response("Missing 'message' field in request body")

    user_message = data["message"].strip()
    if not user_message:
        return error_response("'message' cannot be empty")

    # ── Parse optional fields ──────────────────────────────────────────────
    history      = data.get("history", [])
    user_context = data.get("user_context") or {}
    language     = data.get("language", "english").lower().strip()

    # Normalise unsupported language values to the default.
    if language not in SUPPORTED_LANGUAGES:
        language = "english"

    # ── Build the augmented prompt ─────────────────────────────────────────
    # Each builder returns an empty string if not applicable, so filter(None)
    # removes gaps cleanly before joining.
    prompt_parts = filter(None, [
        build_context_prefix(user_context),     # Who the user is
        build_decision_prefix(user_message, user_context),  # Routing rules
        build_language_instruction(language),   # Output language
        f"User question: {user_message}",       # The actual question
    ])
    augmented_message = "\n".join(prompt_parts)

    # ── Call Gemini ────────────────────────────────────────────────────────
    try:
        model        = get_gemini_model()
        chat_session = model.start_chat(history=history)
        response     = chat_session.send_message(augmented_message)

        return success_response({
            "reply":    response.text,
            "model":    GEMINI_MODEL,
            "language": language,
        })

    except EnvironmentError as exc:
        # Missing API key — configuration error, not a transient failure.
        return error_response(str(exc), status=500)

    except Exception as exc:  # noqa: BLE001
        # Gemini API errors: quota exceeded, network issues, etc.
        return error_response(f"Gemini API error: {exc}", status=500)
