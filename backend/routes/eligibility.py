"""
routes/eligibility.py — Voter eligibility checker endpoint.

Endpoints
---------
POST /api/eligibility
    Evaluate whether a person is eligible to vote in Indian elections
    based on age and citizenship status.

GET /api/eligibility
    Return the eligibility criteria and official portal link.

Business rules (as per ECI guidelines):
- Minimum voting age: 18 years
- Must be an Indian citizen
- Name must appear on the Electoral Roll (validated separately)
"""

from flask import Blueprint, request

from config import VOTING_AGE
from utils  import error_response, success_response, validate_json_body

eligibility_bp = Blueprint("eligibility", __name__)


# ── Core Logic ─────────────────────────────────────────────────────────────

def evaluate_eligibility(age: int, is_citizen: bool) -> dict:
    """
    Apply ECI eligibility rules and return a structured result.

    Args:
        age:        The voter's age in whole years.
        is_citizen: True if the person is an Indian citizen.

    Returns:
        Dict with keys:
            eligible (bool)             — overall pass/fail
            age_eligible (bool)         — age criterion met
            citizenship_eligible (bool) — citizenship criterion met
            reasons (list[str])         — why criteria were NOT met
            explanation (str)           — human-readable summary
            next_steps (list[str])      — actionable next steps
    """
    reasons = []

    # ── Age check ──────────────────────────────────────────────────────────
    age_ok = age >= VOTING_AGE
    if not age_ok:
        years_left = VOTING_AGE - age
        reasons.append(
            f"You are {age} years old. The minimum voting age in India is {VOTING_AGE}. "
            f"You will be eligible in {years_left} year{'s' if years_left != 1 else ''}."
        )

    # ── Citizenship check ──────────────────────────────────────────────────
    citizenship_ok = is_citizen
    if not citizenship_ok:
        reasons.append(
            "Only Indian citizens can vote in Indian elections. "
            "NRIs with valid Indian passports may be eligible for overseas voting — "
            "check the Election Commission of India (ECI) guidelines."
        )

    eligible = age_ok and citizenship_ok

    # ── Build the result for each of the four eligibility combinations ─────
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
            "Find your polling booth at voterportal.eci.gov.in.",
        ]

    elif not age_ok and citizenship_ok:
        explanation = (
            f"You are {age} years old — you need to be at least {VOTING_AGE} to vote in India. "
            "But it's never too early to learn about the process and get your documents ready!"
        )
        next_steps = [
            "Apply for your Aadhaar Card now if you don't have one.",
            "Learn about the election process at eci.gov.in.",
            "Encourage your eligible family members and friends to vote.",
            f"Set a reminder to register as a voter when you turn {VOTING_AGE}.",
            "Follow India's election news to stay informed.",
        ]

    elif age_ok and not citizenship_ok:
        explanation = (
            "Indian elections are open only to Indian citizens. "
            "If you hold an Indian passport and are an NRI, you may be eligible "
            "for overseas voting under special ECI provisions."
        )
        next_steps = [
            "If you are an NRI with an Indian passport, check Form 6A (Overseas Voter) at eci.gov.in.",
            "Visit eci.gov.in for full citizenship and NRI voter eligibility details.",
            "Contact your nearest Indian Embassy or Consulate for assistance.",
            "If seeking Indian citizenship, refer to the Ministry of Home Affairs website.",
        ]

    else:
        # Both age AND citizenship criteria unmet.
        explanation = (
            "Unfortunately, you do not meet the eligibility criteria for voting in Indian elections "
            "at this time — both minimum age (18) and Indian citizenship are required."
        )
        next_steps = [
            "Learn about India's election process at eci.gov.in.",
            "If you plan to obtain Indian citizenship in the future, refer to MHA guidelines.",
            f"If you are under 18, check back when you turn {VOTING_AGE}.",
            "Encourage eligible citizens around you to participate in democracy.",
        ]

    return {
        "eligible":              eligible,
        "age_eligible":          age_ok,
        "citizenship_eligible":  citizenship_ok,
        "reasons":               reasons,
        "explanation":           explanation,
        "next_steps":            next_steps,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────

@eligibility_bp.route("/eligibility", methods=["POST"])
def check_eligibility():
    """
    Check voter eligibility based on age and citizenship.

    Request JSON:
    {
        "age":         22,
        "citizenship": "indian"   (accepts "indian"/"non-indian"/true/false)
    }

    Response JSON (200):
    {
        "eligible":             true,
        "age_eligible":         true,
        "citizenship_eligible": true,
        "reasons":              [],
        "explanation":          "...",
        "next_steps":           [...]
    }

    Error JSON (400):
    { "error": "..." }
    """
    data = request.get_json(silent=True)

    # ── Validate request body ──────────────────────────────────────────────
    err = validate_json_body(data, "age", "citizenship")
    if err:
        return error_response(err)

    # ── Validate and coerce age ────────────────────────────────────────────
    try:
        age = int(data["age"])
        if not 0 <= age <= 130:
            raise ValueError("Age out of realistic range")
    except (ValueError, TypeError):
        return error_response("'age' must be an integer between 0 and 130")

    # ── Validate and coerce citizenship ───────────────────────────────────
    citizenship_raw = data["citizenship"]
    if isinstance(citizenship_raw, bool):
        is_citizen = citizenship_raw
    elif isinstance(citizenship_raw, str):
        is_citizen = citizenship_raw.strip().lower() in ("indian", "yes", "true", "1")
    else:
        return error_response(
            "'citizenship' must be 'indian', 'non-indian', or a boolean"
        )

    result = evaluate_eligibility(age, is_citizen)
    return success_response(result)


@eligibility_bp.route("/eligibility", methods=["GET"])
def eligibility_info():
    """
    Return the official eligibility criteria and ECI portal link.

    Useful for clients that want to display the criteria without
    performing a check.

    Response JSON (200):
    {
        "criteria": {
            "minimum_age": 18,
            "citizenship": "Indian citizen",
            "enrollment":  "Name must appear on the Electoral Roll"
        },
        "authority": "Election Commission of India (ECI)",
        "portal":    "https://voters.eci.gov.in"
    }
    """
    return success_response({
        "criteria": {
            "minimum_age": VOTING_AGE,
            "citizenship": "Indian citizen",
            "enrollment":  "Name must appear on the Electoral Roll",
        },
        "authority": "Election Commission of India (ECI)",
        "portal":    "https://voters.eci.gov.in",
    })
