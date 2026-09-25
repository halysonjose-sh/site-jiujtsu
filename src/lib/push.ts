import { rpc, supabase } from './api'

export const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}
export async function enablePush() {
  if (!pushSupported())
    throw new Error(
      'Este navegador não recebe notificações. No iPhone, instale o app na tela inicial primeiro.',
    )
  if (!vapidPublicKey) throw new Error('As notificações ainda não foram configuradas no servidor.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error('Permissão negada. Libere as notificações nas configurações do navegador.')
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }))
  const json = sub.toJSON()
  await rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  })
}
export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}
/** Avisa os professores; falha silenciosamente (o check-in já foi salvo). */
export function notifyCheckin(session: string) {
  if (!supabase) return
  void supabase.functions.invoke('notify-checkin', { body: { session } }).catch(() => {})
}
