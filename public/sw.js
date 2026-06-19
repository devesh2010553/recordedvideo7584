// sw.js
// This runs in the background, independent of any open tab, which is what
// lets a push notification reach the admin even after they've closed the
// app/browser tab (as long as the browser process can be woken by the OS
// push service -- the normal behavior for Web Push on Chrome/Firefox/Edge,
// and on Android. iOS Safari requires the site to be "Added to Home Screen"
// for background push to work, per Apple's platform rules).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Pulse', body: 'Location update', sessionId: null };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    // fall back to defaults if payload isn't JSON
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { sessionId: data.sessionId },
    tag: data.sessionId ? `session-${data.sessionId}` : undefined,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data && event.notification.data.sessionId;
  const targetUrl = sessionId ? `/admin?session=${sessionId}` : '/admin';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
