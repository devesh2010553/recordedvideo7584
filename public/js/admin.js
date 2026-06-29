(function () {
  const listView   = document.getElementById('list-view');
  const detailView = document.getElementById('detail-view');
  const sessionListEl = document.getElementById('session-list');
  const labelInput    = document.getElementById('label-input');
  const createBtn     = document.getElementById('create-btn');
  const newLinkBox    = document.getElementById('new-link-box');
  const newLinkText   = document.getElementById('new-link-text');
  const copyBtn       = document.getElementById('copy-btn');
  const notifBtn      = document.getElementById('notif-btn');
  const logoutBtn     = document.getElementById('logout-btn');
  const backBtn       = document.getElementById('back-btn');
  const deleteBtn     = document.getElementById('delete-btn');
  const connDot       = document.getElementById('conn-dot');

  const detailLabel  = document.getElementById('detail-label');
  const detailStatus = document.getElementById('detail-status');
  const detailStats  = document.getElementById('detail-stats');
  const historyList  = document.getElementById('history-list');

  let currentSessionId = null;
  let map, liveMarker, pathLine, pathPoints = [];
  let ws = null;
  let listPollInterval = null;

  // ---- helpers ----

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

  function fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (res.status === 401) { window.location.href = '/admin-login.html'; throw new Error('unauth'); }
    return res;
  }

  // ---- list view ----

  async function loadSessions() {
    const res = await api('/api/admin/sessions');
    const sessions = await res.json();
    sessionListEl.innerHTML = '';
    if (sessions.length === 0) {
      sessionListEl.innerHTML = '<p class="empty-note">No links yet — create one above.</p>';
      return;
    }
    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = 'session-card';
      row.innerHTML = `
        <div>
          <div class="session-label">
            <span class="status-dot ${s.active ? 'live' : ''}"></span>${esc(s.label)}
          </div>
          <div class="session-meta">
            ${s.active ? '● Sharing now' : (s.lastSeenAt ? `Last seen ${timeAgo(s.lastSeenAt)}` : 'Not started yet')}
            &nbsp;·&nbsp; ${s.locationCount || 0} points
          </div>
        </div>
        <button class="btn-ghost">View</button>
      `;
      row.addEventListener('click', () => openDetail(s.id));
      sessionListEl.appendChild(row);
    });
  }

  createBtn.addEventListener('click', async () => {
    const label = labelInput.value.trim();
    if (!label) { labelInput.focus(); return; }
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

  labelInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(newLinkText.textContent);
    copyBtn.textContent = 'Copied ✓';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1600);
  });

  // ---- detail view ----

  async function openDetail(id) {
    currentSessionId = id;
    clearInterval(listPollInterval);
    listView.style.display = 'none';
    detailView.style.display = 'block';

    historyList.innerHTML = '<p class="empty-note" style="padding:.5rem 0">Loading…</p>';

    const res = await api(`/api/admin/sessions/${id}`);
    const session = await res.json();
    renderDetail(session);
    connectWebSocket();
  }

  function renderDetail(session) {
    detailLabel.textContent = session.label;

    const dot  = detailStatus.querySelector('.status-dot');
    const text = detailStatus.querySelector('span:last-child');
    dot.className  = `status-dot ${session.active ? 'live' : ''}`;
    text.textContent = session.active ? 'Live now' : 'Not sharing';

    const locs = session.locations || [];
    detailStats.innerHTML = `
      <span>Created: ${fmt(session.createdAt)}</span>
      <span>Started: ${fmt(session.startedAt)}</span>
      <span>Last seen: ${session.lastSeenAt ? timeAgo(session.lastSeenAt) : '—'}</span>
      <span>Points: ${locs.length}</span>
    `;

    renderHistory(locs);

    pathPoints = locs.map(p => [p.lat, p.lng]);
    initOrUpdateMap();
  }

  function renderHistory(locs) {
    if (locs.length === 0) {
      historyList.innerHTML = '<p class="empty-note" style="padding:.5rem 0">No location points recorded yet.</p>';
      return;
    }
    // Show latest first, max 200 rows to avoid overwhelming the DOM
    const rows = [...locs].reverse().slice(0, 200);
    historyList.innerHTML = rows.map(p => `
      <div class="history-row">
        <span class="history-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
        <span class="history-acc">${p.accuracy ? `±${Math.round(p.accuracy)}m` : ''}</span>
        <span class="history-time">${fmt(p.timestamp)}</span>
      </div>
    `).join('');
    if (locs.length > 200) {
      historyList.innerHTML += `<p class="empty-note" style="padding:.5rem 0;text-align:center;">… and ${locs.length - 200} earlier points</p>`;
    }
  }

  function initOrUpdateMap() {
    const mapEl = document.getElementById('map');
    if (!map) {
      map = L.map(mapEl, { zoomControl: true, attributionControl: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      pathLine   = L.polyline([], { color: '#16A394', weight: 3.5, opacity: 0.7 }).addTo(map);
      liveMarker = L.circleMarker([0, 0], {
        radius: 8, color: '#fff', weight: 2.5,
        fillColor: '#16A394', fillOpacity: 1
      }).addTo(map);
    }
    if (pathPoints.length > 0) {
      pathLine.setLatLngs(pathPoints);
      const last = pathPoints[pathPoints.length - 1];
      liveMarker.setLatLng(last);
      map.fitBounds(pathLine.getBounds(), { maxZoom: 16, padding: [24, 24] });
    } else {
      map.setView([20, 0], 2);
    }
  }

  backBtn.addEventListener('click', () => {
    detailView.style.display = 'none';
    listView.style.display   = 'block';
    currentSessionId = null;
    if (ws) { ws.close(); ws = null; }
    if (map) { map.remove(); map = null; liveMarker = null; pathLine = null; pathPoints = []; }
    loadSessions();
    startListPolling();
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentSessionId) return;
    if (!confirm('Delete this link and all location history? This cannot be undone.')) return;
    await api(`/api/admin/sessions/${currentSessionId}`, { method: 'DELETE' });
    backBtn.click();
  });

  // ---- WebSocket live updates ----

  function connectWebSocket() {
    if (ws) ws.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws/admin`);
    ws.onopen  = () => { connDot.className = 'status-dot live'; };
    ws.onclose = () => { connDot.className = 'status-dot'; };
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (!currentSessionId) return;

      if (msg.type === 'location' && msg.sessionId === currentSessionId) {
        pathPoints.push([msg.point.lat, msg.point.lng]);
        initOrUpdateMap();
        // Append to history list (prepend = latest first)
        const row = document.createElement('div');
        row.className = 'history-row new-point';
        row.innerHTML = `
          <span class="history-coords">${msg.point.lat.toFixed(5)}, ${msg.point.lng.toFixed(5)}</span>
          <span class="history-acc">${msg.point.accuracy ? `±${Math.round(msg.point.accuracy)}m` : ''}</span>
          <span class="history-time">${fmt(msg.point.timestamp)}</span>
        `;
        const empty = historyList.querySelector('.empty-note');
        if (empty) empty.remove();
        historyList.insertBefore(row, historyList.firstChild);
        setTimeout(() => row.classList.remove('new-point'), 600);
        // Update point count in stats
        detailStats.innerHTML = detailStats.innerHTML.replace(/Points: \d+/, `Points: ${pathPoints.length}`);
      } else if ((msg.type === 'started' || msg.type === 'stopped') && msg.session?.id === currentSessionId) {
        const dot  = detailStatus.querySelector('.status-dot');
        const text = detailStatus.querySelector('span:last-child');
        dot.className  = `status-dot ${msg.session.active ? 'live' : ''}`;
        text.textContent = msg.session.active ? 'Live now' : 'Not sharing';
      }
    };
  }

  // ---- Push notifications ----

  function urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64  = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from([...atob(base64)].map(c => c.charCodeAt(0)));
  }

  async function refreshNotifButton() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      notifBtn.textContent = 'Alerts unsupported';
      notifBtn.disabled = true;
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    notifBtn.textContent = sub ? '🔔 Alerts on' : 'Enable alerts';
    notifBtn.style.color = sub ? 'var(--signal)' : '';
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
      return refreshNotifButton();
    }
    const keyRes = await fetch('/api/admin/vapid-public-key');
    const { publicKey } = await keyRes.json();
    if (!publicKey) { alert('Push notifications are not configured on this server. Set VAPID keys in environment variables.'); return; }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { alert('You need to allow notifications to enable alerts.'); return; }

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
    clearInterval(listPollInterval);
    listPollInterval = setInterval(() => { if (!currentSessionId) loadSessions(); }, 12000);
  }

  // ---- boot ----
  (async function init() {
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js');
      refreshNotifButton();
    }
    await loadSessions();
    startListPolling();

    const fromNotif = new URLSearchParams(location.search).get('session');
    if (fromNotif) openDetail(fromNotif);
  })();
})();
