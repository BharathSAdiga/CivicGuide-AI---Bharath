/**
 * api.js — CivicGuide AI shared API client module.
 *
 * Centralizes all fetch() calls so that:
 *  - The base URL is defined once (change here to switch environments)
 *  - Every call uses AbortController for timeout/cancellation
 *  - Network errors trigger a single automatic retry (with backoff)
 *  - All errors are classified into user-friendly messages
 *  - Headers and content-type are set consistently
 *
 * Usage:
 *   import { apiPost, apiGet, escapeHtml, formatTime } from './api.js';
 */

// ── Configuration ──────────────────────────────────────────────────────────
/** Backend base URL. Uses current origin in production if served together, else localhost. */
const API_BASE = window.CIVICGUIDE_API_BASE || (window.location.port === "5500" ? "http://127.0.0.1:5000" : "");

/** Default request timeout in milliseconds before AbortController fires. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Number of automatic retries on network failure (not on 4xx/5xx). */
const MAX_RETRIES = 1;

/** Backoff delay (ms) between retries. */
const RETRY_DELAY_MS = 1_000;


// ── Error Classification ───────────────────────────────────────────────────

/**
 * Classify a caught error into a user-friendly message.
 *
 * Distinguishes between: timeout, no network connection, server errors,
 * and application-level errors from the backend JSON body.
 *
 * @param {Error}  err    - The caught error.
 * @param {number} status - HTTP status code (0 if request never completed).
 * @returns {string} Human-readable message safe to display in the UI.
 */
function classifyError(err, status = 0) {
  if (err.name === "AbortError") {
    return "Request timed out. Please check your connection and try again.";
  }
  if (!navigator.onLine) {
    return "No internet connection. Please check your network and try again.";
  }
  if (status === 0 || err.message?.includes("Failed to fetch")) {
    return "Cannot reach the backend server. Is it running on localhost:5000?";
  }
  if (status === 400) return `Invalid request: ${err.message}`;
  if (status === 404) return "API endpoint not found. Please reload the page.";
  if (status === 405) return "Method not allowed — this is a bug, please report it.";
  if (status === 413) return "Your message is too long. Please shorten it and try again.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500)  return "The server encountered an error. Please try again shortly.";
  // Fall back to the server's error message or the raw JS error message.
  return err.message || "An unknown error occurred.";
}


// ── Core Fetch Wrapper ─────────────────────────────────────────────────────

/**
 * Internal: perform one fetch attempt with an AbortController timeout.
 *
 * @param {string} path    - API path, e.g. "/api/chat"
 * @param {object} options - fetch options (method, body, headers, …)
 * @returns {Promise<object>} Parsed JSON response body.
 * @throws {Error} On network failure, timeout, or non-2xx status.
 */
async function attemptFetch(path, options) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let status = 0;

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal:  controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    status = response.status;

    // Always try to parse JSON — error bodies from the backend are JSON too.
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = json.error || `Server error ${status}`;
      const err = new Error(message);
      err.status = status;
      err.json   = json;
      throw err;
    }

    return json;

  } catch (err) {
    // Attach status to AbortError and network errors too so classifyError works.
    if (!err.status) err.status = status;
    throw err;

  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Perform a fetch with automatic retry on network-level failures.
 * Does NOT retry on 4xx or 5xx — only on "Failed to fetch" / AbortError
 * caused by the timeout.
 *
 * @param {string} path
 * @param {object} options
 * @returns {Promise<object>}
 */
async function apiFetch(path, options = {}) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await attemptFetch(path, options);
    } catch (err) {
      lastError = err;

      // Only retry on network / timeout errors, not application errors.
      const isNetworkError = (
        err.name === "AbortError"
        || !navigator.onLine
        || err.message?.includes("Failed to fetch")
      );
      const isRetryable = isNetworkError && attempt < MAX_RETRIES;

      if (!isRetryable) break;

      // Exponential backoff before the next attempt.
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  // Re-throw with a user-friendly message attached.
  lastError.message = classifyError(lastError, lastError.status);
  throw lastError;
}


// ── Convenience Methods ────────────────────────────────────────────────────

/**
 * POST JSON data to a backend endpoint.
 *
 * @param {string} path - API path, e.g. "/api/eligibility"
 * @param {object} body - Object to serialize as JSON request body.
 * @returns {Promise<object>}
 */
export async function apiPost(path, body) {
  return apiFetch(path, {
    method: "POST",
    body:   JSON.stringify(body),
  });
}

/**
 * POST JSON data and read stream response.
 *
 * @param {string} path - API path, e.g. "/api/chat"
 * @param {object} body - JSON body
 * @param {Function} onChunk - Callback for each chunk of text
 */
export async function apiStreamPost(path, body, onChunk) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 4); // longer timeout for streaming

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      const message = json.error || `Server error ${response.status}`;
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      onChunk(chunk);
    }
  } catch (err) {
    err.message = classifyError(err, err.status);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * GET data from a backend endpoint.
 *
 * @param {string} path - API path, e.g. "/api/timeline?type=lok_sabha"
 * @returns {Promise<object>}
 */
export async function apiGet(path) {
  return apiFetch(path, { method: "GET" });
}

/**
 * Ping the backend status endpoint to check if it is reachable.
 * Returns true if reachable, false otherwise. Never throws.
 *
 * @returns {Promise<boolean>}
 */
export async function pingBackend() {
  try {
    await apiFetch("/api/status", { method: "GET" });
    return true;
  } catch {
    return false;
  }
}


// ── Shared Utilities ───────────────────────────────────────────────────────

/**
 * Escape user-supplied content before inserting into innerHTML to prevent XSS.
 *
 * @param {*} value - Any value; coerced to string.
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
 * Format a Date object as a locale-aware HH:MM time string.
 *
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function formatTime(date = new Date()) {
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Debounce a function so it only fires after `wait` ms of inactivity.
 * Useful for search inputs to avoid firing on every keystroke.
 *
 * @param {Function} fn   - Function to debounce.
 * @param {number}   wait - Silence window in milliseconds.
 * @returns {Function}
 */
export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}


// ── Internal Utilities ─────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
