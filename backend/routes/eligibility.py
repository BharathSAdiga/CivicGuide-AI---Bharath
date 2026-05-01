from flask import Blueprint, request, jsonify

eligibility_bp = Blueprint("eligibility", __name__)

VOTING_AGE = 18


def evaluate_eligibility(age: int, is_citizen: bool) -> dict:
    """
    Core eligibility logic.
    Returns: { eligible, reasons, explanation, next_steps }
    """
    reasons = []

    # ── Age check ─────────────────────────────────────────
    age_ok = age >= VOTING_AGE
    if not age_ok:
        years_left = VOTING_AGE - age
        reasons.append(
            f"You are {age} years old. The minimum voting age in India is {VOTING_AGE}. "
            f"You will be eligible in {years_left} year{'s' if years_left != 1 else ''}."
        )

    # ── Citizenship check ──────────────────────────────────
    citizenship_ok = is_citizen
    if not citizenship_ok:
        reasons.append(
            "Only Indian citizens can vote in Indian elections. "
            "NRIs with valid Indian passports may be eligible for overseas voting — "
            "check the Election Commission of India (ECI) guidelines."
        )

    eligible = age_ok and citizenship_ok

    # ── Build result ───────────────────────────────────────
    if eligible:
        explanation = (
            f"Great news! You are {age} years old and an Indian citizen — "
            "you meet all the basic requirements to vote in Indian elections. "
            "The next step is to check if your name is on the Electoral Roll."
        )
        next_steps = [
            "Check if your name is on the Electoral Roll at voters.eci.gov.in.",
            "If not registered, apply online using Form 6 on the Voter Portal.",
            "Download or collect your Voter ID Card (EPIC) from your local BLO.",
            "On election day, carry a valid photo ID to the polling booth.",
            "Find your polling booth at voterportal.eci.gov.in."
        ]
    elif not age_ok and citizenship_ok:
        explanation = (
            f"You are {age} years old — you need to be at least {VOTING_AGE} to vote in India. "
            "But it's never too early to learn about the process and get your documents ready!"
        )
        next_steps = [
            "Apply for your Aadhaar Card now if you don't have one (needed for voter registration).",
            "Learn about the election process at eci.gov.in.",
            "Encourage your eligible family members and friends to vote.",
            f"Set a reminder to register as a voter when you turn {VOTING_AGE}.",
            "Follow India's election news to stay informed."
        ]
    elif age_ok and not citizenship_ok:
        explanation = (
            "Indian elections are open only to Indian citizens. "
            "If you hold an Indian passport and are an NRI, you may be eligible "
            "for overseas voting under special ECI provisions."
        )
        next_steps = [
            "If you are an NRI with an Indian passport, check the Overseas Voter registration (Form 6A).",
            "Visit eci.gov.in for full citizenship and NRI voter eligibility details.",
            "Contact your nearest Indian Embassy or Consulate for assistance.",
            "If you are seeking Indian citizenship, refer to the Ministry of Home Affairs website."
        ]
    else:
        explanation = (
            "Unfortunately, you do not meet the eligibility criteria for voting in Indian elections "
            "at this time — both minimum age (18) and Indian citizenship are required."
        )
        next_steps = [
            "Learn about India's election process at eci.gov.in.",
            "If you plan to obtain Indian citizenship in the future, refer to MHA guidelines.",
            f"If you are under 18, check back when you turn {VOTING_AGE}.",
            "Encourage eligible citizens around you to participate in democracy."
        ]

    return {
        "eligible": eligible,
        "age_eligible": age_ok,
        "citizenship_eligible": citizenship_ok,
        "reasons": reasons,
        "explanation": explanation,
        "next_steps": next_steps
    }


@eligibility_bp.route("/eligibility", methods=["POST"])
def check_eligibility():
    """
    Check voter eligibility based on age and citizenship.

    Request JSON:
    {
        "age": 22,
        "citizenship": "indian"   (accepts "indian" / "non-indian" / boolean)
    }

    Response JSON:
    {
        "eligible": true/false,
        "age_eligible": true/false,
        "citizenship_eligible": true/false,
        "reasons": [...],
        "explanation": "...",
        "next_steps": [...]
    }
    """
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "Request body must be valid JSON"}), 400

    # ── Validate age ───────────────────────────────────────
    age_raw = data.get("age")
    if age_raw is None:
        return jsonify({"error": "Missing required field: 'age'"}), 400

    try:
        age = int(age_raw)
        if age < 0 or age > 130:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "'age' must be an integer between 0 and 130"}), 400

    # ── Validate citizenship ───────────────────────────────
    citizenship_raw = data.get("citizenship")
    if citizenship_raw is None:
        return jsonify({"error": "Missing required field: 'citizenship'"}), 400

    if isinstance(citizenship_raw, bool):
        is_citizen = citizenship_raw
    elif isinstance(citizenship_raw, str):
        is_citizen = citizenship_raw.strip().lower() in ("indian", "yes", "true", "1")
    else:
        return jsonify({"error": "'citizenship' must be 'indian', 'non-indian', or a boolean"}), 400

    result = evaluate_eligibility(age, is_citizen)
    return jsonify(result), 200


@eligibility_bp.route("/eligibility", methods=["GET"])
def eligibility_info():
    """Return information about the eligibility criteria."""
    return jsonify({
        "criteria": {
            "minimum_age": VOTING_AGE,
            "citizenship": "Indian citizen",
            "enrollment": "Name must appear on the Electoral Roll"
        },
        "authority": "Election Commission of India (ECI)",
        "portal": "https://voters.eci.gov.in"
    }), 200
