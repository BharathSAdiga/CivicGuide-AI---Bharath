// ── CivicGuide AI — Polling Booth Finder JS ───────────────

const API_URL  = "http://127.0.0.1:5000/api/booths/nearest";
const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

let map         = null;
let markers     = [];
let userMarker  = null;
let infoWindow  = null;
let currentLat  = null;
let currentLng  = null;

// ─── DOM refs ─────────────────────────────────────────────
const locationInput = document.getElementById("location-input");
const searchBtn     = document.getElementById("search-btn");
const locateBtn     = document.getElementById("locate-btn");
const resultsList   = document.getElementById("results-list");
const mapEl         = document.getElementById("map");
const mapPlaceholder= document.getElementById("map-placeholder");

// ─── Called by Google Maps callback ───────────────────────
function initMap() {
  map = new google.maps.Map(mapEl, {
    center: INDIA_CENTER,
    zoom: 5,
    mapTypeId: "roadmap",
    styles: getDarkMapStyle(),
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  infoWindow = new google.maps.InfoWindow();

  // Enable Places autocomplete
  const autocomplete = new google.maps.places.Autocomplete(locationInput, {
    componentRestrictions: { country: "in" },
    fields: ["geometry", "name", "formatted_address"],
  });

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    fetchNearestBooths(lat, lng);
  });

  showMap();
}

// ─── Show / hide map ──────────────────────────────────────
function showMap() {
  mapPlaceholder.style.display = "none";
  mapEl.style.display          = "block";
}

// ─── Geocode address string → lat/lng ─────────────────────
function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    if (!window.google) { reject(new Error("Maps not loaded")); return; }
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode(
      { address: address + ", India", region: "in" },
      (results, status) => {
        if (status === "OK" && results[0]) {
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

// ─── Fetch nearest booths from backend ────────────────────
async function fetchNearestBooths(lat, lng) {
  setSearchLoading(true);
  currentLat = lat;
  currentLng = lng;

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, limit: 3 }),
    });

    if (!res.ok) throw new Error(`Backend error ${res.status}`);
    const data = await res.json();
    renderResults(data.booths, { lat, lng });
    placeMarkers(data.booths, { lat, lng });

  } catch (err) {
    console.error("[CivicGuide AI] Booth fetch error:", err);
    // Client-side fallback using hardcoded booths
    const fallbackBooths = getOfflineFallback(lat, lng);
    renderResults(fallbackBooths, { lat, lng });
    placeMarkers(fallbackBooths, { lat, lng });
  } finally {
    setSearchLoading(false);
  }
}

// ─── Render result cards ──────────────────────────────────
function renderResults(booths, userPos) {
  if (!booths.length) {
    resultsList.innerHTML = `<div class="empty-results"><span class="empty-icon">😕</span>No booths found nearby. Try a different location.</div>`;
    return;
  }

  resultsList.innerHTML = booths.map((b, i) => `
    <div class="booth-card" id="booth-card-${i}" onclick="focusBooth(${i})">
      <div class="booth-card-header">
        <span class="booth-name">${esc(b.name)}</span>
        <span class="distance-badge">${b.distance_km} km</span>
      </div>
      <div class="booth-address">${esc(b.address)}</div>
      <div class="booth-meta">
        <span class="booth-tag">🏛️ ${esc(b.ward)}</span>
        <span class="booth-tag">🗳️ ${b.booths} booths</span>
        ${b.accessible ? '<span class="booth-tag">♿ Accessible</span>' : ""}
      </div>
    </div>
  `).join("");
}

// ─── Place map markers ────────────────────────────────────
function placeMarkers(booths, userPos) {
  if (!map) return;

  // Clear existing markers
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (userMarker) { userMarker.setMap(null); userMarker = null; }

  const bounds = new google.maps.LatLngBounds();

  // User location marker
  userMarker = new google.maps.Marker({
    position: userPos,
    map,
    title: "Your Location",
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: "#6366f1",
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 2,
    },
    zIndex: 10,
  });
  bounds.extend(userPos);

  // Booth markers
  booths.forEach((b, i) => {
    const pos = { lat: b.lat, lng: b.lng };
    const marker = new google.maps.Marker({
      position: pos,
      map,
      title: b.name,
      label: { text: String(i + 1), color: "#fff", fontWeight: "700", fontSize: "12px" },
      icon: {
        path: google.maps.SymbolPath.MAP_PIN,
        scale: 14,
        fillColor: "#3b82f6",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 1.5,
      },
      animation: google.maps.Animation.DROP,
    });

    marker.addListener("click", () => {
      infoWindow.setContent(`
        <div style="font-family:Inter,sans-serif;padding:4px 2px;max-width:240px;">
          <strong style="font-size:13px;">${esc(b.name)}</strong><br/>
          <span style="font-size:12px;color:#666;">${esc(b.address)}</span><br/>
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

// ─── Focus a booth card + marker ─────────────────────────
window.focusBooth = (i) => {
  if (markers[i]) {
    map.panTo(markers[i].getPosition());
    map.setZoom(15);
    google.maps.event.trigger(markers[i], "click");
  }
  highlightCard(i);
};

function highlightCard(i) {
  document.querySelectorAll(".booth-card").forEach(c => c.classList.remove("active"));
  document.getElementById(`booth-card-${i}`)?.classList.add("active");
}

// ─── Search button ────────────────────────────────────────
searchBtn.addEventListener("click", async () => {
  const query = locationInput.value.trim();
  if (!query) return;

  if (window.mapsLoadError || !window.google) {
    // No Maps: use lat/lng of India centre as fallback demo
    fetchNearestBooths(INDIA_CENTER.lat, INDIA_CENTER.lng);
    return;
  }

  try {
    setSearchLoading(true);
    const pos = await geocodeAddress(query);
    fetchNearestBooths(pos.lat, pos.lng);
  } catch (err) {
    showError(err.message);
    setSearchLoading(false);
  }
});

locationInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchBtn.click();
});

// ─── GPS locate ───────────────────────────────────────────
locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Geolocation is not supported by your browser.");
    return;
  }
  locateBtn.textContent = "📡 Locating…";
  locateBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locateBtn.textContent = "📡 Use My Current Location";
      locateBtn.disabled = false;
      fetchNearestBooths(pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      locateBtn.textContent = "📡 Use My Current Location";
      locateBtn.disabled = false;
      showError("Could not access your location. Please allow location access and try again.");
    }
  );
});

// ─── Helpers ─────────────────────────────────────────────
function setSearchLoading(on) {
  searchBtn.disabled   = on;
  searchBtn.textContent = on ? "Searching…" : "Find Nearest Booths →";
}

function showError(msg) {
  resultsList.innerHTML = `<div class="empty-results"><span class="empty-icon">⚠️</span>${esc(msg)}</div>`;
}

function esc(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ─── Dark map style ───────────────────────────────────────
function getDarkMapStyle() {
  return [
    { elementType:"geometry", stylers:[{ color:"#0a0e1a" }] },
    { elementType:"labels.text.fill", stylers:[{ color:"#94a3b8" }] },
    { elementType:"labels.text.stroke", stylers:[{ color:"#0a0e1a" }] },
    { featureType:"road", elementType:"geometry", stylers:[{ color:"#1a2235" }] },
    { featureType:"road.highway", elementType:"geometry", stylers:[{ color:"#1e2d4a" }] },
    { featureType:"water", elementType:"geometry", stylers:[{ color:"#0d1526" }] },
    { featureType:"poi", elementType:"geometry", stylers:[{ color:"#111827" }] },
    { featureType:"transit", elementType:"geometry", stylers:[{ color:"#111827" }] },
    { featureType:"administrative", elementType:"geometry.stroke", stylers:[{ color:"#1e2d4a" }] },
  ];
}

// ─── Offline fallback ─────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(2);
}

function getOfflineFallback(lat, lng) {
  const booths = [
    { id:"BLR001", name:"Government High School, Koramangala", address:"80 Feet Road, Koramangala 4th Block, Bengaluru 560034", ward:"Koramangala", city:"Bengaluru", booths:4, accessible:true, lat:12.9352, lng:77.6245 },
    { id:"MUM001", name:"Municipal School, Bandra West", address:"SV Road, Bandra West, Mumbai 400050", ward:"Bandra West", city:"Mumbai", booths:6, accessible:true, lat:19.0596, lng:72.8295 },
    { id:"DEL001", name:"Govt. Boys Sr. Sec. School, Connaught Place", address:"Block A, Connaught Place, New Delhi 110001", ward:"Connaught Place", city:"Delhi", booths:7, accessible:true, lat:28.6315, lng:77.2167 },
    { id:"CHE001", name:"Corporation School, T. Nagar", address:"Usman Road, T. Nagar, Chennai 600017", ward:"T. Nagar", city:"Chennai", booths:4, accessible:true, lat:13.0418, lng:80.2341 },
    { id:"HYD001", name:"GHMC School, Banjara Hills", address:"Road No. 12, Banjara Hills, Hyderabad 500034", ward:"Banjara Hills", city:"Hyderabad", booths:5, accessible:true, lat:17.4156, lng:78.4347 },
  ];
  return booths
    .map(b => ({ ...b, distance_km: haversine(lat, lng, b.lat, b.lng) }))
    .sort((a,b) => a.distance_km - b.distance_km)
    .slice(0, 3);
}

// ─── Maps load error fallback ─────────────────────────────
window.addEventListener("load", () => {
  setTimeout(() => {
    if (window.mapsLoadError || (!window.google && !window.initMapCalled)) {
      mapPlaceholder.innerHTML = `
        <span class="map-icon">🗺️</span>
        <h3>Map Unavailable</h3>
        <p>Add your <strong>Google Maps API key</strong> to <code>booths.html</code> to enable the map. Booth results still work below.</p>
      `;
    }
  }, 3000);
});
