from .status import status_bp
from .civic import civic_bp
from .chat import chat_bp
from .eligibility import eligibility_bp


def register_routes(app):
    """Register all blueprints with the Flask app."""
    app.register_blueprint(status_bp, url_prefix="/api")
    app.register_blueprint(civic_bp, url_prefix="/api/civic")
    app.register_blueprint(chat_bp, url_prefix="/api")
    app.register_blueprint(eligibility_bp, url_prefix="/api")
