/**
 * chat.js — CivicGuide AI context-aware chat interface.
 *
 * Reliability additions in this version:
 *  - Character counter (warns at 80%, blocks at CHAT_MAX_CHARS)
 *  - Backend connection check on page load with toast feedback
 *  - Toast notifications (toast.js) for non-blocking error feedback
 *  - Duplicate-send prevention via isLoading guard
 *  - Input sanitized before sending (trim, empty check)
 *  - Graceful error messages in the chat bubble + toast
 */

import { apiPost, escapeHtml, formatTime, pingBackend } from "./api.js";
import { showToast } from "./toast.js";

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_KEY    = "civicguide_user";
const VOTING_AGE     = 18;
const CHAT_MAX_CHARS = 1_000;   // Must match backend CHAT_MAX_MESSAGE_LENGTH
const WARN_THRESHOLD = 0.80;    // Show counter colour change at 80% of limit


// ── Application State ──────────────────────────────────────────────────────
let conversationHistory = [];
let isLoading           = false;
let userContext         = null;
let currentLanguage     = "english";


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

const profileAvatar  = document.getElementById("profile-avatar");
const profileName    = document.getElementById("profile-name");
const profileMeta    = document.getElementById("profile-meta");
const profileEditBtn = document.getElementById("profile-edit-btn");
const eligBadge      = document.getElementById("eligibility-badge");
const eligIcon       = document.getElementById("eligibility-icon");
const eligText       = document.getElementById("eligibility-text");

// Character counter (injected below the input area)
const charCounter = createCharCounter();


// ══════════════════════════════════════════════════════════════════════════
// CHARACTER COUNTER
// ══════════════════════════════════════════════════════════════════════════

/**
 * Create and inject the character counter element below the input.
 * Returns the counter <span> so we can update it on input events.
 */
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
    visibility:  "hidden",  // Hidden until user starts typing
  });

  // Insert after the input wrapper (inside .chat-input-area)
  const hint = document.querySelector(".input-hint");
  if (hint) hint.parentNode.insertBefore(counter, hint);

  return counter;
}

/**
 * Update character counter text and colour based on current input length.
 * @param {number} length - Current character count.
 */
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

  if (isExceeded) {
    charCounter.textContent += ` (${-remaining} over limit)`;
  }
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

  // Validate each field — show a specific error and stop early.
  if (!name)     { showFormError("Please enter your name.");           return; }
  if (!ageRaw)   { showFormError("Please enter your age.");            return; }
  if (!location) { showFormError("Please enter your state or city.");  return; }

  const age = parseInt(ageRaw, 10);
  if (isNaN(age) || age < 5 || age > 120) {
    showFormError("Please enter a valid age between 5 and 120.");
    return;
  }

  // Validate name is not just spaces or numbers
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

/**
 * Convert Gemini's structured markdown to safe HTML for display.
 * @param {string} text - Raw Gemini response string.
 * @returns {string} HTML-safe string for innerHTML.
 */
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Section headers: **[emoji] Title** on its own line
  html = html.replace(
    /^\*\*(📋|💡|📄|🗳️|📅|🔢|🏛️|ℹ️)?\s*(.+?)\*\*$/gm,
    '<p class="bubble-section-header">$1 $2</p>'
  );
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g,     "<em>$1</em>");

  // Numbered list → <ol>
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="num-item">$1</li>');
  html = html.replace(
    /(<li class="num-item">[\s\S]*?<\/li>)(\s*(?!<li class="num-item">))/g,
    (m) => (m.includes('<li class="num-item">') ? `<ol>${m}</ol>` : m)
  );

  // Bullet list → <ul>
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
// CHAT RENDERING
// ══════════════════════════════════════════════════════════════════════════

function appendMessage(role, html) {
  welcomeEl.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className   = `avatar ${role}`;
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

function showTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "typing-indicator";
  wrapper.id        = "typing-indicator";

  const avatar = document.createElement("div");
  avatar.className   = "avatar ai";
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
// INPUT HANDLING & VALIDATION
// ══════════════════════════════════════════════════════════════════════════

/**
 * Determine whether the send button should be enabled.
 * Guards: non-empty trimmed message, not loading, not over char limit.
 */
function updateSendState() {
  const length  = inputEl.value.length;
  const trimmed = inputEl.value.trim();
  sendBtn.disabled = !trimmed || isLoading || length > CHAT_MAX_CHARS;
}

inputEl.addEventListener("input", () => {
  // Auto-resize textarea
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

// Quick-topic chip buttons (data-q attribute)
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-q]");
  if (btn) {
    inputEl.value = btn.dataset.q;
    inputEl.dispatchEvent(new Event("input"));
    handleSend();
  }
});

// New chat — reset history, keep profile
newChatBtn.addEventListener("click", () => {
  conversationHistory  = [];
  clearMessages();
  inputEl.value        = "";
  inputEl.style.height = "auto";
  updateCharCounter(0);
  updateSendState();
});


// ══════════════════════════════════════════════════════════════════════════
// MAIN SEND HANDLER
// ══════════════════════════════════════════════════════════════════════════

/**
 * Validate, send, and render one chat exchange.
 * Prevents duplicate sends via isLoading guard.
 * Injects user context and language on every call.
 */
async function handleSend() {
  const message = inputEl.value.trim();

  // ── Pre-send guards ────────────────────────────────────────────────────
  if (!message)                        return;
  if (isLoading)                       return;  // Prevent double-send
  if (message.length > CHAT_MAX_CHARS) {
    showToast(`Message too long — max ${CHAT_MAX_CHARS} characters.`, "warning");
    return;
  }

  isLoading        = true;
  sendBtn.disabled = true;

  appendMessage("user", escapeHtml(message));
  inputEl.value        = "";
  inputEl.style.height = "auto";
  updateCharCounter(0);

  conversationHistory.push({ role: "user", parts: [message] });
  showTyping();

  try {
    const data = await apiPost("/api/chat", {
      message,
      history:      conversationHistory.slice(0, -1),
      user_context: userContext || {},
      language:     currentLanguage,
    });

    hideTyping();

    const reply = data.reply || "I couldn't generate a response. Please try again.";
    appendMessage("ai", renderMarkdown(reply));
    conversationHistory.push({ role: "model", parts: [reply] });

  } catch (err) {
    hideTyping();

    // Show error in the chat so it's inline and clearly associated with
    // the failed message, then also show a toast for quick visibility.
    appendMessage(
      "ai",
      `⚠️ <strong>Error:</strong> ${escapeHtml(err.message)}`
    );
    showToast(err.message, "error", 6000);
    console.error("[CivicGuide AI] Chat error:", err);

  } finally {
    isLoading = false;
    updateSendState();
  }
}


// ══════════════════════════════════════════════════════════════════════════
// BACKEND CONNECTION CHECK
// ══════════════════════════════════════════════════════════════════════════

/**
 * Ping the backend on load and show a toast if it is unreachable.
 * Non-blocking — the chat is still usable (offline fallbacks exist).
 */
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

  // Non-blocking backend check — runs after the UI is ready.
  checkBackendConnection();
})();
