"""
app.py — CivicGuide AI Flask application factory.

Includes global error handlers so every unhandled error returns a consistent
JSON response rather than an HTML page (which would break frontend JSON parsing).

Usage:
    python app.py          # start local dev server
    gunicorn "app:create_app()"   # production via Gunicorn
"""

from flask import Flask, jsonify
from flask_cors import CORS

from config import FLASK_HOST, FLASK_PORT, FLASK_DEBUG, CORS_ORIGINS
from routes import register_routes
from rag import load_knowledge_base



def create_app() -> Flask:
    """
    Application factory — creates and configures the Flask app.

    Separating creation from startup allows the app to be imported
    in tests or WSGI servers without side-effects.
    """
    app = Flask(__name__)

    # ── CORS ──────────────────────────────────────────────────────────────
    # Allow only whitelisted origins. Add more via the CORS_ORIGINS env var.
    CORS(app, origins=CORS_ORIGINS)

    # ── Routes ────────────────────────────────────────────────────────────
    register_routes(app)

    # ── Knowledge Base ────────────────────────────────────────────────────
    # Pre-load the RAG knowledge base on startup so the first request is fast
    load_knowledge_base()

    # ── Global Error Handlers ──────────────────────────────────────────────
    # These ensure every error — even unhandled ones — returns JSON so the
    # frontend's JSON parsing never breaks on an unexpected HTML page.

    @app.errorhandler(400)
    def bad_request(err):
        """Malformed request body or invalid JSON."""
        return jsonify({"error": "Bad request", "detail": str(err)}), 400

    @app.errorhandler(404)
    def not_found(err):
        """Route does not exist."""
        return jsonify({"error": "Endpoint not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(err):
        """HTTP method not supported on this route."""
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(413)
    def request_too_large(err):
        """Request payload exceeds the configured MAX_CONTENT_LENGTH."""
        return jsonify({"error": "Request body too large"}), 413

    @app.errorhandler(429)
    def too_many_requests(err):
        """Rate limit exceeded (if a rate-limiter is added in future)."""
        return jsonify({"error": "Too many requests — please slow down"}), 429

    @app.errorhandler(500)
    def internal_error(err):
        """Unhandled server-side exception."""
        # Do NOT expose err details to the client in production.
        return jsonify({"error": "Internal server error — please try again"}), 500

    @app.errorhandler(Exception)
    def unhandled_exception(err):
        """Catch-all for any exception not caught by a route handler."""
        app.logger.exception("Unhandled exception: %s", err)
        return jsonify({"error": "An unexpected error occurred"}), 500

    # ── Request size limit ─────────────────────────────────────────────────
    # Prevent extremely large payloads from reaching route handlers.
    # 1 MB is well above anything a chat message should need.
    app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024  # 1 MB

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=FLASK_DEBUG,
    )
