"""
routes/__init__.py — Blueprint registry for CivicGuide AI.

Every Flask blueprint is imported here and registered on the app
via `register_routes()`.  Adding a new feature means:
  1. Create the blueprint file in this package.
  2. Import and register it below — nowhere else needs to change.

URL prefix conventions:
  /api          → platform-level endpoints (status, chat)
  /api/civic    → legacy civic-query endpoints
  /api/…        → feature-specific endpoints (eligibility, timeline, booths)
"""

from .status      import status_bp
from .civic       import civic_bp
from .chat        import chat_bp
from .eligibility import eligibility_bp
from .timeline    import timeline_bp
from .booths      import booths_bp


def register_routes(app) -> None:
    """
    Register all feature blueprints with the Flask application.

    Called once inside `create_app()` in app.py.
    """
    app.register_blueprint(status_bp,      url_prefix="/api")
    app.register_blueprint(civic_bp,       url_prefix="/api/civic")
    app.register_blueprint(chat_bp,        url_prefix="/api")
    app.register_blueprint(eligibility_bp, url_prefix="/api")
    app.register_blueprint(timeline_bp,    url_prefix="/api")
    app.register_blueprint(booths_bp,      url_prefix="/api")
