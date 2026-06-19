(function () {
  const sessionId = window.location.pathname.split('/').pop();

  const consentScreen = document.getElementById('consent-screen');
  const activeScreen = document.getElementById('active-screen');
  const stoppedScreen = document.getElementById('stopped-screen');
  const consentTitle = document.getElementById('consent-title');
  const consentEyebrow = document.getElementById('consent-eyebrow');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const errorBox = document.getElementById('error-box');
  const elapsedEl = document.getElementById('elapsed');
  const coordsEl = document.getElementById('coords');
  const accuracyEl = document.getElementById('accuracy');
  const pointsNoteEl = document.getElementById('points-note');

  let watchId = null;
  let startedAt = null;
  let timerInterval = null;
  let pointCount = 0;
  let lastSentAt = 0;
  const MIN_SEND_INTERVAL_MS = 4000;

  let map, marker, path, pathLine;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function pad(n) { return n.toString().padStart(2, '0'); }

  function tick() {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    elapsedEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function initMap(lat, lng) {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    marker = L.circleMarker([lat, lng], { radius: 7, color: '#16A394', fillColor: '#16A394', fillOpacity: 1 }).addTo(map);
    path = [[lat, lng]];
    pathLine = L.polyline(path, { color: '#16A394', weight: 3, opacity: 0.6 }).addTo(map);
  }

  function updateMap(lat, lng) {
    if (!map) { initMap(lat, lng); return; }
    marker.setLatLng([lat, lng]);
    path.push([lat, lng]);
    pathLine.setLatLngs(path);
    map.panTo([lat, lng]);
  }

  async function loadSession() {
    try {
      const res = await fetch(`/api/share/${sessionId}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      consentEyebrow.textContent = data.active ? 'Already sharing' : 'Location request';
      consentTitle.textContent = `${data.label} is requesting your live location`;
    } catch (err) {
      consentTitle.textContent = 'This link is no longer valid';
      startBtn.disabled = true;
      startBtn.style.opacity = 0.5;
    }
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  function handlePosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    coordsEl.textContent = `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`;
    accuracyEl.textContent = accuracy ? `accuracy ±${Math.round(accuracy)}m` : '';
    updateMap(latitude, longitude);

    const now = Date.now();
    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;
    lastSentAt = now;
    pointCount += 1;
    pointsNoteEl.textContent = `${pointCount} point${pointCount === 1 ? '' : 's'} recorded`;
    postJSON(`/api/share/${sessionId}/location`, { lat: latitude, lng: longitude, accuracy }).catch(() => {});
  }

  function handlePositionError(err) {
    let msg = 'Could not access your location.';
    if (err.code === err.PERMISSION_DENIED) {
      msg = 'Location permission was denied. Enable location access for this site in your browser settings, then tap Start again.';
    } else if (err.code === err.TIMEOUT) {
      msg = 'Location request timed out. Check your connection and try again.';
    }
    showError(msg);
  }

  async function startSharing() {
    errorBox.style.display = 'none';
    if (!navigator.geolocation) {
      showError('Your browser does not support location sharing.');
      return;
    }
    startBtn.disabled = true;

    watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });

    startedAt = Date.now();
    timerInterval = setInterval(tick, 1000);

    consentScreen.hidden = true;
    activeScreen.hidden = false;

    await postJSON(`/api/share/${sessionId}/start`).catch(() => {});
  }

  function stopSharing() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timerInterval) clearInterval(timerInterval);

    navigator.sendBeacon(`/api/share/${sessionId}/stop`);

    activeScreen.hidden = true;
    stoppedScreen.hidden = false;
  }

  window.addEventListener('pagehide', () => {
    if (watchId !== null) {
      navigator.sendBeacon(`/api/share/${sessionId}/stop`);
    }
  });

  startBtn.addEventListener('click', startSharing);
  stopBtn.addEventListener('click', stopSharing);

  loadSession();
})();
