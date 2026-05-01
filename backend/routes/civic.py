from flask import Blueprint, request, jsonify

civic_bp = Blueprint("civic", __name__)


@civic_bp.route("/query", methods=["POST"])
def civic_query():
    """
    Handle a civic query from the frontend.
    Expects JSON: { "question": "...", "location": "..." (optional) }
    """
    data = request.get_json(silent=True)

    if not data or "question" not in data:
        return jsonify({"error": "Missing 'question' field in request body"}), 400

    question = data["question"].strip()
    location = data.get("location", "general").strip()

    if not question:
        return jsonify({"error": "'question' cannot be empty"}), 400

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

    return jsonify(response), 200


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
    return jsonify({"services": services, "total": len(services)}), 200
