/* Service worker: push notifications + notification click handling. No offline caching
   (the app is useless without the server anyway, and caching would hide auth errors). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Message', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // If the user is actively looking at the app, the page handles it in-app; don't double up.
      if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
      if (typeof data.unread === 'number' && 'setAppBadge' in self.navigator) {
        try {
          data.unread > 0 ? await self.navigator.setAppBadge(data.unread) : await self.navigator.clearAppBadge();
        } catch {}
      }
      await self.registration.showNotification(data.title || 'Message', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag || 'message',
        renotify: true,
        data: { chatId: data.chatId },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data && event.notification.data.chatId;
  const url = chatId ? `/#chat=${chatId}` : '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus();
          if (chatId) w.postMessage({ type: 'open-chat', chatId });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
