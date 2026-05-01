// ── CivicGuide AI — Eligibility Checker JS ───────────────

const API_URL = "http://127.0.0.1:5000/api/eligibility";

// ─── DOM References ───────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────
function setLoading(on) {
  checkBtn.disabled     = on;
  spinner.style.display = on ? "block" : "none";
  btnLabel.textContent  = on ? "Checking…" : "Check Eligibility →";
}

function showAgeError(msg) {
  ageError.textContent  = msg;
  ageError.style.display = "block";
  ageInput.style.borderColor = "rgba(248,113,113,0.6)";
}

function clearAgeError() {
  ageError.style.display = "none";
  ageInput.style.borderColor = "";
}

function getCitizenshipValue() {
  return document.querySelector('input[name="citizenship"]:checked')?.value ?? "indian";
}

// ─── Render Result ────────────────────────────────────────
function renderResult(data) {
  const { eligible, age_eligible, citizenship_eligible,
          explanation, next_steps } = data;

  // Banner class
  resultBanner.className = `result-banner ${eligible ? "eligible-banner" : "ineligible-banner"}`;

  // Icon & verdict
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

  // Criteria badges
  criteriaBadges.innerHTML = `
    <span class="badge ${age_eligible ? "pass" : "fail"}">
      ${age_eligible ? "✔" : "✘"} Age
    </span>
    <span class="badge ${citizenship_eligible ? "pass" : "fail"}">
      ${citizenship_eligible ? "✔" : "✘"} Citizenship
    </span>
  `;

  // Explanation
  resultExpl.textContent = explanation;

  // Next steps
  nextStepsList.innerHTML = next_steps
    .map((step, i) => `
      <li>
        <span class="step-num">${i + 1}</span>
        <span>${escapeHtml(step)}</span>
      </li>`)
    .join("");

  // Action buttons
  if (eligible) {
    resultActions.innerHTML = `
      <a href="https://voters.eci.gov.in" target="_blank" rel="noopener" class="btn-solid">
        Register to Vote →
      </a>
      <a href="chat.html" class="btn-outline">Ask the AI →</a>
    `;
  } else {
    resultActions.innerHTML = `
      <a href="chat.html" class="btn-solid">Ask CivicGuide AI →</a>
      <a href="https://eci.gov.in" target="_blank" rel="noopener" class="btn-outline">
        Visit ECI →
      </a>
    `;
  }

  // Show result, hide empty
  resultEmpty.style.display = "none";
  resultCard.style.display  = "block";
  resultCard.style.animation = "none";
  // Trigger re-animation
  requestAnimationFrame(() => {
    resultCard.style.animation = "";
  });

  // Scroll result into view on mobile
  if (window.innerWidth < 768) {
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Form Submit ──────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAgeError();

  // Validate age
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
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ age, citizenship })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();
    renderResult(data);

  } catch (err) {
    console.error("[CivicGuide AI] Eligibility error:", err);
    // Graceful offline fallback — run logic client-side
    const fallback = clientFallback(age, citizenship === "indian");
    renderResult(fallback);
  } finally {
    setLoading(false);
  }
});

// ─── Client-side Fallback (offline) ──────────────────────
function clientFallback(age, isCitizen) {
  const ageOk  = age >= 18;
  const eligible = ageOk && isCitizen;

  let explanation, next_steps;

  if (eligible) {
    explanation = `You are ${age} years old and an Indian citizen — you are eligible to vote in Indian elections!`;
    next_steps  = [
      "Check your name on the Electoral Roll at voters.eci.gov.in.",
      "If not registered, apply using Form 6 on the Voter Portal.",
      "Collect your Voter ID Card (EPIC).",
      "Find your polling booth on election day."
    ];
  } else if (!ageOk && isCitizen) {
    explanation = `You are ${age} years old. You must be at least 18 to vote. You will be eligible in ${18 - age} year(s).`;
    next_steps  = [
      "Get your Aadhaar Card if you don't have one.",
      "Learn about elections at eci.gov.in.",
      `Register as a voter when you turn 18.`,
      "Encourage eligible family members to vote."
    ];
  } else if (ageOk && !isCitizen) {
    explanation = "Only Indian citizens can vote in Indian elections. NRIs with Indian passports may have special provisions.";
    next_steps  = [
      "Check NRI overseas voter registration (Form 6A) at eci.gov.in.",
      "Contact your nearest Indian Embassy or Consulate.",
      "Visit eci.gov.in for full citizenship eligibility details."
    ];
  } else {
    explanation = "You do not meet the eligibility criteria — both age (18+) and Indian citizenship are required.";
    next_steps  = [
      "Learn about the election process at eci.gov.in.",
      "Check back when you meet the age and citizenship requirements."
    ];
  }

  return {
    eligible,
    age_eligible: ageOk,
    citizenship_eligible: isCitizen,
    reasons: [],
    explanation,
    next_steps
  };
}

// ─── Clear error on input change ─────────────────────────
ageInput.addEventListener("input", clearAgeError);
