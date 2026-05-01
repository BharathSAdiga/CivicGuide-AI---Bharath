import math
from flask import Blueprint, request, jsonify

booths_bp = Blueprint("booths", __name__)

# ── Mock Polling Booth Dataset ─────────────────────────────
# Sample booths across major Indian cities with realistic coordinates.
# In production this would come from an ECI database or API.

MOCK_BOOTHS = [
    # ── Bengaluru ──────────────────────────────────────────
    {"id": "BLR001", "name": "Government High School, Koramangala",
     "address": "80 Feet Road, Koramangala 4th Block, Bengaluru 560034",
     "ward": "Koramangala", "city": "Bengaluru", "state": "Karnataka",
     "lat": 12.9352, "lng": 77.6245,
     "booths": 4, "capacity": 1200, "accessible": True},

    {"id": "BLR002", "name": "BBMP Primary School, Indiranagar",
     "address": "CMH Road, Indiranagar, Bengaluru 560038",
     "ward": "Indiranagar", "city": "Bengaluru", "state": "Karnataka",
     "lat": 12.9784, "lng": 77.6408,
     "booths": 3, "capacity": 900, "accessible": True},

    {"id": "BLR003", "name": "Kendriya Vidyalaya, Jayanagar",
     "address": "11th Main Road, Jayanagar 4th Block, Bengaluru 560041",
     "ward": "Jayanagar", "city": "Bengaluru", "state": "Karnataka",
     "lat": 12.9250, "lng": 77.5938,
     "booths": 5, "capacity": 1500, "accessible": True},

    # ── Mumbai ─────────────────────────────────────────────
    {"id": "MUM001", "name": "Municipal School, Bandra West",
     "address": "SV Road, Bandra West, Mumbai 400050",
     "ward": "Bandra West", "city": "Mumbai", "state": "Maharashtra",
     "lat": 19.0596, "lng": 72.8295,
     "booths": 6, "capacity": 1800, "accessible": True},

    {"id": "MUM002", "name": "BMC School, Andheri East",
     "address": "Marol Pipeline Road, Andheri East, Mumbai 400059",
     "ward": "Andheri East", "city": "Mumbai", "state": "Maharashtra",
     "lat": 19.1136, "lng": 72.8697,
     "booths": 4, "capacity": 1200, "accessible": False},

    {"id": "MUM003", "name": "Government School, Dadar",
     "address": "Dadar West, Mumbai 400028",
     "ward": "Dadar", "city": "Mumbai", "state": "Maharashtra",
     "lat": 19.0178, "lng": 72.8478,
     "booths": 5, "capacity": 1500, "accessible": True},

    # ── Delhi ──────────────────────────────────────────────
    {"id": "DEL001", "name": "Govt. Boys Sr. Sec. School, Connaught Place",
     "address": "Block A, Connaught Place, New Delhi 110001",
     "ward": "Connaught Place", "city": "Delhi", "state": "Delhi",
     "lat": 28.6315, "lng": 77.2167,
     "booths": 7, "capacity": 2100, "accessible": True},

    {"id": "DEL002", "name": "MCD Primary School, Lajpat Nagar",
     "address": "Ring Road, Lajpat Nagar II, New Delhi 110024",
     "ward": "Lajpat Nagar", "city": "Delhi", "state": "Delhi",
     "lat": 28.5665, "lng": 77.2433,
     "booths": 4, "capacity": 1200, "accessible": True},

    {"id": "DEL003", "name": "Sarvodaya Bal Vidyalaya, Rohini",
     "address": "Sector 11, Rohini, New Delhi 110085",
     "ward": "Rohini", "city": "Delhi", "state": "Delhi",
     "lat": 28.7316, "lng": 77.1115,
     "booths": 5, "capacity": 1500, "accessible": False},

    # ── Chennai ────────────────────────────────────────────
    {"id": "CHE001", "name": "Corporation School, T. Nagar",
     "address": "Usman Road, T. Nagar, Chennai 600017",
     "ward": "T. Nagar", "city": "Chennai", "state": "Tamil Nadu",
     "lat": 13.0418, "lng": 80.2341,
     "booths": 4, "capacity": 1200, "accessible": True},

    {"id": "CHE002", "name": "Government Girls Hr. Sec. School, Anna Nagar",
     "address": "7th Avenue, Anna Nagar, Chennai 600040",
     "ward": "Anna Nagar", "city": "Chennai", "state": "Tamil Nadu",
     "lat": 13.0850, "lng": 80.2101,
     "booths": 3, "capacity": 900, "accessible": True},

    # ── Hyderabad ──────────────────────────────────────────
    {"id": "HYD001", "name": "GHMC School, Banjara Hills",
     "address": "Road No. 12, Banjara Hills, Hyderabad 500034",
     "ward": "Banjara Hills", "city": "Hyderabad", "state": "Telangana",
     "lat": 17.4156, "lng": 78.4347,
     "booths": 5, "capacity": 1500, "accessible": True},

    {"id": "HYD002", "name": "Government School, Secunderabad",
     "address": "MG Road, Secunderabad, Hyderabad 500003",
     "ward": "Secunderabad", "city": "Hyderabad", "state": "Telangana",
     "lat": 17.4399, "lng": 78.4983,
     "booths": 4, "capacity": 1200, "accessible": True},

    # ── Kolkata ────────────────────────────────────────────
    {"id": "KOL001", "name": "KMC School, Salt Lake City",
     "address": "Sector V, Salt Lake City, Kolkata 700091",
     "ward": "Salt Lake", "city": "Kolkata", "state": "West Bengal",
     "lat": 22.5770, "lng": 88.4321,
     "booths": 4, "capacity": 1200, "accessible": True},

    {"id": "KOL002", "name": "Corporation School, Park Street",
     "address": "Park Street, Kolkata 700016",
     "ward": "Park Street", "city": "Kolkata", "state": "West Bengal",
     "lat": 22.5514, "lng": 88.3527,
     "booths": 3, "capacity": 900, "accessible": True},

    # ── Pune ───────────────────────────────────────────────
    {"id": "PUN001", "name": "PMC School, Koregaon Park",
     "address": "North Main Road, Koregaon Park, Pune 411001",
     "ward": "Koregaon Park", "city": "Pune", "state": "Maharashtra",
     "lat": 18.5362, "lng": 73.8937,
     "booths": 4, "capacity": 1200, "accessible": True},

    # ── Ahmedabad ──────────────────────────────────────────
    {"id": "AHM001", "name": "AMC School, Navrangpura",
     "address": "CG Road, Navrangpura, Ahmedabad 380009",
     "ward": "Navrangpura", "city": "Ahmedabad", "state": "Gujarat",
     "lat": 23.0395, "lng": 72.5626,
     "booths": 5, "capacity": 1500, "accessible": True},
]


# ── Haversine Distance ─────────────────────────────────────
def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in kilometres between two lat/lng points."""
    R = 6371.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lng2 - lng1)
    a = math.sin(Δφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@booths_bp.route("/booths/nearest", methods=["POST"])
def nearest_booths():
    """
    Find the nearest polling booths to a given location.

    Request JSON:
    {
        "lat": 12.9352,
        "lng": 77.6245,
        "limit": 3          (optional, default 3, max 5)
    }

    Response JSON:
    {
        "query": { "lat": ..., "lng": ... },
        "booths": [ { ...booth with distance_km... } ],
        "total_found": 3,
        "note": "Mock data — ..."
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be valid JSON"}), 400

    # Validate lat/lng
    lat_raw = data.get("lat")
    lng_raw = data.get("lng")

    if lat_raw is None or lng_raw is None:
        return jsonify({"error": "Both 'lat' and 'lng' are required"}), 400

    try:
        lat = float(lat_raw)
        lng = float(lng_raw)
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "'lat' must be -90…90 and 'lng' must be -180…180"}), 400

    limit = min(int(data.get("limit", 3)), 5)

    # Compute distance for every booth and sort
    booths_with_distance = []
    for booth in MOCK_BOOTHS:
        dist = haversine_km(lat, lng, booth["lat"], booth["lng"])
        booths_with_distance.append({**booth, "distance_km": round(dist, 2)})

    booths_with_distance.sort(key=lambda b: b["distance_km"])
    nearest = booths_with_distance[:limit]

    return jsonify({
        "query":       {"lat": lat, "lng": lng},
        "booths":      nearest,
        "total_found": len(nearest),
        "note": (
            "This is sample/mock data for demonstration purposes. "
            "In production, booths are retrieved from the ECI Electoral Roll database."
        )
    }), 200


@booths_bp.route("/booths", methods=["GET"])
def list_booths():
    """Return all mock booths (for map initialisation)."""
    return jsonify({
        "booths": MOCK_BOOTHS,
        "total": len(MOCK_BOOTHS),
        "note": "Mock data — for demonstration only."
    }), 200
