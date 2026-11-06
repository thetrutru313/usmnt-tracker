/* Web Push handlers, loaded into the generated service worker via
   workbox.importScripts (see vite.config.ts). Every push must show a
   notification — iOS doesn't allow silent pushes. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "USMNT Tracker";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(path.replace(/^\//, ""), self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          try {
            if ("navigate" in client) await client.navigate(target);
          } catch {
            // Some browsers refuse navigate() here; focusing is still useful.
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
