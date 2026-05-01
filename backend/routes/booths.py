"""
routes/booths.py — Nearest polling booth finder endpoint.

Endpoints
---------
POST /api/booths/nearest
    Given a latitude/longitude, return the N closest polling booths
    ranked by Haversine (great-circle) distance.

GET /api/booths
    Return all booths in the mock dataset (used to seed the map on load).

Data note
---------
Booth data is currently mocked for demonstration purposes.  In production
this would be replaced with a live query against the ECI Electoral Roll
database or a PostGIS-enabled PostgreSQL instance.
"""

import math

from flask import Blueprint, request

from config import BOOTH_LIMIT_DEFAULT, BOOTH_LIMIT_MAX
from utils  import error_response, success_response

booths_bp = Blueprint("booths", __name__)


# ── Mock Polling Booth Dataset ─────────────────────────────────────────────
# 17 booths spread across 8 major Indian cities with realistic coordinates.
# Each booth record matches the schema expected by the frontend.
# Fields:
#   id          — unique booth identifier (city prefix + 3-digit sequence)
#   name        — official name of the school / building
#   address     — full street address with PIN code
#   ward        — electoral ward / area name
#   city        — city name
#   state       — state name
#   lat / lng   — WGS84 coordinates
#   booths      — number of individual voting compartments at this location
#   capacity    — approximate voter capacity
#   accessible  — True if the building is wheelchair accessible

MOCK_BOOTHS: list[dict] = [
    # ── Bengaluru ──────────────────────────────────────────────────────────
    {
        "id": "BLR001", "name": "Government High School, Koramangala",
        "address": "80 Feet Road, Koramangala 4th Block, Bengaluru 560034",
        "ward": "Koramangala", "city": "Bengaluru", "state": "Karnataka",
        "lat": 12.9352, "lng": 77.6245, "booths": 4, "capacity": 1200, "accessible": True,
    },
    {
        "id": "BLR002", "name": "BBMP Primary School, Indiranagar",
        "address": "CMH Road, Indiranagar, Bengaluru 560038",
        "ward": "Indiranagar", "city": "Bengaluru", "state": "Karnataka",
        "lat": 12.9784, "lng": 77.6408, "booths": 3, "capacity": 900, "accessible": True,
    },
    {
        "id": "BLR003", "name": "Kendriya Vidyalaya, Jayanagar",
        "address": "11th Main Road, Jayanagar 4th Block, Bengaluru 560041",
        "ward": "Jayanagar", "city": "Bengaluru", "state": "Karnataka",
        "lat": 12.9250, "lng": 77.5938, "booths": 5, "capacity": 1500, "accessible": True,
    },
    # ── Mumbai ─────────────────────────────────────────────────────────────
    {
        "id": "MUM001", "name": "Municipal School, Bandra West",
        "address": "SV Road, Bandra West, Mumbai 400050",
        "ward": "Bandra West", "city": "Mumbai", "state": "Maharashtra",
        "lat": 19.0596, "lng": 72.8295, "booths": 6, "capacity": 1800, "accessible": True,
    },
    {
        "id": "MUM002", "name": "BMC School, Andheri East",
        "address": "Marol Pipeline Road, Andheri East, Mumbai 400059",
        "ward": "Andheri East", "city": "Mumbai", "state": "Maharashtra",
        "lat": 19.1136, "lng": 72.8697, "booths": 4, "capacity": 1200, "accessible": False,
    },
    {
        "id": "MUM003", "name": "Government School, Dadar",
        "address": "Dadar West, Mumbai 400028",
        "ward": "Dadar", "city": "Mumbai", "state": "Maharashtra",
        "lat": 19.0178, "lng": 72.8478, "booths": 5, "capacity": 1500, "accessible": True,
    },
    # ── Delhi ──────────────────────────────────────────────────────────────
    {
        "id": "DEL001", "name": "Govt. Boys Sr. Sec. School, Connaught Place",
        "address": "Block A, Connaught Place, New Delhi 110001",
        "ward": "Connaught Place", "city": "Delhi", "state": "Delhi",
        "lat": 28.6315, "lng": 77.2167, "booths": 7, "capacity": 2100, "accessible": True,
    },
    {
        "id": "DEL002", "name": "MCD Primary School, Lajpat Nagar",
        "address": "Ring Road, Lajpat Nagar II, New Delhi 110024",
        "ward": "Lajpat Nagar", "city": "Delhi", "state": "Delhi",
        "lat": 28.5665, "lng": 77.2433, "booths": 4, "capacity": 1200, "accessible": True,
    },
    {
        "id": "DEL003", "name": "Sarvodaya Bal Vidyalaya, Rohini",
        "address": "Sector 11, Rohini, New Delhi 110085",
        "ward": "Rohini", "city": "Delhi", "state": "Delhi",
        "lat": 28.7316, "lng": 77.1115, "booths": 5, "capacity": 1500, "accessible": False,
    },
    # ── Chennai ────────────────────────────────────────────────────────────
    {
        "id": "CHE001", "name": "Corporation School, T. Nagar",
        "address": "Usman Road, T. Nagar, Chennai 600017",
        "ward": "T. Nagar", "city": "Chennai", "state": "Tamil Nadu",
        "lat": 13.0418, "lng": 80.2341, "booths": 4, "capacity": 1200, "accessible": True,
    },
    {
        "id": "CHE002", "name": "Government Girls Hr. Sec. School, Anna Nagar",
        "address": "7th Avenue, Anna Nagar, Chennai 600040",
        "ward": "Anna Nagar", "city": "Chennai", "state": "Tamil Nadu",
        "lat": 13.0850, "lng": 80.2101, "booths": 3, "capacity": 900, "accessible": True,
    },
    # ── Hyderabad ──────────────────────────────────────────────────────────
    {
        "id": "HYD001", "name": "GHMC School, Banjara Hills",
        "address": "Road No. 12, Banjara Hills, Hyderabad 500034",
        "ward": "Banjara Hills", "city": "Hyderabad", "state": "Telangana",
        "lat": 17.4156, "lng": 78.4347, "booths": 5, "capacity": 1500, "accessible": True,
    },
    {
        "id": "HYD002", "name": "Government School, Secunderabad",
        "address": "MG Road, Secunderabad, Hyderabad 500003",
        "ward": "Secunderabad", "city": "Hyderabad", "state": "Telangana",
        "lat": 17.4399, "lng": 78.4983, "booths": 4, "capacity": 1200, "accessible": True,
    },
    # ── Kolkata ────────────────────────────────────────────────────────────
    {
        "id": "KOL001", "name": "KMC School, Salt Lake City",
        "address": "Sector V, Salt Lake City, Kolkata 700091",
        "ward": "Salt Lake", "city": "Kolkata", "state": "West Bengal",
        "lat": 22.5770, "lng": 88.4321, "booths": 4, "capacity": 1200, "accessible": True,
    },
    {
        "id": "KOL002", "name": "Corporation School, Park Street",
        "address": "Park Street, Kolkata 700016",
        "ward": "Park Street", "city": "Kolkata", "state": "West Bengal",
        "lat": 22.5514, "lng": 88.3527, "booths": 3, "capacity": 900, "accessible": True,
    },
    # ── Pune ───────────────────────────────────────────────────────────────
    {
        "id": "PUN001", "name": "PMC School, Koregaon Park",
        "address": "North Main Road, Koregaon Park, Pune 411001",
        "ward": "Koregaon Park", "city": "Pune", "state": "Maharashtra",
        "lat": 18.5362, "lng": 73.8937, "booths": 4, "capacity": 1200, "accessible": True,
    },
    # ── Ahmedabad ──────────────────────────────────────────────────────────
    {
        "id": "AHM001", "name": "AMC School, Navrangpura",
        "address": "CG Road, Navrangpura, Ahmedabad 380009",
        "ward": "Navrangpura", "city": "Ahmedabad", "state": "Gujarat",
        "lat": 23.0395, "lng": 72.5626, "booths": 5, "capacity": 1500, "accessible": True,
    },
]

# Disclaimer appended to every response that includes mock data.
MOCK_DATA_NOTE = (
    "This is sample/mock data for demonstration purposes. "
    "In production, booths are retrieved from the ECI Electoral Roll database."
)


# ── Distance Calculation ───────────────────────────────────────────────────

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Calculate the great-circle distance between two geographic points.

    Uses the Haversine formula, which accounts for Earth's curvature.
    Accurate to within ~0.5% for distances up to a few hundred kilometres.

    Args:
        lat1, lng1: Origin coordinates in decimal degrees.
        lat2, lng2: Destination coordinates in decimal degrees.

    Returns:
        Distance in kilometres, rounded to 2 decimal places.
    """
    R = 6371.0  # Earth's mean radius in km

    phi1  = math.radians(lat1)
    phi2  = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    )
    return round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 2)


# ── Endpoints ──────────────────────────────────────────────────────────────

@booths_bp.route("/booths/nearest", methods=["POST"])
def nearest_booths():
    """
    Return the nearest polling booths to a given coordinate.

    Request JSON:
    {
        "lat":   12.9352,   (required) latitude  — must be in [-90, 90]
        "lng":   77.6245,   (required) longitude — must be in [-180, 180]
        "limit": 3          (optional) number of results; default 3, max 5
    }

    Response JSON (200):
    {
        "query":       { "lat": ..., "lng": ... },
        "booths":      [ { ...booth fields..., "distance_km": 1.23 } ],
        "total_found": 3,
        "note":        "Mock data..."
    }

    Error JSON (400):
    { "error": "..." }
    """
    data = request.get_json(silent=True)
    if not data:
        return error_response("Request body must be valid JSON")

    # ── Validate lat / lng ─────────────────────────────────────────────────
    lat_raw = data.get("lat")
    lng_raw = data.get("lng")

    if lat_raw is None or lng_raw is None:
        return error_response("Both 'lat' and 'lng' are required")

    try:
        lat = float(lat_raw)
        lng = float(lng_raw)
        if not (-90 <= lat <= 90):
            raise ValueError("Latitude out of range")
        if not (-180 <= lng <= 180):
            raise ValueError("Longitude out of range")
    except (ValueError, TypeError):
        return error_response("'lat' must be in [-90, 90] and 'lng' must be in [-180, 180]")

    # ── Parse and clamp limit ──────────────────────────────────────────────
    try:
        limit = min(int(data.get("limit", BOOTH_LIMIT_DEFAULT)), BOOTH_LIMIT_MAX)
    except (ValueError, TypeError):
        limit = BOOTH_LIMIT_DEFAULT

    # ── Compute distances and sort ─────────────────────────────────────────
    booths_with_distance = [
        {**booth, "distance_km": haversine_km(lat, lng, booth["lat"], booth["lng"])}
        for booth in MOCK_BOOTHS
    ]
    booths_with_distance.sort(key=lambda b: b["distance_km"])
    nearest = booths_with_distance[:limit]

    return success_response({
        "query":       {"lat": lat, "lng": lng},
        "booths":      nearest,
        "total_found": len(nearest),
        "note":        MOCK_DATA_NOTE,
    })


@booths_bp.route("/booths", methods=["GET"])
def list_booths():
    """
    Return all mock booths in the dataset.

    Intended for map initialisation — the client seeds the map with all
    known booths before the user enters a location.

    Response JSON (200):
    {
        "booths": [...],
        "total":  17,
        "note":   "Mock data..."
    }
    """
    return success_response({
        "booths": MOCK_BOOTHS,
        "total":  len(MOCK_BOOTHS),
        "note":   MOCK_DATA_NOTE,
    })
