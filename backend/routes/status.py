from flask import Blueprint, jsonify
from datetime import datetime, timezone

status_bp = Blueprint("status", __name__)


@status_bp.route("/status", methods=["GET"])
def get_status():
    """Health-check endpoint."""
    return jsonify({
        "status": "ok",
        "service": "CivicGuide AI Backend",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }), 200
