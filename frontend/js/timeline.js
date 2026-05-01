/**
 * timeline.js — CivicGuide AI election timeline feature.
 *
 * Fetches phase data from /api/timeline, renders an accessible, collapsible
 * vertical timeline with scroll-reveal animations.  Falls back to a bundled
 * static dataset when the backend is unreachable.
 */

import { apiGet, escapeHtml } from "./api.js";

// ── Colour token → CSS hex value map ──────────────────────────────────────
// Used to set the progress bar segment fill colours dynamically.
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
let openCardId  = null;  // Tracks the currently expanded phase card


// ══════════════════════════════════════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the timeline for the given election type and render it.
 * Falls back to static offline data if the backend is unreachable.
 *
 * @param {string} type - Election type key (e.g. "lok_sabha").
 */
async function loadTimeline(type = "lok_sabha") {
  currentType = type;
  showLoading(true);

  try {
    const data = await apiGet(`/api/timeline?type=${type}`);
    renderMeta(data.election);
    renderProgressBar(data.phases);
    renderTimeline(data.phases);

  } catch (err) {
    console.warn("[CivicGuide AI] Using offline timeline fallback:", err.message);
    const data = getOfflineFallback();
    renderMeta(data.election);
    renderProgressBar(data.phases);
    renderTimeline(data.phases);

  } finally {
    showLoading(false);
  }
}


// ══════════════════════════════════════════════════════════════════════════
// RENDER HELPERS
// ══════════════════════════════════════════════════════════════════════════

/** Populate the election meta bar above the timeline. */
function renderMeta(election) {
  metaName.textContent   = election.name             || "—";
  metaFreq.textContent   = election.frequency        || "—";
  metaSeats.textContent  = election.seats            || "—";
  metaPhases.textContent = election.typical_phases   || "—";
  metaAuth.textContent   = election.authority        || "—";
}

/**
 * Build the colour-coded progress bar from the phase list.
 * Each segment is clickable and scrolls to its phase card.
 */
function renderProgressBar(phases) {
  progressBar.innerHTML = phases.map((p) => {
    const color = COLOR_MAP[p.color] || "#6366f1";
    return `<div class="progress-segment"
                 style="background:${color};"
                 title="${escapeHtml(p.name)}"
                 data-phase="${p.id}"
                 role="presentation"></div>`;
  }).join("");

  // Wire click-to-scroll for each segment.
  progressBar.querySelectorAll(".progress-segment").forEach((seg) => {
    seg.addEventListener("click", () => {
      document.getElementById(`phase-${seg.dataset.phase}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

/**
 * Render all phase cards into the timeline <ol> and wire interactions.
 *
 * @param {object[]} phases - Array of phase objects from the API.
 */
function renderTimeline(phases) {
  timelineEl.innerHTML = phases.map((phase, i) => buildPhaseHTML(phase, i)).join("");

  // Expand/collapse on card click.
  timelineEl.querySelectorAll(".phase-card").forEach((card) => {
    card.addEventListener("click", () => toggleCard(card));
    // Keyboard accessibility — activate on Space/Enter.
    card.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleCard(card);
      }
    });
  });

  // Trigger scroll-reveal observation.
  observePhases();
}

/**
 * Build the HTML string for a single phase item.
 *
 * @param {object} p     - Phase data object.
 * @param {number} index - Zero-based index within the phases array.
 * @returns {string}
 */
function buildPhaseHTML(p, index) {
  const colorClass = `c-${p.color}`;

  const activitiesHtml = (p.key_activities || [])
    .map((a) => `
      <li>
        <span class="act-dot ${p.color}"></span>
        <span>${escapeHtml(a)}</span>
      </li>`)
    .join("");

  const citizenActionHtml = p.citizen_action
    ? `<div>
         <div class="action-heading">💡 Your Action</div>
         <div class="citizen-action-box ${colorClass}">
           <span class="action-icon">👤</span>
           <span>${escapeHtml(p.citizen_action)}</span>
         </div>
       </div>`
    : "";

  return `
    <li class="phase-item ${colorClass}" id="phase-${p.id}">

      <!-- Timeline dot -->
      <div class="phase-dot ${colorClass}" aria-hidden="true">${p.icon}</div>

      <!-- Collapsible card -->
      <div class="phase-card" id="card-${p.id}"
           role="button" tabindex="0"
           aria-expanded="false"
           aria-controls="body-${p.id}"
           aria-label="${escapeHtml(p.name)}">

        <div class="card-header ${colorClass}">
          <div class="card-header-left">
            <span class="phase-number">Phase ${p.order} of 8</span>
            <span class="phase-name">${escapeHtml(p.name)}</span>
            <span class="phase-offset ${colorClass}">🕐 ${escapeHtml(p.offset_label)}</span>
          </div>
          <div style="display:flex;align-items:flex-start;gap:.75rem;">
            <div class="duration-pill">
              <span class="duration-label">Duration</span>
              <span class="duration-value ${colorClass}">${escapeHtml(p.duration)}</span>
            </div>
            <span class="expand-icon">▼</span>
          </div>
        </div>

        <div class="card-body" id="body-${p.id}" role="region">
          <div class="card-body-inner">
            <p class="phase-description">${escapeHtml(p.description)}</p>
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
// EXPAND / COLLAPSE
// ══════════════════════════════════════════════════════════════════════════

/**
 * Toggle a phase card open or closed, closing the previously open card first.
 *
 * @param {HTMLElement} card - The .phase-card element to toggle.
 */
function toggleCard(card) {
  const isOpen = card.classList.contains("open");
  const bodyId = card.id.replace("card-", "body-");
  const body   = document.getElementById(bodyId);

  // Close the previously open card (accordion behaviour).
  if (openCardId && openCardId !== card.id) {
    const prev     = document.getElementById(openCardId);
    const prevBody = document.getElementById(openCardId.replace("card-", "body-"));
    if (prev)     { prev.classList.remove("open");     prev.setAttribute("aria-expanded", "false"); }
    if (prevBody) { prevBody.classList.remove("open"); }
  }

  card.classList.toggle("open", !isOpen);
  card.setAttribute("aria-expanded", String(!isOpen));
  body?.classList.toggle("open", !isOpen);

  openCardId = isOpen ? null : card.id;
}


// ══════════════════════════════════════════════════════════════════════════
// SCROLL REVEAL
// ══════════════════════════════════════════════════════════════════════════

/** Observe each phase item and add the "visible" class when it enters view. */
function observePhases() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          // Stagger the reveal for consecutive items entering together.
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
    document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    openCardId = null;  // Reset accordion state on type change
    loadTimeline(btn.dataset.type);
  });
});


// ── UI Utilities ───────────────────────────────────────────────────────────

function showLoading(on) {
  loadingEl.style.display  = on ? "flex" : "none";
  timelineEl.style.display = on ? "none" : "ol";
}


// ══════════════════════════════════════════════════════════════════════════
// OFFLINE FALLBACK DATA
// ══════════════════════════════════════════════════════════════════════════

/**
 * Static snapshot of the Lok Sabha timeline.
 * Returned when /api/timeline is unreachable so the page still works offline.
 *
 * @returns {{ election: object, phases: object[] }}
 */
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
      {
        id: "announcement", order: 1, name: "Election Announcement", icon: "📢", color: "blue",
        offset_label: "8–10 weeks before Voting Day", duration: "1 day",
        description: "The ECI officially announces the election schedule. The Model Code of Conduct (MCC) comes into effect immediately.",
        key_activities: ["ECI issues election notification.", "MCC becomes effective.", "Government spending restricted.", "Security forces deployed."],
        citizen_action: "Follow ECI's official website for the schedule.",
      },
      {
        id: "registration_deadline", order: 2, name: "Voter Registration Deadline", icon: "📋", color: "indigo",
        offset_label: "6–7 weeks before Voting Day", duration: "~1 week",
        description: "Last date for citizens to register as new voters or update existing entries.",
        key_activities: ["Submit Form 6 online at voters.eci.gov.in.", "Correct errors via Form 8.", "Electoral Roll published for inspection.", "EROs verify applications."],
        citizen_action: "Check your name at voters.eci.gov.in. Apply using Form 6 before the deadline.",
      },
      {
        id: "nomination", order: 3, name: "Nomination Period", icon: "📝", color: "violet",
        offset_label: "5–6 weeks before Voting Day", duration: "1–2 weeks",
        description: "Candidates file nomination papers with the Returning Officer. Final candidate list is published.",
        key_activities: ["Candidates submit nominations with deposits.", "Returning Officer scrutinises nominations.", "Candidates can withdraw within the window.", "Final candidate list published."],
        citizen_action: "Review candidate affidavits at affidavit.eci.gov.in.",
      },
      {
        id: "campaign", order: 4, name: "Campaign Period", icon: "🗣️", color: "cyan",
        offset_label: "4–5 weeks before Voting Day", duration: "3–5 weeks",
        description: "Parties and candidates campaign through rallies, ads, and door-to-door visits. All activity ceases 48 hrs before polls.",
        key_activities: ["Public rallies and roadshows.", "Print, TV, and digital ads.", "ECI monitors campaign spending.", "Silence period starts 48 hrs before polls."],
        citizen_action: "Read manifestos and attend public meetings. Report violations to the cVIGIL app.",
      },
      {
        id: "silence_period", order: 5, name: "Silence Period", icon: "🤫", color: "amber",
        offset_label: "48 hours before Voting Day", duration: "48 hours",
        description: "All campaign activity must stop 48 hours before polls close. Exit polls are also banned.",
        key_activities: ["All campaign activity ceases.", "No new political advertisements.", "Exit polls are banned.", "Voters check polling booth assignment."],
        citizen_action: "Check your polling booth at voterportal.eci.gov.in and prepare your ID.",
      },
      {
        id: "voting_day", order: 6, name: "Voting Day (Poll Day)", icon: "🗳️", color: "green",
        offset_label: "Day 0", duration: "1 day (7 AM – 6 PM)",
        description: "Eligible registered voters cast ballots using Electronic Voting Machines (EVMs) at polling booths.",
        key_activities: ["Booths open 7 AM, close 6 PM.", "Voters present Voter ID or alternate photo ID.", "Votes cast on EVMs.", "VVPAT slips verify votes."],
        citizen_action: "Carry your Voter ID Card. Vote early! Look for the indelible ink mark after voting.",
      },
      {
        id: "counting", order: 7, name: "Vote Counting", icon: "🔢", color: "orange",
        offset_label: "1–3 days after Voting Day", duration: "1 day",
        description: "EVM votes are counted at designated centres under strict security. Agents of all candidates observe.",
        key_activities: ["Counting begins at ECI-announced time.", "Each round covers one assembly segment.", "Candidate agents monitor tables.", "Live results on ECI's results portal."],
        citizen_action: "Follow live results at results.eci.gov.in.",
      },
      {
        id: "result_day", order: 8, name: "Results & New Government", icon: "🏆", color: "emerald",
        offset_label: "2–5 days after Voting Day", duration: "1–3 weeks",
        description: "ECI declares final results. The winning party is invited to form the government and sworn in.",
        key_activities: ["ECI declares official results.", "President/Governor invites majority party.", "Cabinet formed and sworn in.", "New government begins functioning."],
        citizen_action: "Monitor your elected representative's work via PRS Legislative Research.",
      },
    ],
  };
}


// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

loadTimeline("lok_sabha");
