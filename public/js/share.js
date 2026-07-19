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
  const loadingMsg    = document.getElementById('loading-message');

  let watchId    = null;
  let startedAt  = null;
  let timerInt   = null;
  let lastSentAt = 0;
  let sharing    = false;
  let retryTimer = null;

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
    } else {
      // GPS timeouts are often temporary on mobile. Keep the link alive and
      // retry with a network-assisted fix instead of showing an expired/error page.
      loadingMsg.textContent = err.code === err.TIMEOUT
        ? 'GPS is taking longer than expected. Keep this page open; retrying automatically…'
        : 'Location is temporarily unavailable. Turn on GPS and mobile data or Wi-Fi; retrying automatically…';
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (watchId !== null) navigator.geolocation.clearWatch(watchId);
          watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
            enableHighAccuracy: false,
            maximumAge: 10000,
            timeout: 45000,
          });
        }, 3000);
      }
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
    let res;
    try {
      res = await fetch(`/api/share/${sessionId}`);
    } catch {
      showError('Service temporarily unavailable', 'Check your internet connection and reload. The link has not expired.');
      return;
    }
    if (res.status === 404) {
      showError('Link not found', 'This link was deleted or is incorrect. Ask the administrator for another link.');
      return;
    }
    if (!res.ok) {
      showError('Service temporarily unavailable', 'The server could not respond. Reload shortly; the link has not expired.');
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
