(function () {
  const listView = document.getElementById('list-view');
  const detailView = document.getElementById('detail-view');
  const sessionListEl = document.getElementById('session-list');
  const labelInput = document.getElementById('label-input');
  const createBtn = document.getElementById('create-btn');
  const newLinkBox = document.getElementById('new-link-box');
  const newLinkText = document.getElementById('new-link-text');
  const copyBtn = document.getElementById('copy-btn');
  const notifBtn = document.getElementById('notif-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const backBtn = document.getElementById('back-btn');
  const deleteBtn = document.getElementById('delete-btn');
  const connDot = document.getElementById('conn-dot');

  const detailLabel = document.getElementById('detail-label');
  const detailStatus = document.getElementById('detail-status');
  const detailStats = document.getElementById('detail-stats');

  let currentSessionId = null;
  let map, marker, pathLine, pathPoints = [];
  let ws = null;
  let listPollInterval = null;

  // ---------- helpers ----------

  function timeAgo(iso) {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (res.status === 401) {
      window.location.href = '/admin-login.html';
      throw new Error('unauthenticated');
    }
    return res;
  }

  // ---------- list view ----------

  async function loadSessions() {
    const res = await api('/api/admin/sessions');
    const sessions = await res.json();
    if (sessions.length === 0) {
      sessionListEl.innerHTML = '<p class="empty-note">No links yet — create one above.</p>';
      return;
    }
    sessionListEl.innerHTML = '';
    sessions.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'session-card';
      row.innerHTML = `
        <div>
          <div class="session-label"><span class="status-dot ${s.active ? 'live' : ''}"></span>${escapeHtml(s.label)}</div>
          <div class="session-meta">${s.active ? 'Sharing now' : (s.lastSeenAt ? `Last seen ${timeAgo(s.lastSeenAt)}` : 'Not started yet')} · ${s.locations.length} points</div>
        </div>
        <button class="btn-ghost">View</button>
      `;
      row.addEventListener('click', () => openDetail(s.id));
      sessionListEl.appendChild(row);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  createBtn.addEventListener('click', async () => {
    const label = labelInput.value.trim();
    if (!label) return;
    createBtn.disabled = true;
    const res = await api('/api/admin/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    const session = await res.json();
    createBtn.disabled = false;
    labelInput.value = '';
    const url = `${window.location.origin}/share/${session.id}`;
    newLinkText.textContent = url;
    newLinkBox.style.display = 'flex';
    loadSessions();
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(newLinkText.textContent);
    copyBtn.textContent = 'Copied';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  });

  // ---------- detail view ----------

  async function openDetail(sessionId) {
    currentSessionId = sessionId;
    listView.style.display = 'none';
    detailView.style.display = 'block';
    if (listPollInterval) clearInterval(listPollInterval);

    const res = await api(`/api/admin/sessions/${sessionId}`);
    const session = await res.json();
    renderDetail(session);
    connectWebSocket();
  }

  function renderDetail(session) {
    detailLabel.textContent = session.label;
    detailStatus.querySelector('span:last-child').textContent = session.active ? 'Live' : 'Not sharing';
    detailStatus.querySelector('.status-dot').className = `status-dot ${session.active ? 'live' : ''}`;

    detailStats.innerHTML = `
      <span>started: ${session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}</span>
      <span>points: ${session.locations.length}</span>
      <span>last seen: ${session.lastSeenAt ? timeAgo(session.lastSeenAt) : '—'}</span>
    `;

    pathPoints = session.locations.map((p) => [p.lat, p.lng]);
    initOrUpdateMap();
  }

  function initOrUpdateMap() {
    const mapEl = document.getElementById('map');
    if (!map) {
      map = L.map(mapEl, { zoomControl: true, attributionControl: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      pathLine = L.polyline([], { color: '#16A394', weight: 3, opacity: 0.6 }).addTo(map);
      marker = L.circleMarker([0, 0], { radius: 7, color: '#16A394', fillColor: '#16A394', fillOpacity: 1 }).addTo(map);
    }
    if (pathPoints.length > 0) {
      pathLine.setLatLngs(pathPoints);
      const last = pathPoints[pathPoints.length - 1];
      marker.setLatLng(last);
      map.fitBounds(pathLine.getBounds(), { maxZoom: 16, padding: [20, 20] });
    } else {
      map.setView([20, 0], 2);
    }
  }

  backBtn.addEventListener('click', () => {
    detailView.style.display = 'none';
    listView.style.display = 'block';
    currentSessionId = null;
    if (ws) { ws.close(); ws = null; }
    loadSessions();
    startListPolling();
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentSessionId) return;
    if (!confirm('Delete this link and its full location history? This cannot be undone.')) return;
    await api(`/api/admin/sessions/${currentSessionId}`, { method: 'DELETE' });
    backBtn.click();
  });

  // ---------- live updates over websocket ----------

  function connectWebSocket() {
    if (ws) ws.close();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${window.location.host}/ws/admin`);
    ws.onopen = () => (connDot.className = 'status-dot live');
    ws.onclose = () => (connDot.className = 'status-dot');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!currentSessionId) return;
      if (msg.type === 'location' && msg.sessionId === currentSessionId) {
        pathPoints.push([msg.point.lat, msg.point.lng]);
        initOrUpdateMap();
        detailStats.innerHTML = detailStats.innerHTML.replace(/points: \d+/, `points: ${pathPoints.length}`);
      } else if ((msg.type === 'started' || msg.type === 'stopped') && msg.session.id === currentSessionId) {
        renderDetail(msg.session);
      }
    };
  }

  // ---------- push notifications ----------

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function refreshNotifButton() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      notifBtn.textContent = 'Alerts unsupported';
      notifBtn.disabled = true;
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    notifBtn.textContent = sub ? 'Alerts on ✓' : 'Enable alerts';
  }

  notifBtn.addEventListener('click', async () => {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
      await api('/api/admin/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: existing.endpoint }),
      });
      refreshNotifButton();
      return;
    }
    const keyRes = await fetch('/api/admin/vapid-public-key');
    const { publicKey } = await keyRes.json();
    if (!publicKey) {
      alert('Push notifications are not configured on this server yet.');
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api('/api/admin/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    refreshNotifButton();
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin-login.html';
  });

  function startListPolling() {
    listPollInterval = setInterval(() => {
      if (!currentSessionId) loadSessions();
    }, 10000);
  }

  // ---------- boot ----------

  (async function init() {
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js');
      refreshNotifButton();
    }
    await loadSessions();
    startListPolling();

    const params = new URLSearchParams(window.location.search);
    const fromNotif = params.get('session');
    if (fromNotif) openDetail(fromNotif);
  })();
})();
