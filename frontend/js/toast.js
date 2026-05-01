/**
 * toast.js — CivicGuide AI shared toast notification system.
 *
 * Provides non-blocking, auto-dismissing notifications that slide in from
 * the bottom-right corner.  Used across all pages for error, success, and
 * info feedback so alert() and console-only errors are never the UX.
 *
 * Usage (import in any module):
 *   import { showToast } from './toast.js';
 *
 *   showToast("Location not found.", "error");
 *   showToast("Reminder added!", "success");
 *   showToast("Loading timeline…", "info");
 */

// ── Container ──────────────────────────────────────────────────────────────
// Lazily created once and reused for all toasts.
let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement("div");
    container.id            = "toast-container";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "false");
    applyStyles(container, {
      position:     "fixed",
      bottom:       "1.5rem",
      right:        "1.5rem",
      zIndex:       "9999",
      display:      "flex",
      flexDirection:"column",
      gap:          "0.6rem",
      maxWidth:     "360px",
      pointerEvents:"none",  // clicks pass through the container
    });
    document.body.appendChild(container);
  }
  return container;
}


// ── Theme map ──────────────────────────────────────────────────────────────
const THEMES = {
  success: { bg: "#22c55e", icon: "✅", label: "Success" },
  error:   { bg: "#ef4444", icon: "⚠️", label: "Error"   },
  info:    { bg: "#6366f1", icon: "ℹ️", label: "Info"    },
  warning: { bg: "#f59e0b", icon: "🔔", label: "Warning" },
};


// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Show a toast notification.
 *
 * @param {string} message         - Text to display.
 * @param {"success"|"error"|"info"|"warning"} [type="info"] - Visual style.
 * @param {number} [durationMs=4000] - How long before auto-dismiss (ms).
 */
export function showToast(message, type = "info", durationMs = 4000) {
  const theme = THEMES[type] || THEMES.info;
  const toast = buildToast(message, theme);

  getContainer().appendChild(toast);

  // Slide in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity   = "1";
      toast.style.transform = "translateY(0)";
    });
  });

  // Auto-dismiss
  const timer = setTimeout(() => dismiss(toast), durationMs);

  // Manual dismiss on click
  toast.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss(toast);
  });
}

/**
 * Dismiss all currently visible toasts.
 */
export function clearToasts() {
  if (!container) return;
  [...container.children].forEach(dismiss);
}


// ── Internal helpers ───────────────────────────────────────────────────────

function buildToast(message, theme) {
  const toast = document.createElement("div");
  toast.setAttribute("role", "alert");
  applyStyles(toast, {
    display:        "flex",
    alignItems:     "flex-start",
    gap:            "0.6rem",
    padding:        "0.75rem 1rem",
    borderRadius:   "10px",
    background:     theme.bg,
    color:          "#fff",
    fontFamily:     "Inter, system-ui, sans-serif",
    fontSize:       "0.875rem",
    fontWeight:     "500",
    lineHeight:     "1.4",
    boxShadow:      "0 8px 24px rgba(0,0,0,0.35)",
    cursor:         "pointer",
    pointerEvents:  "auto",
    // Start state for animation
    opacity:        "0",
    transform:      "translateY(12px)",
    transition:     "opacity 0.25s ease, transform 0.25s ease",
  });

  const icon = document.createElement("span");
  icon.textContent = theme.icon;
  icon.style.flexShrink = "0";

  const text = document.createElement("span");
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  return toast;
}

function dismiss(toast) {
  if (!toast.parentNode) return;
  toast.style.opacity   = "0";
  toast.style.transform = "translateY(8px)";
  setTimeout(() => toast.remove(), 280);
}

function applyStyles(el, styles) {
  Object.assign(el.style, styles);
}
