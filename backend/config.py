"""
config.py — CivicGuide AI centralized configuration.

All environment variables and app-wide constants are sourced here.
Import from this module rather than reading os.getenv() scattered across routes.
"""

import os
from dotenv import load_dotenv

# Load .env file (no-op in production if env vars are already set)
load_dotenv()


# ── Groq AI ─────────────────────────────────────────────────────────────
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL:   str = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

# ── Server ────────────────────────────────────────────────────────────────
FLASK_HOST:  str = os.getenv("FLASK_HOST", "0.0.0.0")
FLASK_PORT:  int = int(os.getenv("FLASK_PORT", "5000"))
FLASK_DEBUG: bool = os.getenv("FLASK_DEBUG", "1") == "1"

# ── CORS ──────────────────────────────────────────────────────────────────
# Comma-separated origins; defaults cover local dev (Live Server + React dev)
_CORS_RAW: str = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:5500,http://localhost:5500"
)
CORS_ORIGINS: list[str] = [o.strip() for o in _CORS_RAW.split(",") if o.strip()]

# ── Business Logic ────────────────────────────────────────────────────────
VOTING_AGE: int = 18                  # Minimum age to vote in India
BOOTH_LIMIT_MAX: int = 5              # Hard cap on nearest-booths responses
BOOTH_LIMIT_DEFAULT: int = 3          # Default number of nearest booths returned

# ── Chat Input Limits ─────────────────────────────────────────────────────
# Enforced server-side to prevent prompt injection and oversized Gemini calls.
CHAT_MAX_MESSAGE_LENGTH: int = 1_000  # Characters — prevents prompt injection
CHAT_MAX_HISTORY_TURNS: int  = 20     # Message turns — caps token usage
CHAT_MIN_MESSAGE_LENGTH: int = 1      # Disallow whitespace-only messages

# ── Location Input Limits ─────────────────────────────────────────────────
LOCATION_MIN_LENGTH: int = 2          # Min chars for a booth search query
LOCATION_MAX_LENGTH: int = 200        # Prevents oversized geocoder requests

# ── Supported Languages ───────────────────────────────────────────────────
SUPPORTED_LANGUAGES: set[str] = {"english", "hindi"}
DEFAULT_LANGUAGE: str = "english"

# ── Supported Election Types ──────────────────────────────────────────────
SUPPORTED_ELECTION_TYPES: set[str] = {
    "lok_sabha", "state_assembly", "rajya_sabha", "local_body"
}
DEFAULT_ELECTION_TYPE: str = "lok_sabha"
