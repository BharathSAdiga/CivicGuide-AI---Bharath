"""
utils.py — CivicGuide AI shared backend utilities.

Provides consistent JSON error helpers and response builders so every
route returns the same shape of error object.
"""

from flask import jsonify


def error_response(message: str, status: int = 400):
    """
    Return a standardised JSON error response.

    Args:
        message: Human-readable error description.
        status:  HTTP status code (default 400).

    Returns:
        Flask Response tuple (json, status).

    Example:
        return error_response("'age' field is required", 400)
    """
    return jsonify({"error": message}), status


def success_response(payload: dict, status: int = 200):
    """
    Return a standardised JSON success response.

    Args:
        payload: Dict to serialize as JSON.
        status:  HTTP status code (default 200).

    Returns:
        Flask Response tuple (json, status).
    """
    return jsonify(payload), status


def validate_json_body(data, *required_fields: str):
    """
    Validate that a parsed JSON body is not None and contains required fields.

    Args:
        data:            Parsed JSON dict (or None if parsing failed).
        *required_fields: Field names that must be present.

    Returns:
        str | None: Error message if invalid, else None.

    Example:
        err = validate_json_body(data, "age", "citizenship")
        if err:
            return error_response(err)
    """
    if data is None:
        return "Request body must be valid JSON"
    for field in required_fields:
        if field not in data:
            return f"Missing required field: '{field}'"
    return None
