/**
 * api.js — CivicGuide AI shared API client module.
 *
 * Centralizes all fetch() calls so that:
 *  - The base URL is defined once (change it here to switch environments)
 *  - Every call uses AbortController for timeout/cancellation support
 *  - Error handling is consistent across all feature modules
 *  - Headers are set in one place
 *
 * Usage:
 *   import { apiPost, apiGet } from './api.js';
 *
 *   const data = await apiPost('/api/chat', { message: '...' });
 */

// ── Configuration ──────────────────────────────────────────────────────────
/** Backend base URL. Override via window.CIVICGUIDE_API_BASE in index HTML for prod. */
const API_BASE = window.CIVICGUIDE_API_BASE || "http://127.0.0.1:5000";

/** Default request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000;


// ── Core Fetch Wrapper ─────────────────────────────────────────────────────

/**
 * Make a JSON fetch request to the CivicGuide backend.
 *
 * @param {string}  path     - API path, e.g. "/api/chat"
 * @param {object}  options  - fetch options (method, body, signal, etc.)
 * @returns {Promise<object>} Parsed JSON response body.
 * @throws {Error}  On network failure, timeout, or non-2xx HTTP status.
 */
async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal:  controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    // Attempt to parse JSON regardless of status so error bodies are readable.
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = json.error || `Server error ${response.status}`;
      throw new Error(message);
    }

    return json;

  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Please check your connection and try again.");
    }
    throw err;

  } finally {
    clearTimeout(timeoutId);
  }
}


// ── Convenience Methods ────────────────────────────────────────────────────

/**
 * POST JSON data to a backend endpoint.
 *
 * @param {string} path    - API path, e.g. "/api/eligibility"
 * @param {object} body    - Object to serialize as JSON request body.
 * @returns {Promise<object>}
 */
export async function apiPost(path, body) {
  return apiFetch(path, {
    method: "POST",
    body:   JSON.stringify(body),
  });
}

/**
 * GET data from a backend endpoint.
 *
 * @param {string} path    - API path, e.g. "/api/timeline?type=lok_sabha"
 * @returns {Promise<object>}
 */
export async function apiGet(path) {
  return apiFetch(path, { method: "GET" });
}

/**
 * Escape user-supplied content before inserting into innerHTML to prevent XSS.
 *
 * @param {*} value - Any value; will be coerced to string.
 * @returns {string} HTML-safe string.
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

/**
 * Format a Date object as a locale-aware time string (HH:MM).
 *
 * @param {Date} [date=new Date()] - Date to format.
 * @returns {string}
 */
export function formatTime(date = new Date()) {
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
