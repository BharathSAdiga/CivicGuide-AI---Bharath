// ── CivicGuide AI — Context-Aware Chat JS ────────────────

const API_URL       = "http://127.0.0.1:5000/api/chat";
const STORAGE_KEY   = "civicguide_user";
const VOTING_AGE    = 18;

// ─── State ────────────────────────────────────────────────
let conversationHistory = [];
let isLoading           = false;
let userContext         = null;   // { name, age, location }

// ─── DOM References ───────────────────────────────────────
const appEl          = document.getElementById("app");
const modalEl        = document.getElementById("onboarding-modal");
const obForm         = document.getElementById("onboarding-form");
const obNameEl       = document.getElementById("ob-name");
const obAgeEl        = document.getElementById("ob-age");
const obLocationEl   = document.getElementById("ob-location");
const formErrorEl    = document.getElementById("form-error");

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

// ══════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════

function loadUserContext() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveUserContext(ctx) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  userContext = ctx;
}

function clearUserContext() {
  localStorage.removeItem(STORAGE_KEY);
  userContext = null;
}

/** Show the onboarding modal, hide the app */
function showOnboarding() {
  modalEl.style.display = "flex";
  appEl.style.display   = "none";
}

/** Hide the modal, show the app, populate profile */
function showApp() {
  modalEl.style.display = "none";
  appEl.style.display   = "grid";
  populateProfile();
  personaliseWelcome();
}

/** Validate and submit the onboarding form */
obForm.addEventListener("submit", (e) => {
  e.preventDefault();
  formErrorEl.hidden = true;

  const name     = obNameEl.value.trim();
  const ageRaw   = obAgeEl.value.trim();
  const location = obLocationEl.value.trim();

  if (!name)     { showFormError("Please enter your name."); return; }
  if (!ageRaw)   { showFormError("Please enter your age."); return; }
  if (!location) { showFormError("Please enter your state or city."); return; }

  const age = parseInt(ageRaw, 10);
  if (isNaN(age) || age < 5 || age > 120) {
    showFormError("Please enter a valid age between 5 and 120.");
    return;
  }

  saveUserContext({ name, age, location });
  showApp();
});

function showFormError(msg) {
  formErrorEl.textContent = msg;
  formErrorEl.hidden = false;
}

/** Edit profile — re-open modal pre-filled */
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

// ══════════════════════════════════════════════════════════
// PROFILE & ELIGIBILITY
// ══════════════════════════════════════════════════════════

function populateProfile() {
  if (!userContext) return;

  const { name, age, location } = userContext;
  const initial = name ? name[0].toUpperCase() : "?";

  profileAvatar.textContent = initial;
  profileName.textContent   = name || "—";
  profileMeta.textContent   = `${age} yrs · ${location}`;

  // Eligibility badge
  eligBadge.hidden = false;
  if (age >= VOTING_AGE) {
    eligBadge.className = "eligibility-badge eligible";
    eligIcon.textContent = "✅";
    eligText.textContent = "Eligible to Vote";
  } else {
    eligBadge.className = "eligibility-badge ineligible";
    eligIcon.textContent = "⏳";
    eligText.textContent = `Eligible at 18 (${VOTING_AGE - age} yrs away)`;
  }
}

function personaliseWelcome() {
  if (!userContext) return;
  const { name, age } = userContext;
  const firstName = name.split(" ")[0];

  welcomeHeading.textContent = `Hi ${firstName}! How can I help you?`;

  if (age < VOTING_AGE) {
    welcomeSub.textContent =
      `You're ${age} years old — not yet eligible to vote, but it's never too early to learn! ` +
      `Ask me anything about India's election process.`;
  } else {
    welcomeSub.textContent =
      `You're eligible to vote! Ask me about voter registration, polling day, ` +
      `or anything else about India's election process.`;
  }
}

// ══════════════════════════════════════════════════════════
// MARKDOWN RENDERER
// ══════════════════════════════════════════════════════════

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Section headers: **📋 Header** on its own line
  html = html.replace(/^\*\*(📋|💡|📄|🗳️|📅|🔢|🏛️|ℹ️)?\s*(.+?)\*\*$/gm,
    '<p class="bubble-section-header">$1 $2</p>');

  // Inline bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Numbered list items
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="num-item">$1</li>');
  html = html.replace(/(<li class="num-item">[\s\S]*?<\/li>)(\s*(?!<li class="num-item">))/g,
    (m) => m.includes('<li class="num-item">') ? `<ol>${m}</ol>` : m);

  // Bullet list items
  html = html.replace(/^[-•]\s+(.+)$/gm, '<li class="bul-item">$1</li>');
  html = html.replace(/(<li class="bul-item">[\s\S]*?<\/li>)(\s*(?!<li class="bul-item">))/g,
    (m) => `<ul>${m}</ul>`);

  html = html.replace(/\n{2,}/g, "<br/><br/>");
  html = html.replace(/\n/g, "<br/>");

  return html;
}

// ══════════════════════════════════════════════════════════
// CHAT LOGIC
// ══════════════════════════════════════════════════════════

function getTime() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function appendMessage(role, html) {
  welcomeEl.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === "ai" ? "🏛️" : (userContext?.name?.[0]?.toUpperCase() || "👤");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<p>${html}</p><span class="bubble-time">${getTime()}</span>`;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  return wrapper;
}

function showTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "typing-indicator";
  wrapper.id = "typing-indicator";

  const avatar = document.createElement("div");
  avatar.className = "avatar ai";
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
  messagesEl.querySelectorAll(".message").forEach(m => m.remove());
  welcomeEl.style.display = "flex";
  personaliseWelcome();
}

// ─── Auto-resize textarea ─────────────────────────────────
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  sendBtn.disabled = inputEl.value.trim() === "" || isLoading;
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

sendBtn.addEventListener("click", handleSend);

// Quick topic / chip buttons
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-q]");
  if (btn) {
    const q = btn.dataset.q;
    inputEl.value = q;
    inputEl.dispatchEvent(new Event("input"));
    handleSend();
  }
});

// New chat
newChatBtn.addEventListener("click", () => {
  conversationHistory = [];
  clearMessages();
  inputEl.value = "";
  inputEl.style.height = "auto";
  sendBtn.disabled = true;
});

// ── Main send handler ─────────────────────────────────────
async function handleSend() {
  const message = inputEl.value.trim();
  if (!message || isLoading) return;

  isLoading = true;
  sendBtn.disabled = true;

  appendMessage("user", escapeHtml(message));
  inputEl.value = "";
  inputEl.style.height = "auto";

  conversationHistory.push({ role: "user", parts: [message] });

  showTyping();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: conversationHistory.slice(0, -1),
        user_context: userContext || {}      // ← inject context every call
      })
    });

    hideTyping();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data  = await res.json();
    const reply = data.reply || "I couldn't generate a response. Please try again.";

    appendMessage("ai", renderMarkdown(reply));
    conversationHistory.push({ role: "model", parts: [reply] });

  } catch (err) {
    hideTyping();
    appendMessage("ai",
      `⚠️ <strong>Error:</strong> ${escapeHtml(err.message)}<br/>
      Please ensure the backend is running at <code>localhost:5000</code>.`
    );
    console.error("[CivicGuide AI] Chat error:", err);
  } finally {
    isLoading = false;
    sendBtn.disabled = inputEl.value.trim() === "";
  }
}

// ══════════════════════════════════════════════════════════
// INIT — Check localStorage, show modal or app
// ══════════════════════════════════════════════════════════
(function init() {
  userContext = loadUserContext();
  if (userContext) {
    showApp();
  } else {
    showOnboarding();
  }
})();
