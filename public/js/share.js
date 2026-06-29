(function () {
  const sessionId = window.location.pathname.split('/').pop();

  const loadingScreen = document.getElementById('loading-screen');
  const activeScreen = document.getElementById('active-screen');
  const stoppedScreen = document.getElementById('stopped-screen');
  const mainTitle = document.getElementById('main-title');
  const mainText = document.getElementById('main-text');
  const retryBtn = document.getElementById('retry-btn');
  const stopBtn = document.getElementById('stop-btn');
  const errorBox = document.getElementById('error-box');
  const elapsedEl = document.getElementById('elapsed');
  const pointsNoteEl = document.getElementById('points-note');

  let watchId = null;
  let startedAt = null;
  let timerInterval = null;
  let pointCount = 0;
  let lastSentAt = 0;
  let hasStartedOnServer = false;
  const MIN_SEND_INTERVAL_MS = 3000;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
    retryBtn.hidden = false;
  }

  function pad(n) { return n.toString().padStart(2, '0'); }

  function tick() {
    if (!startedAt) return;
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    elapsedEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  async function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      keepalive: true,
    });
  }

  function showActiveScreen() {
    loadingScreen.hidden = true;
    stoppedScreen.hidden = true;
    activeScreen.hidden = false;
    if (!startedAt) {
      startedAt = Date.now();
      timerInterval = setInterval(tick, 1000);
      tick();
    }
  }

  async function markStarted() {
    if (hasStartedOnServer) return;
    hasStartedOnServer = true;
    await postJSON(`/api/share/${sessionId}/start`).catch(() => {});
  }

  async function handlePosition(pos) {
    const { latitude, longitude, accuracy, altitude, heading, speed } = pos.coords;
    showActiveScreen();
    await markStarted();

    const now = Date.now();
    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;
    lastSentAt = now;

    const point = {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy ?? null,
      altitude: altitude ?? null,
      heading: heading ?? null,
      speed: speed ?? null,
    };

    pointCount += 1;
    pointsNoteEl.textContent = pointCount === 1 ? 'Live location connected.' : 'Live location is updating.';
    postJSON(`/api/share/${sessionId}/location`, point).catch(() => {});
  }

  function handlePositionError(err) {
    let msg = 'Could not access location. Please allow location permission for this site.';
    if (err.code === err.PERMISSION_DENIED) {
      msg = 'Location permission was denied. Enable location permission for this site, then tap the button below.';
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      msg = 'Location is unavailable. Turn on GPS/location services and try again.';
    } else if (err.code === err.TIMEOUT) {
      msg = 'Location request timed out. Keep GPS on and try again.';
    }
    showError(msg);
  }

  async function loadSession() {
    try {
      const res = await fetch(`/api/share/${sessionId}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      mainTitle.textContent = 'Sharing live location…';
      mainText.textContent = `${data.label} requested live location. Please allow permission when asked.`;
      startSharing();
    } catch (err) {
      mainTitle.textContent = 'This link is no longer valid';
      mainText.textContent = 'Ask the admin to create a new sharing link.';
      retryBtn.hidden = true;
    }
  }

  function startSharing() {
    errorBox.style.display = 'none';
    retryBtn.hidden = true;
    if (!navigator.geolocation) {
      showError('This browser does not support location sharing.');
      return;
    }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
  }

  function stopSharing() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timerInterval) clearInterval(timerInterval);
    navigator.sendBeacon(`/api/share/${sessionId}/stop`);
    activeScreen.hidden = true;
    loadingScreen.hidden = true;
    stoppedScreen.hidden = false;
  }

  window.addEventListener('pagehide', () => {
    if (watchId !== null) navigator.sendBeacon(`/api/share/${sessionId}/stop`);
  });

  retryBtn.addEventListener('click', startSharing);
  stopBtn.addEventListener('click', stopSharing);
  loadSession();
})();
