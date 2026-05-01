// ── CivicGuide AI — Chat JS ───────────────────────────────

const API_URL = "http://127.0.0.1:5000/api/chat";

// ─── State ────────────────────────────────────────────────
let conversationHistory = [];  // [{ role: "user"|"model", parts: ["..."] }]
let isLoading = false;

// ─── DOM References ───────────────────────────────────────
const messagesEl    = document.getElementById("chat-messages");
const welcomeEl     = document.getElementById("welcome-state");
const inputEl       = document.getElementById("user-input");
const sendBtn       = document.getElementById("send-btn");
const newChatBtn    = document.getElementById("new-chat-btn");

// ─── Helpers ──────────────────────────────────────────────
function getTime() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Very lightweight Markdown renderer for:
 * - **bold**, numbered lists, bullet lists, line breaks
 */
function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>")
    .replace(/(<li>.*<\/li>)/s, "<ol>$1</ol>")
    .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>");
}

// ─── Auto-resize textarea ─────────────────────────────────
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  sendBtn.disabled = inputEl.value.trim() === "" || isLoading;
});

// ─── Send on Enter (Shift+Enter = new line) ───────────────
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

sendBtn.addEventListener("click", handleSend);

// ─── Quick Topic Buttons ──────────────────────────────────
document.querySelectorAll(".topic-btn, .chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    const q = btn.dataset.q;
    if (q) {
      inputEl.value = q;
      inputEl.dispatchEvent(new Event("input"));
      handleSend();
    }
  });
});

// ─── New Chat ─────────────────────────────────────────────
newChatBtn.addEventListener("click", () => {
  conversationHistory = [];
  // Remove all message elements (keep welcome state)
  const msgs = messagesEl.querySelectorAll(".message");
  msgs.forEach(m => m.remove());
  welcomeEl.style.display = "flex";
  inputEl.value = "";
  inputEl.style.height = "auto";
  sendBtn.disabled = true;
});

// ─── Append Message ───────────────────────────────────────
function appendMessage(role, html) {
  welcomeEl.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === "ai" ? "🏛️" : "👤";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<p>${html}</p><span class="bubble-time">${getTime()}</span>`;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);

  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  return wrapper;
}

// ─── Typing Indicator ─────────────────────────────────────
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
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

// ─── Main Send Handler ────────────────────────────────────
async function handleSend() {
  const message = inputEl.value.trim();
  if (!message || isLoading) return;

  isLoading = true;
  sendBtn.disabled = true;

  // Show user message
  appendMessage("user", escapeHtml(message));

  // Reset input
  inputEl.value = "";
  inputEl.style.height = "auto";

  // Add to history
  conversationHistory.push({ role: "user", parts: [message] });

  // Show typing
  showTyping();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: conversationHistory.slice(0, -1)  // send history minus current msg
      })
    });

    hideTyping();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();
    const reply = data.reply || "I couldn't generate a response. Please try again.";

    // Show AI reply
    appendMessage("ai", renderMarkdown(reply));

    // Add AI reply to history
    conversationHistory.push({ role: "model", parts: [reply] });

  } catch (err) {
    hideTyping();
    appendMessage("ai", `⚠️ <strong>Error:</strong> ${escapeHtml(err.message)}<br/>
      Please ensure the backend is running at <code>localhost:5000</code>.`);
    console.error("[CivicGuide AI] Chat error:", err);
  } finally {
    isLoading = false;
    sendBtn.disabled = inputEl.value.trim() === "";
  }
}
