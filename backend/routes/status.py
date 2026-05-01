"""
routes/status.py — Health-check endpoint.

GET /api/status
    Returns service name, version, and current UTC timestamp.
    Used by the frontend to verify the backend is reachable before
    making feature API calls.
"""

from datetime import datetime, timezone

from flask import Blueprint

from utils import success_response

status_bp = Blueprint("status", __name__)

# Semantic version — bump when releasing a new build.
API_VERSION = "1.1.0"


@status_bp.route("/status", methods=["GET"])
def get_status():
    """
    Health-check endpoint.

    Response JSON:
    {
        "status":    "ok",
        "service":   "CivicGuide AI Backend",
        "version":   "1.1.0",
        "timestamp": "2026-05-01T12:00:00+00:00"
    }
    """
    return success_response({
        "status":    "ok",
        "service":   "CivicGuide AI Backend",
        "version":   API_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
