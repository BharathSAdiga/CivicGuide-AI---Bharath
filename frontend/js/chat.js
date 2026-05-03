/**
 * chat.js — CivicGuide AI enhanced chat interface.
 *
 * New features in this version:
 *  - 👍 / 👎 reaction buttons on every AI bubble (POST /api/feedback)
 *  - 📋 Copy-to-clipboard button on every AI bubble
 *  - 💡 Dynamic follow-up suggestion chips parsed from the streaming footer
 *  - ⏹  Stop-generation button cancels the in-flight stream
 *  - 💾 Export chat as a plain-text transcript download
 *  - Character counter, duplicate-send guard, toast notifications (unchanged)
 */

import { apiPost, apiStreamPost, escapeHtml, formatTime, pingBackend } from "./api.js";
import { showToast } from "./toast.js";

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_KEY    = "civicguide_user";
const VOTING_AGE     = 18;
const CHAT_MAX_CHARS = 1_000;
const WARN_THRESHOLD = 0.80;

/** Sentinel tokens that wrap the suggestions JSON footer from the backend. */
const SUGGESTIONS_START = "[SUGGESTIONS]";
const SUGGESTIONS_END   = "[/SUGGESTIONS]";


// ── Application State ──────────────────────────────────────────────────────
let conversationHistory = [];
let isLoading           = false;
let userContext         = null;
let currentLanguage     = "english";
let stopRequested       = false;   // Set to true when user clicks Stop


// ── DOM References ─────────────────────────────────────────────────────────
const appEl        = document.getElementById("app");
const modalEl      = document.getElementById("onboarding-modal");
const obForm       = document.getElementById("onboarding-form");
const obNameEl     = document.getElementById("ob-name");
const obAgeEl      = document.getElementById("ob-age");
const obLocationEl = document.getElementById("ob-location");
const formErrorEl  = document.getElementById("form-error");

const messagesEl     = document.getElementById("chat-messages");
const welcomeEl      = document.getElementById("welcome-state");
const welcomeHeading = document.getElementById("welcome-heading");
const welcomeSub     = document.getElementById("welcome-sub");
const inputEl        = document.getElementById("user-input");
const sendBtn        = document.getElementById("send-btn");
const newChatBtn     = document.getElementById("new-chat-btn");
const boothFinderBtn = document.getElementById("booth-finder-btn");
const stopBtn        = document.getElementById("stop-btn");
const exportBtn      = document.getElementById("export-btn");

const profileAvatar  = document.getElementById("profile-avatar");
const profileName    = document.getElementById("profile-name");
const profileMeta    = document.getElementById("profile-meta");
const profileEditBtn = document.getElementById("profile-edit-btn");
const eligBadge      = document.getElementById("eligibility-badge");
const eligIcon       = document.getElementById("eligibility-icon");
const eligText       = document.getElementById("eligibility-text");

const charCounter = createCharCounter();


// ══════════════════════════════════════════════════════════════════════════
// CHARACTER COUNTER
// ══════════════════════════════════════════════════════════════════════════

function createCharCounter() {
  const counter = document.createElement("span");
  counter.id = "char-counter";
  Object.assign(counter.style, {
    fontSize:    "0.75rem",
    color:       "var(--text-muted, #64748b)",
    transition:  "color 0.2s",
    userSelect:  "none",
    marginLeft:  "auto",
    display:     "block",
    textAlign:   "right",
    paddingRight:"0.25rem",
    marginTop:   "0.25rem",
    visibility:  "hidden",
  });
  const hint = document.querySelector(".input-hint");
  if (hint) hint.parentNode.insertBefore(counter, hint);
  return counter;
}

function updateCharCounter(length) {
  const remaining  = CHAT_MAX_CHARS - length;
  const isVisible  = length > 0;
  const isWarning  = length >= CHAT_MAX_CHARS * WARN_THRESHOLD;
  const isExceeded = length > CHAT_MAX_CHARS;

  charCounter.style.visibility = isVisible ? "visible" : "hidden";
  charCounter.textContent      = `${length} / ${CHAT_MAX_CHARS}`;
  charCounter.style.color      = isExceeded ? "#ef4444"
    : isWarning ? "#f59e0b"
    : "var(--text-muted, #64748b)";

  if (isExceeded) charCounter.textContent += ` (${-remaining} over limit)`;
}


// ══════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════════════════

function loadUserContext() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveUserContext(ctx) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  userContext = ctx;
}

function clearUserContext() {
  localStorage.removeItem(STORAGE_KEY);
  userContext = null;
}

function showOnboarding() {
  modalEl.style.display = "flex";
  appEl.style.display   = "none";
}

function showApp() {
  modalEl.style.display = "none";
  appEl.style.display   = "grid";
  populateProfile();
  personaliseWelcome();
}

function showFormError(msg) {
  formErrorEl.textContent = msg;
  formErrorEl.hidden      = false;
  formErrorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

obForm.addEventListener("submit", (e) => {
  e.preventDefault();
  formErrorEl.hidden = true;

  const name     = obNameEl.value.trim();
  const ageRaw   = obAgeEl.value.trim();
  const location = obLocationEl.value.trim();

  if (!name)     { showFormError("Please enter your name.");           return; }
  if (!ageRaw)   { showFormError("Please enter your age.");            return; }
  if (!location) { showFormError("Please enter your state or city.");  return; }

  const age = parseInt(ageRaw, 10);
  if (isNaN(age) || age < 5 || age > 120) {
    showFormError("Please enter a valid age between 5 and 120.");
    return;
  }

  if (!/\S/.test(name)) {
    showFormError("Please enter a valid name.");
    return;
  }

  saveUserContext({ name: name.slice(0, 60), age, location: location.slice(0, 80) });
  showApp();
});

profileEditBtn.addEventListener("click", () => {
  if (userContext) {
    obNameEl.value     = userContext.name     || "";
    obAgeEl.value      = userContext.age      || "";
    obLocationEl.value = userContext.location || "";
  }
  clearUserContext();
  conversationHistory = [];
  clearMessages();
  showOnboarding();
});


// ══════════════════════════════════════════════════════════════════════════
// PROFILE & ELIGIBILITY BADGE
// ══════════════════════════════════════════════════════════════════════════

function populateProfile() {
  if (!userContext) return;
  const { name, age, location } = userContext;

  profileAvatar.textContent = name ? name[0].toUpperCase() : "?";
  profileName.textContent   = name || "—";
  profileMeta.textContent   = `${age} yrs · ${location}`;

  eligBadge.hidden = false;
  if (age >= VOTING_AGE) {
    eligBadge.className  = "eligibility-badge eligible";
    eligIcon.textContent = "✅";
    eligText.textContent = "Eligible to Vote";
  } else {
    eligBadge.className  = "eligibility-badge ineligible";
    eligIcon.textContent = "⏳";
    eligText.textContent = `Eligible at 18 (${VOTING_AGE - age} yrs away)`;
  }
}

function personaliseWelcome() {
  if (!userContext) return;
  const { name, age } = userContext;
  const firstName = name.split(" ")[0];

  welcomeHeading.textContent = `Hi ${firstName}! How can I help you?`;
  welcomeSub.textContent = age < VOTING_AGE
    ? `You're ${age} years old — not yet eligible, but learn about elections now!`
    : `You're eligible to vote! Ask about registration, polling day, and more.`;
}


// ══════════════════════════════════════════════════════════════════════════
// LANGUAGE TOGGLE
// ══════════════════════════════════════════════════════════════════════════

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentLanguage = btn.dataset.lang;
    document.querySelectorAll(".lang-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (inputEl) {
      inputEl.placeholder = currentLanguage === "hindi"
        ? "चुनाव प्रक्रिया के बारे में पूछें…"
        : "Ask about the election process...";
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════
// MARKDOWN RENDERER
// ══════════════════════════════════════════════════════════════════════════

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(
    /^\*\*(📋|💡|📄|🗳️|📅|🔢|🏛️|ℹ️|🔗)?\ *(.+?)\*\*$/gm,
    '<p class="bubble-section-header">$1 $2</p>'
  );
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g,     "<em>$1</em>");

  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="num-item">$1</li>');
  html = html.replace(
    /(<li class="num-item">[\s\S]*?<\/li>)(\s*(?!<li class="num-item">))/g,
    (m) => (m.includes('<li class="num-item">') ? `<ol>${m}</ol>` : m)
  );

  html = html.replace(/^[-•]\s+(.+)$/gm, '<li class="bul-item">$1</li>');
  html = html.replace(
    /(<li class="bul-item">[\s\S]*?<\/li>)(\s*(?!<li class="bul-item">))/g,
    (m) => `<ul>${m}</ul>`
  );

  html = html.replace(/\n{2,}/g, "<br/><br/>");
  html = html.replace(/\n/g,     "<br/>");
  return html;
}


// ══════════════════════════════════════════════════════════════════════════
// STREAMING — SUGGESTIONS FOOTER PARSER
// ══════════════════════════════════════════════════════════════════════════

/**
 * Split accumulated stream text into [displayText, suggestions[]].
 * The backend appends a special footer after the AI prose:
 *   \n\n[SUGGESTIONS]{"suggestions":["Q1","Q2","Q3"]}[/SUGGESTIONS]
 */
function parseSuggestionsFromStream(fullText) {
  const startIdx = fullText.indexOf(SUGGESTIONS_START);
  if (startIdx === -1) return { displayText: fullText, suggestions: [] };

  const displayText = fullText.slice(0, startIdx).trimEnd();
  const jsonPart    = fullText.slice(startIdx + SUGGESTIONS_START.length);
  const endIdx      = jsonPart.indexOf(SUGGESTIONS_END);

  try {
    const parsed = JSON.parse(endIdx === -1 ? jsonPart : jsonPart.slice(0, endIdx));
    return { displayText, suggestions: parsed.suggestions || [] };
  } catch {
    return { displayText, suggestions: [] };
  }
}


// ══════════════════════════════════════════════════════════════════════════
// CHAT RENDERING
// ══════════════════════════════════════════════════════════════════════════

function appendMessage(role, html) {
  welcomeEl.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className   = `avatar ${role}`;
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "ai"
    ? "🏛️"
    : (userContext?.name?.[0]?.toUpperCase() || "👤");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<p>${html}</p><span class="bubble-time">${formatTime()}</span>`;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  return wrapper;
}

/**
 * Append the action bar (👍 👎 📋) to an AI bubble after streaming completes.
 */
function appendBubbleActions(msgWrapper, rawText, intent) {
  const bubble = msgWrapper.querySelector(".bubble");
  if (!bubble || bubble.querySelector(".bubble-actions")) return;

  const bar = document.createElement("div");
  bar.className = "bubble-actions";
  bar.setAttribute("aria-label", "Message actions");

  // Thumbs up
  const upBtn = document.createElement("button");
  upBtn.className = "bubble-action-btn";
  upBtn.title = "Helpful";
  upBtn.setAttribute("aria-label", "Mark as helpful");
  upBtn.innerHTML = "👍";
  upBtn.addEventListener("click", () => {
    if (upBtn.classList.contains("active-up")) return;
    upBtn.classList.add("active-up");
    downBtn.classList.remove("active-down");
    sendFeedback("up", rawText, intent);
    showToast("Thanks for the feedback! 😊", "success", 2500);
  });

  // Thumbs down
  const downBtn = document.createElement("button");
  downBtn.className = "bubble-action-btn";
  downBtn.title = "Not helpful";
  downBtn.setAttribute("aria-label", "Mark as not helpful");
  downBtn.innerHTML = "👎";
  downBtn.addEventListener("click", () => {
    if (downBtn.classList.contains("active-down")) return;
    downBtn.classList.add("active-down");
    upBtn.classList.remove("active-up");
    sendFeedback("down", rawText, intent);
    showToast("Got it — we'll keep improving! 🙏", "info", 2500);
  });

  // Copy
  const copyBtn = document.createElement("button");
  copyBtn.className = "bubble-action-btn";
  copyBtn.title = "Copy response";
  copyBtn.setAttribute("aria-label", "Copy response to clipboard");
  copyBtn.innerHTML = "📋 Copy";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      copyBtn.classList.add("copied");
      copyBtn.innerHTML = "✅ Copied";
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = "📋 Copy";
      }, 2000);
    } catch {
      showToast("Could not copy to clipboard.", "warning", 3000);
    }
  });

  bar.appendChild(upBtn);
  bar.appendChild(downBtn);
  bar.appendChild(copyBtn);
  bubble.appendChild(bar);
}

/**
 * Render follow-up suggestion chips below an AI bubble.
 */
function appendFollowupChips(msgWrapper, suggestions) {
  if (!suggestions || suggestions.length === 0) return;
  const bubble = msgWrapper.querySelector(".bubble");
  if (!bubble) return;

  const chipsEl = document.createElement("div");
  chipsEl.className = "followup-chips";

  suggestions.forEach((q) => {
    const chip = document.createElement("button");
    chip.className = "followup-chip";
    chip.textContent = q;
    chip.title = q;
    chip.addEventListener("click", () => {
      inputEl.value = q;
      inputEl.dispatchEvent(new Event("input"));
      // Remove chips to avoid stacking after follow-up
      chipsEl.remove();
      handleSend();
    });
    chipsEl.appendChild(chip);
  });

  bubble.appendChild(chipsEl);
}

function showTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "typing-indicator";
  wrapper.id        = "typing-indicator";

  const avatar = document.createElement("div");
  avatar.className   = "avatar ai";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "🏛️";

  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";

  wrapper.appendChild(avatar);
  wrapper.appendChild(dots);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
}

function hideTyping() {
  document.getElementById("typing-indicator")?.remove();
}

function clearMessages() {
  messagesEl.querySelectorAll(".message").forEach((m) => m.remove());
  welcomeEl.style.display = "flex";
  personaliseWelcome();
}


// ══════════════════════════════════════════════════════════════════════════
// FEEDBACK
// ══════════════════════════════════════════════════════════════════════════

async function sendFeedback(rating, reply, intent) {
  try {
    await apiPost("/api/feedback", {
      rating,
      reply: reply.slice(0, 200),
      intent: intent || "GENERAL",
    });
  } catch {
    // Silently swallow feedback errors — non-critical
  }
}


// ══════════════════════════════════════════════════════════════════════════
// EXPORT CHAT
// ══════════════════════════════════════════════════════════════════════════

function exportChat() {
  if (conversationHistory.length === 0) {
    showToast("No conversation to export yet.", "info", 3000);
    return;
  }

  const lines = [
    "CivicGuide AI — Chat Transcript",
    `Exported: ${new Date().toLocaleString("en-IN")}`,
    `User: ${userContext?.name || "Unknown"} · Age: ${userContext?.age} · ${userContext?.location}`,
    "─".repeat(60),
    "",
  ];

  conversationHistory.forEach((turn) => {
    const role = turn.role === "user" ? "You" : "CivicGuide AI";
    lines.push(`[${role}]`);
    lines.push(turn.parts[0]);
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `civicguide-chat-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Chat exported successfully! 💾", "success", 3000);
}

exportBtn?.addEventListener("click", exportChat);


// ══════════════════════════════════════════════════════════════════════════
// INPUT HANDLING
// ══════════════════════════════════════════════════════════════════════════

function updateSendState() {
  const length  = inputEl.value.length;
  const trimmed = inputEl.value.trim();
  sendBtn.disabled = !trimmed || isLoading || length > CHAT_MAX_CHARS;
}

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  updateCharCounter(inputEl.value.length);
  updateSendState();
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

sendBtn.addEventListener("click", handleSend);

// Quick-topic chip buttons
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-q]");
  if (btn) {
    inputEl.value = btn.dataset.q;
    inputEl.dispatchEvent(new Event("input"));
    handleSend();
  }
});

// New chat
newChatBtn.addEventListener("click", () => {
  conversationHistory  = [];
  clearMessages();
  inputEl.value        = "";
  inputEl.style.height = "auto";
  updateCharCounter(0);
  updateSendState();
});

// Stop generation
stopBtn?.addEventListener("click", () => {
  stopRequested = true;
  stopBtn.classList.remove("visible");
});


// ══════════════════════════════════════════════════════════════════════════
// BOOTH FINDER — GOOGLE MAPS INTEGRATION
// ══════════════════════════════════════════════════════════════════════════

const BOOTH_KEYWORDS = [
  "polling booth", "polling station", "voting booth", "voting centre",
  "voting center", "nearest booth", "find your booth", "booths near",
  "polling place", "where to vote", "locate booth", "booth finder",
  "voterportal", "polling day", "booth", "polling",
];

const _edCache = new Map();
function editDistance(a, b) {
  if (a.length < b.length) return editDistance(b, a);
  const key = a + "|" + b;
  if (_edCache.has(key)) return _edCache.get(key);
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < b.length; j++) {
      curr.push(Math.min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1)));
    }
    prev = curr;
  }
  const result = prev[b.length];
  if (_edCache.size > 10000) _edCache.clear();
  _edCache.set(key, result);
  return result;
}

function fuzzyIncludes(text, keyword, maxDist = 2) {
  if (text.includes(keyword)) return true;
  if (keyword.length <= 3) return false;
  const kLen = keyword.length;
  for (let ws = Math.max(1, kLen - 1); ws <= kLen + 1; ws++) {
    for (let i = 0; i <= text.length - ws; i++) {
      const window = text.slice(i, i + ws);
      const allowed = kLen >= 8 ? maxDist : Math.min(maxDist, Math.max(1, Math.floor(kLen / 4)));
      if (editDistance(window, keyword) <= allowed) return true;
    }
  }
  return false;
}

function openMapsWithBooths(lat, lng) {
  const url = `https://www.google.com/maps/search/polling+stations+near+me/@${lat},${lng},14z`;
  window.open(url, "_blank", "noopener");
}

function buildMapsLinkHTML() {
  return `
    <a class="maps-link-card" href="#" onclick="window._openBoothMaps(); return false;">
      <div class="maps-link-icon" aria-hidden="true">🗺️</div>
      <div class="maps-link-body">
        <strong>View Nearby Polling Booths</strong>
        <span>Opens Google Maps with polling stations near you</span>
      </div>
      <span class="maps-link-arrow">→</span>
    </a>`;
}

function maybeInjectBoothLink(aiText, msgWrapper) {
  const lower   = aiText.toLowerCase();
  const isBooth = BOOTH_KEYWORDS.some((kw) => fuzzyIncludes(lower, kw));
  if (!isBooth) return;
  const bubble = msgWrapper.querySelector(".bubble");
  if (!bubble || bubble.querySelector(".maps-link-card")) return;
  const linkEl = document.createElement("div");
  linkEl.innerHTML = buildMapsLinkHTML();
  bubble.appendChild(linkEl.firstElementChild);
}

window._openBoothMaps = function () {
  if (!navigator.geolocation) {
    const loc = userContext?.location || "India";
    window.open(
      `https://www.google.com/maps/search/polling+stations+near+${encodeURIComponent(loc)}`,
      "_blank", "noopener"
    );
    return;
  }
  showToast("Getting your location…", "info", 3000);
  navigator.geolocation.getCurrentPosition(
    (pos) => openMapsWithBooths(pos.coords.latitude, pos.coords.longitude),
    () => {
      const loc = userContext?.location || "India";
      window.open(
        `https://www.google.com/maps/search/polling+stations+near+${encodeURIComponent(loc)}`,
        "_blank", "noopener"
      );
      showToast("Location unavailable — searching near your registered area.", "warning", 4000);
    },
    { timeout: 8000, enableHighAccuracy: false }
  );
};

if (boothFinderBtn) {
  boothFinderBtn.addEventListener("click", () => window._openBoothMaps());
}


// ══════════════════════════════════════════════════════════════════════════
// MAIN SEND HANDLER
// ══════════════════════════════════════════════════════════════════════════

async function handleSend() {
  const message = inputEl.value.trim();

  if (!message)                        return;
  if (isLoading)                       return;
  if (message.length > CHAT_MAX_CHARS) {
    showToast(`Message too long — max ${CHAT_MAX_CHARS} characters.`, "warning");
    return;
  }

  isLoading        = true;
  stopRequested    = false;
  sendBtn.disabled = true;
  stopBtn?.classList.add("visible");

  appendMessage("user", escapeHtml(message));
  inputEl.value        = "";
  inputEl.style.height = "auto";
  updateCharCounter(0);

  conversationHistory.push({ role: "user", parts: [message] });
  showTyping();

  try {
    hideTyping();
    const msgWrapper = appendMessage("ai", "…");
    const bubbleP    = msgWrapper.querySelector(".bubble p");

    let fullReply     = "";
    let streamDone    = false;

    await apiStreamPost("/api/chat", {
      message,
      history:      conversationHistory.slice(0, -1),
      user_context: userContext || {},
      language:     currentLanguage,
    }, (chunk) => {
      if (stopRequested) return;   // silently drop chunks after stop
      fullReply += chunk;

      // Only render the display portion (strip footer if present)
      const { displayText } = parseSuggestionsFromStream(fullReply);
      bubbleP.innerHTML = renderMarkdown(displayText || "…");
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
    });

    // Parse final accumulated text for display + suggestions
    const { displayText, suggestions } = parseSuggestionsFromStream(fullReply);
    const finalDisplay = displayText || "I couldn't generate a response. Please try again.";
    bubbleP.innerHTML = renderMarkdown(finalDisplay);

    conversationHistory.push({ role: "model", parts: [finalDisplay] });

    // Inject booth map link if relevant
    maybeInjectBoothLink(finalDisplay, msgWrapper);

    // Append action bar (reactions + copy)
    appendBubbleActions(msgWrapper, finalDisplay, null);

    // Append follow-up suggestion chips
    appendFollowupChips(msgWrapper, suggestions);

  } catch (err) {
    hideTyping();
    appendMessage("ai", `⚠️ <strong>Error:</strong> ${escapeHtml(err.message)}`);
    showToast(err.message, "error", 6000);
    console.error("[CivicGuide AI] Chat error:", err);
  } finally {
    isLoading     = false;
    stopRequested = false;
    stopBtn?.classList.remove("visible");
    updateSendState();
  }
}


// ══════════════════════════════════════════════════════════════════════════
// BACKEND CONNECTION CHECK
// ══════════════════════════════════════════════════════════════════════════

async function checkBackendConnection() {
  const isOnline = await pingBackend();
  if (!isOnline) {
    showToast(
      "Backend server is offline. Some features may not work. " +
      "Start the Flask server at localhost:5000.",
      "warning",
      8000
    );
  }
}


// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

(function init() {
  userContext = loadUserContext();
  userContext ? showApp() : showOnboarding();
  checkBackendConnection();
})();
