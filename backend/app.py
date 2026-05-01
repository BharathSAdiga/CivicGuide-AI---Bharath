"""
app.py — CivicGuide AI Flask application factory.

Usage:
    python app.py          # start local dev server
    gunicorn app:create_app()   # production via Gunicorn
"""

from flask import Flask
from flask_cors import CORS

from config import FLASK_HOST, FLASK_PORT, FLASK_DEBUG, CORS_ORIGINS
from routes import register_routes


def create_app() -> Flask:
    """
    Application factory — creates and configures the Flask app.

    Separating creation from startup allows the app to be imported
    in tests or WSGI servers without side-effects.
    """
    app = Flask(__name__)

    # ── CORS ──────────────────────────────────────────────────────────────
    # Allow only whitelisted origins; additional origins can be added via
    # the CORS_ORIGINS environment variable in .env.
    CORS(app, origins=CORS_ORIGINS)

    # ── Routes ────────────────────────────────────────────────────────────
    register_routes(app)

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(
        host=FLASK_HOST,
        port=FLASK_PORT,
        debug=FLASK_DEBUG,
    )
