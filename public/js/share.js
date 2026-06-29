(function () {
  const sessionId = window.location.pathname.split('/').pop();

  const loadingScreen = document.getElementById('loading-screen');
  const activeScreen  = document.getElementById('active-screen');
  const errorScreen   = document.getElementById('error-screen');
  const stoppedScreen = document.getElementById('stopped-screen');
  const stopBtn       = document.getElementById('stop-btn');
  const elapsedEl     = document.getElementById('elapsed');
  const errorTitle    = document.getElementById('error-title');
  const errorMsg      = document.getElementById('error-msg');

  let watchId    = null;
  let startedAt  = null;
  let timerInt   = null;
  let lastSentAt = 0;
  let sharing    = false;

  const MIN_INTERVAL_MS = 4000; // send at most every 4s

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    elapsedEl.textContent = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs % 3600 / 60))}:${pad(secs % 60)}`;
  }

  function showError(title, msg) {
    loadingScreen.hidden = true;
    activeScreen.hidden  = true;
    errorTitle.textContent = title;
    errorMsg.textContent   = msg;
    errorScreen.hidden = false;
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).catch(() => {});
  }

  function handlePosition(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;

    // First position received — transition to active screen
    if (!sharing) {
      sharing = true;
      loadingScreen.hidden = true;
      activeScreen.hidden  = false;
      startedAt = Date.now();
      timerInt  = setInterval(tick, 1000);
      postJSON(`/api/share/${sessionId}/start`);
    }

    // Throttle sends
    const now = Date.now();
    if (now - lastSentAt < MIN_INTERVAL_MS) return;
    lastSentAt = now;
    postJSON(`/api/share/${sessionId}/location`, { lat, lng, accuracy });
  }

  function handlePositionError(err) {
    if (sharing) return; // already active — ignore transient errors silently
    if (err.code === err.PERMISSION_DENIED) {
      showError(
        'Location access denied',
        'You denied location access. To share your location, allow it in your browser settings and reload the page.'
      );
    } else if (err.code === err.TIMEOUT) {
      showError('Location timeout', 'Could not get your location. Check your connection and reload.');
    } else {
      showError('Location unavailable', 'Your device could not provide a location. Try again from a different device or browser.');
    }
  }

  function stopSharing() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    sharing = false;
    navigator.sendBeacon(`/api/share/${sessionId}/stop`);
    activeScreen.hidden  = true;
    stoppedScreen.hidden = false;
  }

  // Beacon a stop if the user navigates away while sharing
  window.addEventListener('pagehide', () => {
    if (sharing && watchId !== null) {
      navigator.sendBeacon(`/api/share/${sessionId}/stop`);
    }
  });

  stopBtn.addEventListener('click', stopSharing);

  // ---- Boot: validate link, then immediately request location ----
  async function init() {
    if (!navigator.geolocation) {
      showError('Not supported', 'Your browser does not support location sharing.');
      return;
    }

    // Validate link is still valid before asking for permission
    try {
      const res = await fetch(`/api/share/${sessionId}`);
      if (!res.ok) throw new Error('invalid');
    } catch {
      showError('Link not found', 'This sharing link is no longer valid. Ask for a new one.');
      return;
    }

    // Request location — browser's native permission dialog fires here
    watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 20000,
    });
  }

  init();
})();
