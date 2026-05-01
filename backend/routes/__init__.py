from .status import status_bp
from .civic import civic_bp


def register_routes(app):
    """Register all blueprints with the Flask app."""
    app.register_blueprint(status_bp, url_prefix="/api")
    app.register_blueprint(civic_bp, url_prefix="/api/civic")
