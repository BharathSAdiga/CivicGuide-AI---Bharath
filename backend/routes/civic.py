from flask import Blueprint, request
from utils import error_response, success_response

civic_bp = Blueprint("civic", __name__)


@civic_bp.route("/query", methods=["POST"])
def civic_query():
    """
    Handle a civic query from the frontend.
    Expects JSON: { "question": "...", "location": "..." (optional) }
    """
    data = request.get_json(silent=True)

    if not data or "question" not in data:
        return error_response("Missing 'question' field in request body")

    question = data["question"].strip()
    location = data.get("location", "general").strip()

    if not question:
        return error_response("'question' cannot be empty")

    # TODO: Integrate AI model / RAG pipeline here
    response = {
        "question": question,
        "location": location,
        "answer": (
            f"Thank you for your question about '{question}'. "
            f"CivicGuide AI is processing your query for {location}. "
            "Full AI integration coming soon."
        ),
        "sources": [],
        "next_steps": [
            "Verify the relevant government portal for your region.",
            "Gather required documents listed in our guide.",
            "Contact the local civic office if assistance is needed."
        ]
    }

    return success_response(response)


@civic_bp.route("/services", methods=["GET"])
def list_services():
    """Return a list of supported civic service categories."""
    services = [
        {"id": "identity", "name": "Identity & Documents", "icon": "🪪"},
        {"id": "voting", "name": "Voting & Elections", "icon": "🗳️"},
        {"id": "tax", "name": "Taxes & Finance", "icon": "💰"},
        {"id": "permits", "name": "Permits & Licenses", "icon": "📋"},
        {"id": "healthcare", "name": "Public Healthcare", "icon": "🏥"},
        {"id": "education", "name": "Education & Scholarships", "icon": "🎓"},
    ]
    return success_response({"services": services, "total": len(services)})
