/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
  createHandlerBoundToURL,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()
// Only app-shell navigation and versioned build assets are cached. No API routes.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
// Notificações de check-in para professores. Nenhum dado é guardado em cache.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string } = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Tatame', {
      body: data.body ?? 'Há novidades na sua equipe.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
      tag: 'checkin',
    }),
  )
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data?.url as string) ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c) as WindowClient | undefined
      if (open) {
        void open.navigate(url)
        return open.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
