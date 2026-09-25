// Avisa os professores da equipe quando um aluno faz check-in.
// Chamada pelo app logo após o check-in; confere no banco que o check-in existe e é recente.
// Segredos necessários: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:voce@dominio.com).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false },
    },
  )
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) return json({ error: 'Não autenticado.' }, 401)
  const { session } = await req.json().catch(() => ({ session: null }))
  if (typeof session !== 'string') return json({ error: 'Aula inválida.' }, 400)

  // Só notifica check-in real, pendente e feito há pouco pelo próprio usuário.
  const { data: att } = await admin
    .from('attendances')
    .select(
      'team_id, created_at, class_sessions(title, starts_at), profiles!attendances_student_id_fkey(name)',
    )
    .eq('session_id', session)
    .eq('student_id', userData.user.id)
    .eq('status', 'pendente')
    .eq('source', 'checkin')
    .maybeSingle()
  if (!att || Date.now() - new Date(att.created_at).getTime() > 10 * 60_000)
    return json({ sent: 0 })

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('team_id', att.team_id)
  if (!subs?.length) return json({ sent: 0 })

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  // deno-lint-ignore no-explicit-any
  const s = att.class_sessions as any,
    p = att.profiles as any
  const hora = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(s.starts_at))
  const payload = JSON.stringify({
    title: 'Novo check-in',
    body: `${p?.name ?? 'Um aluno'} vai treinar: ${s.title} · ${hora}`,
    url: '/?pagina=agenda',
  })
  let sent = 0
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600 },
        )
        sent++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410)
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }),
  )
  return json({ sent })
})
