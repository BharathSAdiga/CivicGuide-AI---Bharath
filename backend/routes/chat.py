import os
import google.generativeai as genai
from flask import Blueprint, request, jsonify
from dotenv import load_dotenv

load_dotenv()

chat_bp = Blueprint("chat", __name__)

# ── Configure Gemini ─────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

SYSTEM_PROMPT = (
    "You are CivicGuide AI — a friendly, knowledgeable assistant that explains "
    "the election process in India in a simple, step-by-step way. "
    "Use clear language, avoid jargon, and break down complex procedures into "
    "easy-to-understand points. When listing steps or timelines, use numbered lists. "
    "Always be accurate, helpful, and encouraging to first-time voters."
)


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
    Request JSON: { "message": "...", "history": [...] (optional) }
    Response JSON: { "reply": "...", "model": "gemini-1.5-flash" }
    """
    data = request.get_json(silent=True)

    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' field in request body"}), 400

    user_message = data["message"].strip()
    history = data.get("history", [])   # list of { "role": "user"|"model", "parts": ["..."] }

    if not user_message:
        return jsonify({"error": "'message' cannot be empty"}), 400

    try:
        model = get_gemini_model()

        # Build a chat session with optional history
        chat_session = model.start_chat(history=history)
        response = chat_session.send_message(user_message)

        return jsonify({
            "reply": response.text,
            "model": "gemini-1.5-flash"
        }), 200

    except EnvironmentError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Gemini API error: {str(e)}"}), 500
