from flask import Blueprint, request, jsonify

timeline_bp = Blueprint("timeline", __name__)

# ── Election Phase Definitions ─────────────────────────────
# Each phase has a fixed order, icon, colour token, and rich metadata.
# Dates are expressed as relative offsets (weeks before Voting Day = 0)
# since actual calendar dates vary per election.

PHASES = [
    {
        "id":          "announcement",
        "order":       1,
        "name":        "Election Announcement",
        "icon":        "📢",
        "color":       "blue",
        "offset_label":"8–10 weeks before Voting Day",
        "duration":    "1 day",
        "description": (
            "The Election Commission of India (ECI) officially announces the election "
            "schedule, including the dates for every phase of voting, the Model Code "
            "of Conduct (MCC) comes into effect immediately."
        ),
        "key_activities": [
            "ECI issues the election notification in the Official Gazette.",
            "Model Code of Conduct (MCC) becomes effective immediately.",
            "Government spending and new policy announcements are restricted.",
            "Security forces are deployed to sensitive areas.",
        ],
        "citizen_action": "Follow news channels and ECI's official website for the schedule.",
    },
    {
        "id":          "registration_deadline",
        "order":       2,
        "name":        "Voter Registration Deadline",
        "icon":        "📋",
        "color":       "indigo",
        "offset_label":"6–7 weeks before Voting Day",
        "duration":    "Approx. 1 week",
        "description": (
            "Last date for citizens to register as new voters (Form 6), "
            "update existing entries (Form 8), or request deletion (Form 7). "
            "After this deadline, no new additions to the Electoral Roll are allowed "
            "for the upcoming election."
        ),
        "key_activities": [
            "New voters: Submit Form 6 online at voters.eci.gov.in or at a BLO office.",
            "Existing voters: Correct name/address errors via Form 8.",
            "Electoral Roll is published and open for public inspection.",
            "Electoral Registration Officers (EROs) verify and approve applications.",
        ],
        "citizen_action": (
            "Check your name at voters.eci.gov.in. If not listed, apply immediately "
            "using Form 6 before the deadline."
        ),
    },
    {
        "id":          "nomination",
        "order":       3,
        "name":        "Nomination Period",
        "icon":        "📝",
        "color":       "violet",
        "offset_label":"5–6 weeks before Voting Day",
        "duration":    "1–2 weeks",
        "description": (
            "Candidates file their nomination papers with the Returning Officer. "
            "Scrutiny of nominations takes place, after which candidates may withdraw. "
            "The final list of candidates is published."
        ),
        "key_activities": [
            "Candidates submit nomination papers with required deposits.",
            "Returning Officer scrutinises all nominations for validity.",
            "Candidates can withdraw nominations within the allowed window.",
            "Final candidate list is published by the ECI.",
        ],
        "citizen_action": (
            "Review the list of candidates in your constituency at "
            "affidavit.eci.gov.in to make an informed vote."
        ),
    },
    {
        "id":          "campaign",
        "order":       4,
        "name":        "Campaign Period",
        "icon":        "🗣️",
        "color":       "cyan",
        "offset_label":"4–5 weeks before Voting Day",
        "duration":    "3–5 weeks",
        "description": (
            "Political parties and candidates actively campaign to win voter support "
            "through rallies, door-to-door visits, advertisements, and social media. "
            "All campaigning must cease 48 hours before voting begins (the 'silence period')."
        ),
        "key_activities": [
            "Candidates hold public rallies, roadshows, and door-to-door campaigns.",
            "Parties run print, TV, and digital media advertisements.",
            "The ECI monitors campaign spending — candidates have a legal limit.",
            "Flying Squads check for cash, liquor, or freebies distribution.",
            "Silence period begins 48 hours before polls open.",
        ],
        "citizen_action": (
            "Attend public meetings, read candidate manifestos, and decide your vote. "
            "Report violations to ECI's cVIGIL app."
        ),
    },
    {
        "id":          "silence_period",
        "order":       5,
        "name":        "Silence Period",
        "icon":        "🤫",
        "color":       "amber",
        "offset_label":"48 hours before Voting Day",
        "duration":    "48 hours",
        "description": (
            "All campaign activity — rallies, advertisements, speeches, and canvassing — "
            "must stop 48 hours before the scheduled close of polls. "
            "Exit polls are also prohibited during this window."
        ),
        "key_activities": [
            "All campaign activity ceases.",
            "No new political advertisements permitted.",
            "Exit polls are banned.",
            "Voters review their final polling booth assignment.",
        ],
        "citizen_action": (
            "Check your polling booth location at voterportal.eci.gov.in and "
            "prepare the documents you'll carry on Voting Day."
        ),
    },
    {
        "id":          "voting_day",
        "order":       6,
        "name":        "Voting Day (Poll Day)",
        "icon":        "🗳️",
        "color":       "green",
        "offset_label":"Day 0",
        "duration":    "1 day (polls open 7 AM – 6 PM typically)",
        "description": (
            "Eligible registered voters cast their ballots at designated polling booths "
            "using Electronic Voting Machines (EVMs). Voters receive an indelible ink "
            "mark on their finger as proof of voting."
        ),
        "key_activities": [
            "Polling booths open at 7:00 AM and close at 6:00 PM (may vary).",
            "Voters present Voter ID (EPIC) or approved alternate photo ID.",
            "Votes are cast on Electronic Voting Machines (EVMs).",
            "Presiding Officer seals EVMs at close of polling.",
            "VVPAT slips allow voters to verify their vote.",
        ],
        "citizen_action": (
            "Carry your Voter ID Card (EPIC) or an approved alternate ID. "
            "Vote early to avoid queues. Look for the indelible ink on your left index finger!"
        ),
    },
    {
        "id":          "counting",
        "order":       7,
        "name":        "Vote Counting",
        "icon":        "🔢",
        "color":       "orange",
        "offset_label":"1–3 days after Voting Day",
        "duration":    "1 day",
        "description": (
            "EVM votes are counted at designated counting centres under strict security. "
            "Agents of all candidates observe the process. "
            "Exit polls and election result predictions are broadcast from this day."
        ),
        "key_activities": [
            "Counting begins at a designated time announced by ECI.",
            "Each round of counting covers one assembly segment.",
            "Candidate agents monitor every counting table.",
            "Trends and results are updated live on ECI's results portal.",
            "Winning candidates receive a certificate of election.",
        ],
        "citizen_action": (
            "Follow live results at results.eci.gov.in or on news channels."
        ),
    },
    {
        "id":          "result_day",
        "order":       8,
        "name":        "Results & New Government",
        "icon":        "🏆",
        "color":       "emerald",
        "offset_label":"2–5 days after Voting Day",
        "duration":    "1–3 weeks (formation of government)",
        "description": (
            "Final results are declared by the ECI. The winning party or coalition "
            "is invited to form the government. The new government is sworn in "
            "within a few weeks of the result."
        ),
        "key_activities": [
            "ECI officially declares final results for all constituencies.",
            "President / Governor invites the majority party/coalition to form the government.",
            "Cabinet is formed and sworn in.",
            "New government presents its agenda and begins functioning.",
        ],
        "citizen_action": (
            "Monitor your elected representative's performance using tools like "
            "the PRS Legislative Research website and your MP's official portal."
        ),
    },
]

ELECTION_TYPES = {
    "lok_sabha": {
        "name":        "Lok Sabha (General) Election",
        "description": "Elections to the lower house of Parliament. Held every 5 years.",
        "frequency":   "Every 5 years",
        "seats":       543,
        "typical_phases": "Up to 7 phases spread across 4–6 weeks",
        "authority":   "Election Commission of India",
    },
    "state_assembly": {
        "name":        "State Legislative Assembly (Vidhan Sabha) Election",
        "description": "Elections to state legislatures. Held every 5 years per state.",
        "frequency":   "Every 5 years (per state)",
        "seats":       "Varies by state",
        "typical_phases": "1–3 phases",
        "authority":   "Election Commission of India",
    },
    "rajya_sabha": {
        "name":        "Rajya Sabha (Upper House) Election",
        "description": "Indirect elections by state MLAs to the upper house of Parliament.",
        "frequency":   "Biennial (1/3 of seats every 2 years)",
        "seats":       "Up to 238 elected seats",
        "typical_phases": "Single phase",
        "authority":   "Election Commission of India",
    },
    "local_body": {
        "name":        "Local Body Election",
        "description": "Elections to municipal corporations, panchayats, and local councils.",
        "frequency":   "Every 5 years",
        "seats":       "Varies by region",
        "typical_phases": "1–2 phases",
        "authority":   "State Election Commission",
    },
}


@timeline_bp.route("/timeline", methods=["GET"])
def get_timeline():
    """
    Return the structured election timeline.

    Query params:
      ?type=lok_sabha | state_assembly | rajya_sabha | local_body
            (default: lok_sabha)
      ?phase=<phase_id>   — return only that specific phase

    Response:
    {
        "election": { ... metadata ... },
        "phases":   [ { ... phase objects ... } ],
        "total_phases": 8,
        "note": "..."
    }
    """
    election_type = request.args.get("type", "lok_sabha").lower().strip()
    phase_id      = request.args.get("phase", "").lower().strip()

    election_meta = ELECTION_TYPES.get(election_type, ELECTION_TYPES["lok_sabha"])

    if phase_id:
        phases = [p for p in PHASES if p["id"] == phase_id]
        if not phases:
            return jsonify({
                "error": f"Phase '{phase_id}' not found.",
                "valid_phases": [p["id"] for p in PHASES]
            }), 404
    else:
        phases = PHASES

    return jsonify({
        "election":     election_meta,
        "election_type": election_type,
        "phases":       phases,
        "total_phases": len(phases),
        "note": (
            "Dates shown are relative to Voting Day. "
            "Actual calendar dates are announced by ECI before each election. "
            "Check eci.gov.in for the official schedule."
        )
    }), 200


@timeline_bp.route("/timeline/phases", methods=["GET"])
def list_phases():
    """Return a summary list of all phases (id + name + icon only)."""
    return jsonify({
        "phases": [
            {"id": p["id"], "name": p["name"], "icon": p["icon"], "order": p["order"]}
            for p in PHASES
        ]
    }), 200
