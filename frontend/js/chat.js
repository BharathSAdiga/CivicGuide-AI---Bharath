/**
 * chat.js — CivicGuide AI context-aware chat interface.
 *
 * Handles: onboarding modal, localStorage profile, language toggle,
 * chat session with Gemini, multi-turn history, and markdown rendering.
 */

import { apiPost, escapeHtml, formatTime } from "./api.js";

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_KEY = "civicguide_user";
const VOTING_AGE  = 18;

// ── Application State ──────────────────────────────────────────────────────
let conversationHistory = [];  // [{role, parts}] for Gemini multi-turn context
let isLoading           = false;
let userContext         = null;       // { name, age, location }
let currentLanguage     = "english";  // "english" | "hindi"

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


// ══════════════════════════════════════════════════════════════════════════
// ONBOARDING — collect name/age/location on first visit
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

  saveUserContext({ name, age, location });
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

/** Populate the sidebar profile card and eligibility badge. */
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

/** Update the welcome-screen heading with the user's first name. */
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
 * Convert Gemini's markdown output to safe HTML.
 * Handles: HTML escaping, section headers, bold, italic, numbered/bullet lists.
 *
 * @param {string} text - Raw Gemini response.
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

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");  // Bold
  html = html.replace(/\*(.+?)\*/g,     "<em>$1</em>");          // Italic

  // Numbered list items → wrap groups in <ol>
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="num-item">$1</li>');
  html = html.replace(
    /(<li class="num-item">[\s\S]*?<\/li>)(\s*(?!<li class="num-item">))/g,
    (m) => (m.includes('<li class="num-item">') ? `<ol>${m}</ol>` : m)
  );

  // Bullet list items → wrap groups in <ul>
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
// CHAT RENDERING HELPERS
// ══════════════════════════════════════════════════════════════════════════

/**
 * Append a message bubble to the chat window.
 * @param {"user"|"ai"} role
 * @param {string} html - Pre-rendered safe HTML.
 */
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
// INPUT HANDLING
// ══════════════════════════════════════════════════════════════════════════

// Auto-resize textarea height as the user types.
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  sendBtn.disabled = inputEl.value.trim() === "" || isLoading;
});

// Submit on Enter; Shift+Enter inserts a newline.
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

sendBtn.addEventListener("click", handleSend);

// Quick-topic chip buttons (data-q attribute).
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-q]");
  if (btn) {
    inputEl.value = btn.dataset.q;
    inputEl.dispatchEvent(new Event("input"));
    handleSend();
  }
});

// New chat — reset history but keep profile.
newChatBtn.addEventListener("click", () => {
  conversationHistory  = [];
  clearMessages();
  inputEl.value        = "";
  inputEl.style.height = "auto";
  sendBtn.disabled     = true;
});


// ══════════════════════════════════════════════════════════════════════════
// MAIN SEND HANDLER
// ══════════════════════════════════════════════════════════════════════════

/**
 * Read input, call /api/chat, render the AI reply.
 * Uses apiPost from api.js (includes AbortController timeout).
 */
async function handleSend() {
  const message = inputEl.value.trim();
  if (!message || isLoading) return;

  isLoading        = true;
  sendBtn.disabled = true;

  appendMessage("user", escapeHtml(message));
  inputEl.value        = "";
  inputEl.style.height = "auto";

  // Push user turn before API call so history is current.
  conversationHistory.push({ role: "user", parts: [message] });

  showTyping();

  try {
    const data = await apiPost("/api/chat", {
      message,
      history:      conversationHistory.slice(0, -1),  // exclude current turn
      user_context: userContext || {},
      language:     currentLanguage,
    });

    hideTyping();

    const reply = data.reply || "I couldn't generate a response. Please try again.";
    appendMessage("ai", renderMarkdown(reply));
    conversationHistory.push({ role: "model", parts: [reply] });

  } catch (err) {
    hideTyping();
    appendMessage(
      "ai",
      `⚠️ <strong>Error:</strong> ${escapeHtml(err.message)}<br/>` +
      `Ensure the backend is running at <code>localhost:5000</code>.`
    );
    console.error("[CivicGuide AI] Chat error:", err);

  } finally {
    isLoading        = false;
    sendBtn.disabled = inputEl.value.trim() === "";
  }
}


// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

(function init() {
  userContext = loadUserContext();
  userContext ? showApp() : showOnboarding();
})();
