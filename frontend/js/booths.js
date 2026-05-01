/**
 * booths.js — CivicGuide AI Polling Booth Finder.
 *
 * Reliability additions in this version:
 *  - Input validation before every API/geocoder call
 *  - Coordinate bounds check (lat/lng validity)
 *  - isSearching flag prevents duplicate concurrent requests
 *  - All errors surface via toast.js (non-blocking)
 *  - Loading skeleton shown during fetch
 *  - Geolocation errors classified with user-friendly messages
 *  - Offline fallback with toast notification
 */

import { apiPost, escapeHtml, debounce } from "./api.js";
import { showToast } from "./toast.js";

// ── Constants ──────────────────────────────────────────────────────────────
const INDIA_CENTER     = { lat: 20.5937, lng: 78.9629 };
const LOCATION_MIN_LEN = 2;    // Minimum chars for a valid search query
const LOCATION_MAX_LEN = 200;  // Maximum chars (matches backend config)
const GEO_TIMEOUT_MS   = 10_000; // Browser geolocation timeout

// ── Module State ───────────────────────────────────────────────────────────
let map          = null;
let markers      = [];
let userMarker   = null;
let infoWindow   = null;
let isSearching  = false;  // Prevents duplicate concurrent requests

// ── DOM References ─────────────────────────────────────────────────────────
const locationInput  = document.getElementById("location-input");
const searchBtn      = document.getElementById("search-btn");
const locateBtn      = document.getElementById("locate-btn");
const resultsList    = document.getElementById("results-list");
const mapEl          = document.getElementById("map");
const mapPlaceholder = document.getElementById("map-placeholder");


// ══════════════════════════════════════════════════════════════════════════
// GOOGLE MAPS INIT  (called by Maps JS API callback)
// ══════════════════════════════════════════════════════════════════════════

window.initMap = function () {
  map = new google.maps.Map(mapEl, {
    center:            INDIA_CENTER,
    zoom:              5,
    mapTypeId:         "roadmap",
    styles:            getDarkMapStyle(),
    zoomControl:       true,
    mapTypeControl:    false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  infoWindow = new google.maps.InfoWindow();

  // Places autocomplete — restricted to India
  const autocomplete = new google.maps.places.Autocomplete(locationInput, {
    componentRestrictions: { country: "in" },
    fields: ["geometry", "name", "formatted_address"],
  });

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    if (!place.geometry?.location) {
      showToast("Could not get coordinates for that location. Try typing a more specific address.", "warning");
      return;
    }
    fetchNearestBooths(
      place.geometry.location.lat(),
      place.geometry.location.lng()
    );
  });

  showMap();
};


// ── Map Visibility ─────────────────────────────────────────────────────────

function showMap() {
  mapPlaceholder.style.display = "none";
  mapEl.style.display          = "block";
}


// ══════════════════════════════════════════════════════════════════════════
// INPUT VALIDATION
// ══════════════════════════════════════════════════════════════════════════

/**
 * Validate the location input string before geocoding or fallback fetch.
 *
 * @param {string} value - Raw input string.
 * @returns {{ valid: boolean, errorMsg?: string, query?: string }}
 */
function validateLocationInput(value) {
  const query = value.trim();

  if (!query) {
    return { valid: false, errorMsg: "Please enter a city or area name." };
  }
  if (query.length < LOCATION_MIN_LEN) {
    return { valid: false, errorMsg: `Search query too short — please enter at least ${LOCATION_MIN_LEN} characters.` };
  }
  if (query.length > LOCATION_MAX_LEN) {
    return { valid: false, errorMsg: `Search query too long — maximum ${LOCATION_MAX_LEN} characters.` };
  }
  // Reject queries that are only numbers or special characters
  if (!/[a-zA-Z\u0900-\u097F]/.test(query)) {
    return { valid: false, errorMsg: "Please enter a valid place name (letters required)." };
  }

  return { valid: true, query };
}

/**
 * Validate lat/lng values are finite numbers within WGS84 bounds.
 *
 * @param {*} lat
 * @param {*} lng
 * @returns {{ valid: boolean, errorMsg?: string }}
 */
function validateCoordinates(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng)) {
    return { valid: false, errorMsg: "Invalid coordinates received." };
  }
  if (lat < -90 || lat > 90) {
    return { valid: false, errorMsg: `Latitude ${lat} is out of range [-90, 90].` };
  }
  if (lng < -180 || lng > 180) {
    return { valid: false, errorMsg: `Longitude ${lng} is out of range [-180, 180].` };
  }
  return { valid: true };
}


// ══════════════════════════════════════════════════════════════════════════
// GEOCODING
// ══════════════════════════════════════════════════════════════════════════

/**
 * Geocode an address string to lat/lng using the Google Maps Geocoder.
 * Appends ", India" to bias results to India.
 *
 * @param {string} address
 * @returns {Promise<{lat: number, lng: number}>}
 * @throws {Error} If geocoding fails or no result is found.
 */
function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    if (!window.google?.maps?.Geocoder) {
      reject(new Error("Google Maps is not loaded."));
      return;
    }
    new google.maps.Geocoder().geocode(
      { address: `${address}, India`, region: "in" },
      (results, status) => {
        if (status === "OK" && results?.[0]?.geometry?.location) {
          resolve({
            lat: results[0].geometry.location.lat(),
            lng: results[0].geometry.location.lng(),
          });
        } else {
          reject(new Error("Location not found. Try a more specific city or area name."));
        }
      }
    );
  });
}


// ══════════════════════════════════════════════════════════════════════════
// BOOTH FETCHING
// ══════════════════════════════════════════════════════════════════════════

/**
 * Fetch nearest booths from the backend and render results + map markers.
 * Validates coordinates before calling the API.
 * Falls back to client-side offline data on network failure.
 *
 * @param {number} lat
 * @param {number} lng
 */
async function fetchNearestBooths(lat, lng) {
  // Guard: validate coordinates
  const coordCheck = validateCoordinates(lat, lng);
  if (!coordCheck.valid) {
    showToast(coordCheck.errorMsg, "error");
    return;
  }

  // Guard: prevent duplicate concurrent requests
  if (isSearching) {
    showToast("Search already in progress — please wait.", "info", 2000);
    return;
  }

  isSearching = true;
  setSearchLoading(true);
  showLoadingSkeleton();

  try {
    const data = await apiPost("/api/booths/nearest", { lat, lng, limit: 3 });

    if (!data.booths || !Array.isArray(data.booths)) {
      throw new Error("Unexpected response format from server.");
    }

    renderResults(data.booths);
    placeMarkers(data.booths, { lat, lng });

  } catch (err) {
    console.warn("[CivicGuide AI] Booth fetch error — using offline fallback:", err.message);

    const fallback = getOfflineFallback(lat, lng);
    renderResults(fallback);
    placeMarkers(fallback, { lat, lng });

    showToast("Using offline booth data — backend unreachable.", "warning", 5000);

  } finally {
    isSearching = false;
    setSearchLoading(false);
  }
}


// ══════════════════════════════════════════════════════════════════════════
// RESULTS RENDERING
// ══════════════════════════════════════════════════════════════════════════

/** Show a loading skeleton while the API call is in flight. */
function showLoadingSkeleton() {
  resultsList.innerHTML = [1, 2, 3].map(() => `
    <div class="booth-card skeleton" aria-hidden="true">
      <div class="skeleton-line" style="width:70%;height:1rem;margin-bottom:.5rem;"></div>
      <div class="skeleton-line" style="width:50%;height:.75rem;margin-bottom:.35rem;"></div>
      <div class="skeleton-line" style="width:40%;height:.75rem;"></div>
    </div>
  `).join("");
}

/**
 * Render the list of booth result cards.
 * @param {object[]} booths
 */
function renderResults(booths) {
  if (!booths.length) {
    resultsList.innerHTML = `
      <div class="empty-results">
        <span class="empty-icon">😕</span>
        No booths found near this location. Try a different city or area.
      </div>`;
    return;
  }

  resultsList.innerHTML = booths.map((b, i) => `
    <div class="booth-card" id="booth-card-${i}" onclick="focusBooth(${i})">
      <div class="booth-card-header">
        <span class="booth-name">${escapeHtml(b.name)}</span>
        <span class="distance-badge">${b.distance_km} km</span>
      </div>
      <div class="booth-address">${escapeHtml(b.address)}</div>
      <div class="booth-meta">
        <span class="booth-tag">🏛️ ${escapeHtml(b.ward)}</span>
        <span class="booth-tag">🗳️ ${b.booths} booths</span>
        ${b.accessible ? '<span class="booth-tag">♿ Accessible</span>' : ""}
      </div>
    </div>
  `).join("");
}


// ══════════════════════════════════════════════════════════════════════════
// MAP MARKERS
// ══════════════════════════════════════════════════════════════════════════

/**
 * Clear existing markers and place new ones for the given booth list.
 * @param {object[]} booths
 * @param {{ lat: number, lng: number }} userPos
 */
function placeMarkers(booths, userPos) {
  if (!map) return;

  // Clear previous markers
  markers.forEach((m) => m.setMap(null));
  markers = [];
  if (userMarker) { userMarker.setMap(null); userMarker = null; }

  const bounds = new google.maps.LatLngBounds();

  // User location dot
  userMarker = new google.maps.Marker({
    position:  userPos,
    map,
    title:     "Your Location",
    zIndex:    10,
    icon: {
      path:         google.maps.SymbolPath.CIRCLE,
      scale:        10,
      fillColor:    "#6366f1",
      fillOpacity:  1,
      strokeColor:  "#fff",
      strokeWeight: 2,
    },
  });
  bounds.extend(userPos);

  // Booth markers
  booths.forEach((b, i) => {
    const pos    = { lat: b.lat, lng: b.lng };
    const marker = new google.maps.Marker({
      position:  pos,
      map,
      title:     b.name,
      animation: google.maps.Animation.DROP,
      label:     { text: String(i + 1), color: "#fff", fontWeight: "700", fontSize: "12px" },
      icon: {
        path:         google.maps.SymbolPath.MAP_PIN,
        scale:        14,
        fillColor:    "#3b82f6",
        fillOpacity:  1,
        strokeColor:  "#fff",
        strokeWeight: 1.5,
      },
    });

    marker.addListener("click", () => {
      infoWindow.setContent(`
        <div style="font-family:Inter,sans-serif;padding:4px 2px;max-width:240px;">
          <strong style="font-size:13px;">${escapeHtml(b.name)}</strong><br/>
          <span style="font-size:12px;color:#666;">${escapeHtml(b.address)}</span><br/>
          <span style="font-size:11px;color:#6366f1;font-weight:600;">📍 ${b.distance_km} km away</span>
        </div>
      `);
      infoWindow.open(map, marker);
      highlightCard(i);
    });

    markers.push(marker);
    bounds.extend(pos);
  });

  map.fitBounds(bounds, { padding: 80 });
}

/** Pan map to a booth and open its info window. Exposed as a global for onclick. */
window.focusBooth = (i) => {
  if (markers[i]) {
    map.panTo(markers[i].getPosition());
    map.setZoom(15);
    google.maps.event.trigger(markers[i], "click");
  }
  highlightCard(i);
};

function highlightCard(i) {
  document.querySelectorAll(".booth-card").forEach((c) => c.classList.remove("active"));
  document.getElementById(`booth-card-${i}`)?.classList.add("active");
}


// ══════════════════════════════════════════════════════════════════════════
// SEARCH BUTTON & KEYBOARD
// ══════════════════════════════════════════════════════════════════════════

searchBtn.addEventListener("click", async () => {
  const validation = validateLocationInput(locationInput.value);
  if (!validation.valid) {
    showToast(validation.errorMsg, "warning");
    locationInput.focus();
    return;
  }

  // No Maps loaded — use India centre as a demo position
  if (window.mapsLoadError || !window.google) {
    showToast("Google Maps is not loaded. Showing booth data for central India as demo.", "info", 4000);
    fetchNearestBooths(INDIA_CENTER.lat, INDIA_CENTER.lng);
    return;
  }

  setSearchLoading(true);
  try {
    const pos = await geocodeAddress(validation.query);
    fetchNearestBooths(pos.lat, pos.lng);
  } catch (err) {
    showToast(err.message, "error");
    setSearchLoading(false);
  }
});

// Submit on Enter key
locationInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchBtn.click();
});

// Clear previous error toast when the user starts typing again
locationInput.addEventListener("input", debounce(() => {
  // Optional: could pre-validate length here for instant feedback
}, 300));


// ══════════════════════════════════════════════════════════════════════════
// GPS GEOLOCATION
// ══════════════════════════════════════════════════════════════════════════

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported by your browser.", "error");
    return;
  }
  if (isSearching) {
    showToast("Search already in progress — please wait.", "info", 2000);
    return;
  }

  setLocateLoading(true);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocateLoading(false);
      fetchNearestBooths(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      setLocateLoading(false);
      const messages = {
        1: "Location access denied. Please allow location access in your browser settings.",
        2: "Location unavailable. Your device could not determine its position.",
        3: "Location request timed out. Please try again.",
      };
      showToast(messages[err.code] || "Could not access your location.", "error", 6000);
    },
    { timeout: GEO_TIMEOUT_MS, enableHighAccuracy: false }
  );
});


// ══════════════════════════════════════════════════════════════════════════
// LOADING STATE HELPERS
// ══════════════════════════════════════════════════════════════════════════

function setSearchLoading(on) {
  searchBtn.disabled    = on;
  searchBtn.textContent = on ? "Searching…" : "Find Nearest Booths →";
}

function setLocateLoading(on) {
  locateBtn.disabled    = on;
  locateBtn.textContent = on ? "📡 Locating…" : "📡 Use My Current Location";
}


// ══════════════════════════════════════════════════════════════════════════
// DARK MAP STYLE
// ══════════════════════════════════════════════════════════════════════════

function getDarkMapStyle() {
  return [
    { elementType: "geometry",                   stylers: [{ color: "#0a0e1a" }] },
    { elementType: "labels.text.fill",            stylers: [{ color: "#94a3b8" }] },
    { elementType: "labels.text.stroke",          stylers: [{ color: "#0a0e1a" }] },
    { featureType: "road",       elementType: "geometry",  stylers: [{ color: "#1a2235" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e2d4a" }] },
    { featureType: "water",      elementType: "geometry",  stylers: [{ color: "#0d1526" }] },
    { featureType: "poi",        elementType: "geometry",  stylers: [{ color: "#111827" }] },
    { featureType: "transit",    elementType: "geometry",  stylers: [{ color: "#111827" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1e2d4a" }] },
  ];
}


// ══════════════════════════════════════════════════════════════════════════
// HAVERSINE DISTANCE  (offline fallback)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Calculate great-circle distance between two WGS84 points (Haversine).
 * @returns {number} Distance in km, rounded to 2dp.
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180)
             * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLng / 2) ** 2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
}

/** Return the 3 nearest booths from the hardcoded dataset (offline mode). */
function getOfflineFallback(lat, lng) {
  const BOOTHS = [
    { id: "BLR001", name: "Government High School, Koramangala",       address: "80 Feet Road, Koramangala 4th Block, Bengaluru 560034",   ward: "Koramangala",    city: "Bengaluru", booths: 4, accessible: true,  lat: 12.9352, lng: 77.6245 },
    { id: "MUM001", name: "Municipal School, Bandra West",              address: "SV Road, Bandra West, Mumbai 400050",                    ward: "Bandra West",    city: "Mumbai",    booths: 6, accessible: true,  lat: 19.0596, lng: 72.8295 },
    { id: "DEL001", name: "Govt. Boys Sr. Sec. School, Connaught Place",address: "Block A, Connaught Place, New Delhi 110001",            ward: "Connaught Place",city: "Delhi",     booths: 7, accessible: true,  lat: 28.6315, lng: 77.2167 },
    { id: "CHE001", name: "Corporation School, T. Nagar",               address: "Usman Road, T. Nagar, Chennai 600017",                  ward: "T. Nagar",       city: "Chennai",   booths: 4, accessible: true,  lat: 13.0418, lng: 80.2341 },
    { id: "HYD001", name: "GHMC School, Banjara Hills",                 address: "Road No. 12, Banjara Hills, Hyderabad 500034",          ward: "Banjara Hills",  city: "Hyderabad", booths: 5, accessible: true,  lat: 17.4156, lng: 78.4347 },
  ];
  return BOOTHS
    .map((b) => ({ ...b, distance_km: haversine(lat, lng, b.lat, b.lng) }))
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 3);
}


// ══════════════════════════════════════════════════════════════════════════
// MAPS LOAD ERROR FALLBACK
// ══════════════════════════════════════════════════════════════════════════

window.addEventListener("load", () => {
  // Wait 3s — if Maps never loaded, show a graceful message in the map panel.
  setTimeout(() => {
    if (window.mapsLoadError || (!window.google && !window.initMapCalled)) {
      mapPlaceholder.innerHTML = `
        <span class="map-icon">🗺️</span>
        <h3>Map Unavailable</h3>
        <p>Add your <strong>Google Maps API key</strong> to <code>booths.html</code>
           to enable the interactive map. Booth results still work below.</p>
      `;
      showToast("Google Maps could not load. Booth search still works without the map.", "info", 6000);
    }
  }, 3000);
});
