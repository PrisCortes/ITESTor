// No se guardan archivos de la aplicación. Así una recarga normal siempre
// consulta el servidor y evita que una versión antigua bloquee el frontend.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'ITEStore', { body:data.body || 'Tienes una actualización.', data:{ url:data.url || '/index.html#home' }, icon:'/assets/icons/itestore-icon.png', badge:'/assets/icons/itestore-icon.png' }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(openClients => {
    const existing = openClients.find(client => client.url.includes(event.notification.data.url));
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});
