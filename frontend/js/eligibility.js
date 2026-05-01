/**
 * eligibility.js — CivicGuide AI voter eligibility checker.
 *
 * Handles form submission, API call to /api/eligibility, result rendering,
 * and a graceful client-side fallback when the backend is unreachable.
 */

import { apiPost, escapeHtml } from "./api.js";

// ── Constants ──────────────────────────────────────────────────────────────
const VOTING_AGE = 18;

// ── DOM References ─────────────────────────────────────────────────────────
const form          = document.getElementById("eligibility-form");
const ageInput      = document.getElementById("age-input");
const ageError      = document.getElementById("age-error");
const checkBtn      = document.getElementById("check-btn");
const spinner       = document.getElementById("spinner");
const btnLabel      = document.getElementById("btn-label");

const resultEmpty   = document.getElementById("result-empty");
const resultCard    = document.getElementById("result-card");
const resultBanner  = document.getElementById("result-banner");
const resultIcon    = document.getElementById("result-icon");
const resultVerdict = document.getElementById("result-verdict");
const criteriaBadges= document.getElementById("criteria-badges");
const resultExpl    = document.getElementById("result-explanation");
const nextStepsList = document.getElementById("next-steps-list");
const resultActions = document.getElementById("result-actions");


// ── UI Helpers ─────────────────────────────────────────────────────────────

/** Toggle the button loading state during API call. */
function setLoading(on) {
  checkBtn.disabled     = on;
  spinner.style.display = on ? "block" : "none";
  btnLabel.textContent  = on ? "Checking…" : "Check Eligibility →";
}

/** Show an inline validation error below the age field. */
function showAgeError(msg) {
  ageError.textContent        = msg;
  ageError.style.display      = "block";
  ageInput.style.borderColor  = "rgba(248,113,113,0.6)";
}

/** Clear the age field validation error. */
function clearAgeError() {
  ageError.style.display     = "none";
  ageInput.style.borderColor = "";
}

/** Read the selected citizenship radio button value. Defaults to "indian". */
function getCitizenshipValue() {
  return document.querySelector('input[name="citizenship"]:checked')?.value ?? "indian";
}


// ── Result Renderer ────────────────────────────────────────────────────────

/**
 * Render the eligibility result card with verdict, criteria badges,
 * explanation, next steps, and action buttons.
 *
 * @param {object} data - Response from /api/eligibility or clientFallback().
 */
function renderResult(data) {
  const { eligible, age_eligible, citizenship_eligible, explanation, next_steps } = data;

  // Banner colour (green = eligible, red = ineligible)
  resultBanner.className = `result-banner ${eligible ? "eligible-banner" : "ineligible-banner"}`;

  // Icon and verdict text — 4 distinct states
  if (eligible) {
    resultIcon.textContent    = "✅";
    resultVerdict.textContent = "Eligible to Vote!";
  } else if (!age_eligible && citizenship_eligible) {
    resultIcon.textContent    = "⏳";
    resultVerdict.textContent = "Not Yet Eligible (Age)";
  } else if (age_eligible && !citizenship_eligible) {
    resultIcon.textContent    = "🌍";
    resultVerdict.textContent = "Not Eligible (Citizenship)";
  } else {
    resultIcon.textContent    = "❌";
    resultVerdict.textContent = "Not Eligible";
  }

  // Criteria badges — pass/fail for each criterion
  criteriaBadges.innerHTML = `
    <span class="badge ${age_eligible         ? "pass" : "fail"}">
      ${age_eligible         ? "✔" : "✘"} Age
    </span>
    <span class="badge ${citizenship_eligible ? "pass" : "fail"}">
      ${citizenship_eligible ? "✔" : "✘"} Citizenship
    </span>
  `;

  // Human-readable explanation
  resultExpl.textContent = explanation;

  // Numbered next-steps list
  nextStepsList.innerHTML = next_steps
    .map((step, i) => `
      <li>
        <span class="step-num">${i + 1}</span>
        <span>${escapeHtml(step)}</span>
      </li>`)
    .join("");

  // Action buttons — context-appropriate for eligible vs ineligible
  resultActions.innerHTML = eligible
    ? `<a href="https://voters.eci.gov.in" target="_blank" rel="noopener" class="btn-solid">
         Register to Vote →
       </a>
       <a href="chat.html" class="btn-outline">Ask the AI →</a>`
    : `<a href="chat.html" class="btn-solid">Ask CivicGuide AI →</a>
       <a href="https://eci.gov.in" target="_blank" rel="noopener" class="btn-outline">
         Visit ECI →
       </a>`;

  // Show the card with a re-trigger animation
  resultEmpty.style.display      = "none";
  resultCard.style.display       = "block";
  resultCard.style.animation     = "none";
  requestAnimationFrame(() => { resultCard.style.animation = ""; });

  // On mobile, scroll the result into view
  if (window.innerWidth < 768) {
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}


// ── Client-Side Fallback ───────────────────────────────────────────────────

/**
 * Mirror the backend eligibility logic client-side.
 * Used when the backend is unreachable so the page remains functional offline.
 *
 * @param {number}  age       - Voter's age.
 * @param {boolean} isCitizen - True if Indian citizen.
 * @returns {object} Same shape as the /api/eligibility response.
 */
function clientFallback(age, isCitizen) {
  const ageOk    = age >= VOTING_AGE;
  const eligible = ageOk && isCitizen;

  let explanation, next_steps;

  if (eligible) {
    explanation = `You are ${age} years old and an Indian citizen — you are eligible to vote!`;
    next_steps  = [
      "Check your name on the Electoral Roll at voters.eci.gov.in.",
      "If not registered, apply using Form 6 on the Voter Portal.",
      "Collect your Voter ID Card (EPIC).",
      "Find your polling booth on election day.",
    ];
  } else if (!ageOk && isCitizen) {
    explanation = `You are ${age} years old. You must be at least ${VOTING_AGE} to vote. You will be eligible in ${VOTING_AGE - age} year(s).`;
    next_steps  = [
      "Get your Aadhaar Card if you don't have one.",
      "Learn about elections at eci.gov.in.",
      `Register as a voter when you turn ${VOTING_AGE}.`,
      "Encourage eligible family members to vote.",
    ];
  } else if (ageOk && !isCitizen) {
    explanation = "Only Indian citizens can vote. NRIs with Indian passports may have special provisions.";
    next_steps  = [
      "Check NRI overseas voter registration (Form 6A) at eci.gov.in.",
      "Contact your nearest Indian Embassy or Consulate.",
      "Visit eci.gov.in for full eligibility details.",
    ];
  } else {
    explanation = "You do not meet the eligibility criteria — both age (18+) and Indian citizenship are required.";
    next_steps  = [
      "Learn about the election process at eci.gov.in.",
      "Check back when you meet the age and citizenship requirements.",
    ];
  }

  return {
    eligible,
    age_eligible:          ageOk,
    citizenship_eligible:  isCitizen,
    reasons:               [],
    explanation,
    next_steps,
  };
}


// ── Form Submission ────────────────────────────────────────────────────────

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAgeError();

  // Validate age field
  const ageRaw = ageInput.value.trim();
  if (!ageRaw) { showAgeError("Please enter your age."); return; }

  const age = parseInt(ageRaw, 10);
  if (isNaN(age) || age < 0 || age > 130) {
    showAgeError("Please enter a valid age between 0 and 130.");
    return;
  }

  const citizenship = getCitizenshipValue();
  setLoading(true);

  try {
    // apiPost from api.js includes timeout via AbortController.
    const data = await apiPost("/api/eligibility", { age, citizenship });
    renderResult(data);

  } catch (err) {
    console.warn("[CivicGuide AI] Backend unreachable — using client fallback:", err.message);
    // Graceful degradation: run the same logic client-side.
    renderResult(clientFallback(age, citizenship === "indian"));

  } finally {
    setLoading(false);
  }
});

// Clear validation error as the user corrects their input.
ageInput.addEventListener("input", clearAgeError);
