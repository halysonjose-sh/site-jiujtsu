import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, afterAll, it, expect } from 'vitest'
import postgres from 'postgres'
const url = process.env.LOCAL_SUPABASE_URL ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url))
  throw new Error('Use npm run test:supabase com uma instância local descartável.')
const key = process.env.LOCAL_SUPABASE_ANON_KEY!,
  service = process.env.LOCAL_SUPABASE_SERVICE_KEY!
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, service, options),
  teacher = createClient(url, key, options),
  aluno = createClient(url, key, options)
const sql = postgres(process.env.LOCAL_DB_URL!, { max: 1 })
const code = 'TESTE-' + crypto.randomUUID(),
  ids: string[] = [],
  password = 'Teste-local-' + crypto.randomUUID()
let studentId: string, teacherId: string
let previousSettings: any,
  previousTeachers: any[] = []
async function call(client: SupabaseClient, name: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data
}
beforeAll(async () => {
  previousSettings = (await sql`select * from public.class_settings`)[0]
  previousTeachers = await sql`select id from public.profiles where role='professor'`
  await sql`update public.class_settings set code_hash=encode(sha256(convert_to(code_salt || ${code},'UTF8')),'hex')`
  for (const client of [teacher, aluno]) {
    const email = crypto.randomUUID() + '@tatame.test'
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: 'Teste integração', class_code: code, role: 'professor' },
    })
    if (error) throw error
    ids.push(data.user.id)
    const login = await client.auth.signInWithPassword({ email, password })
    if (login.error) throw login.error
  }
  ;[teacherId, studentId] = ids
  await sql`update public.profiles set role='aluno' where role='professor'`
  await sql`update public.profiles set role='professor' where id=${teacherId}`
})
afterAll(async () => {
  try {
    for (const id of ids) {
      await sql`delete from public.attendances where student_id=${id}`
      await sql`delete from public.graduations where student_id=${id}`
    }
    for (const id of ids) await admin.auth.admin.deleteUser(id)
    if (previousSettings)
      await sql`update public.class_settings set goal=${previousSettings.goal},code_hash=${previousSettings.code_hash},code_salt=${previousSettings.code_salt}`
    for (const p of previousTeachers)
      await sql`update public.profiles set role='professor' where id=${p.id}`
  } finally {
    await sql.end()
  }
})
it('signup inválido falha e signup público nunca cria professor', async () => {
  const { error } = await aluno.auth.signUp({
    email: crypto.randomUUID() + '@tatame.test',
    password,
    options: { data: { name: 'Aluno inválido', class_code: 'INCORRETO' } },
  })
  expect(error).not.toBeNull()
  const { data } = await aluno.from('profiles').select('role')
  expect(data).toEqual([{ role: 'aluno' }])
})
it('requisições HTTP paralelas não duplicam presença ou grau', async () => {
  await Promise.all(Array.from({ length: 8 }, () => call(aluno, 'mark_attendance')))
  const s = await call(aluno, 'student_detail', { p_student: studentId })
  expect(s.total).toBe(1)
  const args = { p_student: studentId, p_kind: 'grau', p_key: crypto.randomUUID(), p_revision: 0 }
  await Promise.all([
    call(teacher, 'graduate_student', args),
    call(teacher, 'graduate_student', args),
  ])
  const next = await call(aluno, 'student_detail', { p_student: studentId })
  expect(next.degrees).toBe(1)
  expect(next.cycle).toBe(0)
})
it('RPC e acesso direto mantêm as permissões', async () => {
  await expect(
    call(aluno, 'graduate_student', {
      p_student: studentId,
      p_kind: 'grau',
      p_key: crypto.randomUUID(),
      p_revision: 1,
    }),
  ).rejects.toBeTruthy()
  const { error } = await aluno.from('profiles').update({ role: 'professor' }).eq('id', studentId)
  expect(error).not.toBeNull()
  const { data } = await aluno.from('profiles').select('id').eq('id', teacherId)
  expect(data).toEqual([])
})
