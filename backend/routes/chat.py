import os
import google.generativeai as genai
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv

load_dotenv()

chat_bp = Blueprint("chat", __name__)

# ── Configure Gemini ─────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

SYSTEM_PROMPT = """
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

VOTING_AGE = 18


def build_context_prefix(user_context: dict) -> str:
    """
    Build a context string injected before each user message so Gemini
    can personalise responses based on name, age, and location.
    """
    name     = user_context.get("name", "").strip()
    age      = user_context.get("age")
    location = user_context.get("location", "").strip()

    lines = ["[USER CONTEXT — use this to personalise your response]"]

    if name:
        lines.append(f"- User's name: {name}")

    if age is not None:
        try:
            age_int = int(age)
            lines.append(f"- User's age: {age_int}")
            if age_int < VOTING_AGE:
                lines.append(
                    f"- IMPORTANT: This user is {age_int} years old and is NOT yet eligible "
                    f"to vote in India (minimum age is {VOTING_AGE}). "
                    "Acknowledge this kindly, explain when they will be eligible, "
                    "and suggest how they can prepare (e.g., getting an Aadhaar card, "
                    "learning about the process, encouraging family members to vote)."
                )
            else:
                lines.append(
                    f"- This user IS eligible to vote in India. "
                    "Guide them through the relevant steps confidently."
                )
        except (ValueError, TypeError):
            pass

    if location:
        lines.append(
            f"- User's location: {location}. "
            "Where applicable, tailor information to this state/district "
            "(e.g., local election commission offices, regional language options)."
        )

    lines.append("[END USER CONTEXT]\n")
    return "\n".join(lines)


def get_gemini_model():
    """Initialise and return the Gemini generative model."""
    if not GEMINI_API_KEY:
        raise EnvironmentError("GEMINI_API_KEY is not set in environment variables.")
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=SYSTEM_PROMPT,
    )


@chat_bp.route("/chat", methods=["POST"])
def chat():
    """
    Handle a chat message and return Gemini's response.

    Request JSON:
    {
        "message": "...",
        "history": [...],           (optional) multi-turn history
        "user_context": {           (optional) personalisation data
            "name": "...",
            "age": 20,
            "location": "..."
        }
    }

    Response JSON: { "reply": "...", "model": "gemini-1.5-flash" }
    """
    data = request.get_json(silent=True)

    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' field in request body"}), 400

    user_message  = data["message"].strip()
    history       = data.get("history", [])
    user_context  = data.get("user_context", {})

    if not user_message:
        return jsonify({"error": "'message' cannot be empty"}), 400

    # Inject user context as a prefix so Gemini personalises the reply
    if user_context:
        context_prefix = build_context_prefix(user_context)
        augmented_message = f"{context_prefix}\nUser question: {user_message}"
    else:
        augmented_message = user_message

    try:
        model = get_gemini_model()

        # Build a chat session with optional history
        chat_session = model.start_chat(history=history)
        response = chat_session.send_message(augmented_message)

        return jsonify({
            "reply": response.text,
            "model": "gemini-1.5-flash"
        }), 200

    except EnvironmentError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Gemini API error: {str(e)}"}), 500
