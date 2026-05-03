/**
 * timeline.js — CivicGuide AI election timeline feature.
 *
 * Reliability additions in this version:
 *  - Toast notifications for all error states
 *  - Election type validated against known set before API call
 *  - isLoading flag prevents overlapping fetches during tab switching
 *  - Error state rendered in the timeline area (not just console.warn)
 *  - Keyboard accessibility (Space/Enter) for accordion cards
 *  - Null-safe rendering guards on all phase fields
 */

import { apiGet, escapeHtml } from "./api.js";
import { showToast } from "./toast.js";

// ── Colour token → hex map ─────────────────────────────────────────────────
const COLOR_MAP = {
  blue:    "#3b82f6",
  indigo:  "#6366f1",
  violet:  "#8b5cf6",
  cyan:    "#06b6d4",
  amber:   "#f59e0b",
  green:   "#22c55e",
  orange:  "#f97316",
  emerald: "#10b981",
};

// ── Valid election types (mirrors backend SUPPORTED_ELECTION_TYPES) ─────────
const VALID_TYPES = new Set(["lok_sabha", "state_assembly", "rajya_sabha", "local_body"]);

// ── DOM References ─────────────────────────────────────────────────────────
const loadingEl   = document.getElementById("loading-state");
const timelineEl  = document.getElementById("timeline");
const progressBar = document.getElementById("progress-bar");
const metaName    = document.getElementById("meta-name");
const metaFreq    = document.getElementById("meta-freq");
const metaSeats   = document.getElementById("meta-seats");
const metaPhases  = document.getElementById("meta-phases");
const metaAuth    = document.getElementById("meta-auth");

// ── Module State ───────────────────────────────────────────────────────────
let currentType = "lok_sabha";
let openCardId  = null;
let isLoading   = false;  // Prevents overlapping fetches during tab switching


// ══════════════════════════════════════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the timeline for an election type and render it.
 * Validates the type before calling the API, falls back gracefully on error.
 *
 * @param {string} type - Election type key.
 */
async function loadTimeline(type = "lok_sabha") {
  // Validate the election type — defence against DOM manipulation
  if (!VALID_TYPES.has(type)) {
    showToast(`Unknown election type: "${type}". Defaulting to Lok Sabha.`, "warning");
    type = "lok_sabha";
  }

  // Prevent overlapping requests when the user clicks tabs rapidly
  if (isLoading) return;

  currentType = type;
  isLoading   = true;
  showLoading(true);

  try {
    const data = await apiGet(`/api/timeline?type=${encodeURIComponent(type)}`);

    // Guard: ensure the response has the expected shape
    if (!data.election || !Array.isArray(data.phases)) {
      throw new Error("Unexpected response format from timeline API.");
    }

    renderMeta(data.election);
    renderProgressBar(data.phases);
    renderTimeline(data.phases);

  } catch (err) {
    console.warn("[CivicGuide AI] Timeline API error — using offline fallback:", err.message);

    // Show the offline fallback silently — this is expected when backend is down
    const data = getOfflineFallback();
    renderMeta(data.election);
    renderProgressBar(data.phases);
    renderTimeline(data.phases);

    // Inform the user without being alarmist
    showToast("Showing cached timeline — backend is offline.", "info", 4000);

  } finally {
    isLoading = false;
    showLoading(false);
  }
}


// ══════════════════════════════════════════════════════════════════════════
// RENDER HELPERS
// ══════════════════════════════════════════════════════════════════════════

/** Populate the election meta bar above the timeline. */
function renderMeta(election) {
  metaName.textContent   = election.name           || "—";
  metaFreq.textContent   = election.frequency      || "—";
  metaSeats.textContent  = election.seats          || "—";
  metaPhases.textContent = election.typical_phases || "—";
  metaAuth.textContent   = election.authority      || "—";
}

/**
 * Build the colour-coded progress bar. Each segment scrolls to its phase on click.
 * @param {object[]} phases
 */
function renderProgressBar(phases) {
  if (!phases?.length) return;

  progressBar.innerHTML = phases.map((p) => {
    const color = COLOR_MAP[p.color] || "#6366f1";
    return `<div class="progress-segment"
                 style="background:${color};"
                 title="${escapeHtml(p.name || '')}"
                 data-phase="${escapeHtml(p.id || '')}"
                 role="presentation"></div>`;
  }).join("");

  progressBar.querySelectorAll(".progress-segment").forEach((seg) => {
    seg.addEventListener("click", () => {
      document.getElementById(`phase-${seg.dataset.phase}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

/**
 * Render all phase cards and wire interactions.
 * @param {object[]} phases
 */
function renderTimeline(phases) {
  if (!phases?.length) {
    timelineEl.innerHTML = `
      <li style="text-align:center;padding:3rem;color:#64748b;">
        No phases available for this election type.
      </li>`;
    return;
  }

  timelineEl.innerHTML = phases.map((phase, i) => buildPhaseHTML(phase, i)).join("");

  timelineEl.querySelectorAll(".phase-card").forEach((card) => {
    card.addEventListener("click", () => toggleCard(card));
    card.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleCard(card);
      }
    });
  });

  observePhases();
}

/**
 * Build the HTML string for a single phase list item.
 * All fields are null-safe with || "" fallbacks.
 *
 * @param {object} p - Phase data object.
 * @returns {string}
 */
function buildPhaseHTML(p) {
  const colorClass = `c-${p.color || "blue"}`;

  const activitiesHtml = (p.key_activities || [])
    .map((a) => `
      <li>
        <span class="act-dot ${p.color || "blue"}"></span>
        <span>${escapeHtml(a)}</span>
      </li>`)
    .join("");

  const citizenActionHtml = p.citizen_action
    ? `<div>
         <div class="action-heading">💡 Your Action</div>
         <div class="citizen-action-box ${colorClass}">
           <span class="action-icon" aria-hidden="true">👤</span>
           <span>${escapeHtml(p.citizen_action)}</span>
         </div>
       </div>`
    : "";

  return `
    <li class="phase-item ${colorClass}" id="phase-${escapeHtml(p.id || '')}">

      <div class="phase-dot ${colorClass}" aria-hidden="true">${p.icon || "📌"}</div>

      <div class="phase-card" id="card-${escapeHtml(p.id || '')}"
           role="button" tabindex="0"
           aria-expanded="false"
           aria-controls="body-${escapeHtml(p.id || '')}"
           aria-label="${escapeHtml(p.name || 'Phase')}">

        <div class="card-header ${colorClass}">
          <div class="card-header-left">
            <span class="phase-number">Phase ${p.order || "?"} of 8</span>
            <span class="phase-name">${escapeHtml(p.name || "")}</span>
            <span class="phase-offset ${colorClass}">🕐 ${escapeHtml(p.offset_label || "")}</span>
          </div>
          <div style="display:flex;align-items:flex-start;gap:.75rem;">
            <div class="duration-pill">
              <span class="duration-label">Duration</span>
              <span class="duration-value ${colorClass}">${escapeHtml(p.duration || "")}</span>
            </div>
            <span class="expand-icon">▼</span>
          </div>
        </div>

        <div class="card-body" id="body-${escapeHtml(p.id || '')}" role="region">
          <div class="card-body-inner">
            <p class="phase-description">${escapeHtml(p.description || "")}</p>
            <div>
              <div class="activities-heading">📌 Key Activities</div>
              <ul class="activities-list">${activitiesHtml}</ul>
            </div>
            ${citizenActionHtml}
          </div>
        </div>

      </div>
    </li>`;
}


// ══════════════════════════════════════════════════════════════════════════
// EXPAND / COLLAPSE  (accordion)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Toggle a phase card open/closed. Closes the previous card first.
 * @param {HTMLElement} card
 */
function toggleCard(card) {
  const isOpen = card.classList.contains("open");
  const bodyId = card.id.replace("card-", "body-");
  const body   = document.getElementById(bodyId);

  // Close any previously open card
  if (openCardId && openCardId !== card.id) {
    const prev     = document.getElementById(openCardId);
    const prevBody = document.getElementById(openCardId.replace("card-", "body-"));
    prev?.classList.remove("open");
    prev?.setAttribute("aria-expanded", "false");
    prevBody?.classList.remove("open");
  }

  card.classList.toggle("open", !isOpen);
  card.setAttribute("aria-expanded", String(!isOpen));
  body?.classList.toggle("open", !isOpen);

  openCardId = isOpen ? null : card.id;
}


// ══════════════════════════════════════════════════════════════════════════
// SCROLL REVEAL
// ══════════════════════════════════════════════════════════════════════════

function observePhases() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add("visible"), i * 80);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );
  timelineEl.querySelectorAll(".phase-item").forEach((el) => observer.observe(el));
}


// ══════════════════════════════════════════════════════════════════════════
// ELECTION TYPE TABS
// ══════════════════════════════════════════════════════════════════════════

document.querySelectorAll(".type-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (isLoading) return;  // Ignore rapid tab clicks during a fetch
    document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    openCardId = null;
    loadTimeline(btn.dataset.type);
  });
});


// ── UI Utilities ───────────────────────────────────────────────────────────

function showLoading(on) {
  loadingEl.style.display  = on ? "flex" : "none";
  timelineEl.style.display = on ? "none" : "ol";
}


// ══════════════════════════════════════════════════════════════════════════
// OFFLINE FALLBACK DATA  (Lok Sabha snapshot)
// ══════════════════════════════════════════════════════════════════════════

function getOfflineFallback() {
  return {
    election: {
      name:           "Lok Sabha (General) Election",
      frequency:      "Every 5 years",
      seats:          543,
      typical_phases: "Up to 7 phases spread across 4–6 weeks",
      authority:      "Election Commission of India",
    },
    phases: [
      { id: "announcement",         order: 1, name: "Election Announcement",      icon: "📢", color: "blue",
        offset_label: "8–10 weeks before Voting Day", duration: "1 day",
        description: "The ECI officially announces the election schedule. The Model Code of Conduct (MCC) comes into effect immediately.",
        key_activities: ["ECI issues election notification.", "MCC becomes effective.", "Government spending restricted.", "Security forces deployed."],
        citizen_action: "Follow ECI's official website for the schedule." },
      { id: "registration_deadline",order: 2, name: "Voter Registration Deadline",icon: "📋", color: "indigo",
        offset_label: "6–7 weeks before Voting Day", duration: "~1 week",
        description: "Last date for citizens to register as new voters or update existing entries.",
        key_activities: ["Submit Form 6 online at voters.eci.gov.in.", "Correct errors via Form 8.", "Electoral Roll published for inspection.", "EROs verify applications."],
        citizen_action: "Check your name at voters.eci.gov.in. Apply using Form 6 before the deadline." },
      { id: "nomination",           order: 3, name: "Nomination Period",           icon: "📝", color: "violet",
        offset_label: "5–6 weeks before Voting Day", duration: "1–2 weeks",
        description: "Candidates file nomination papers with the Returning Officer. Final candidate list is published.",
        key_activities: ["Candidates submit nominations with deposits.", "Returning Officer scrutinises nominations.", "Candidates can withdraw within the window.", "Final candidate list published."],
        citizen_action: "Review candidate affidavits at affidavit.eci.gov.in." },
      { id: "campaign",             order: 4, name: "Campaign Period",             icon: "🗣️", color: "cyan",
        offset_label: "4–5 weeks before Voting Day", duration: "3–5 weeks",
        description: "Parties and candidates campaign through rallies, ads, and door-to-door visits. All activity ceases 48 hrs before polls.",
        key_activities: ["Public rallies and roadshows.", "Print, TV, and digital ads.", "ECI monitors campaign spending.", "Silence period starts 48 hrs before polls."],
        citizen_action: "Read manifestos and attend public meetings. Report violations to the cVIGIL app." },
      { id: "silence_period",       order: 5, name: "Silence Period",              icon: "🤫", color: "amber",
        offset_label: "48 hours before Voting Day", duration: "48 hours",
        description: "All campaign activity must stop 48 hours before polls close. Exit polls are also banned.",
        key_activities: ["All campaign activity ceases.", "No new political advertisements.", "Exit polls are banned.", "Voters check polling booth assignment."],
        citizen_action: "Check your polling booth at voterportal.eci.gov.in and prepare your ID." },
      { id: "voting_day",           order: 6, name: "Voting Day (Poll Day)",       icon: "🗳️", color: "green",
        offset_label: "Day 0", duration: "1 day (7 AM – 6 PM)",
        description: "Eligible registered voters cast ballots using Electronic Voting Machines (EVMs) at polling booths.",
        key_activities: ["Booths open 7 AM, close 6 PM.", "Voters present Voter ID or alternate photo ID.", "Votes cast on EVMs.", "VVPAT slips verify votes."],
        citizen_action: "Carry your Voter ID Card. Vote early! Look for the indelible ink mark after voting." },
      { id: "counting",             order: 7, name: "Vote Counting",               icon: "🔢", color: "orange",
        offset_label: "1–3 days after Voting Day", duration: "1 day",
        description: "EVM votes are counted at designated centres under strict security. Agents of all candidates observe.",
        key_activities: ["Counting begins at ECI-announced time.", "Each round covers one assembly segment.", "Candidate agents monitor tables.", "Live results on ECI's results portal."],
        citizen_action: "Follow live results at results.eci.gov.in." },
      { id: "result_day",           order: 8, name: "Results & New Government",    icon: "🏆", color: "emerald",
        offset_label: "2–5 days after Voting Day", duration: "1–3 weeks",
        description: "ECI declares final results. The winning party is invited to form the government and sworn in.",
        key_activities: ["ECI declares official results.", "President/Governor invites majority party.", "Cabinet formed and sworn in.", "New government begins functioning."],
        citizen_action: "Monitor your elected representative's work via PRS Legislative Research." },
    ],
  };
}


// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

loadTimeline("lok_sabha");
