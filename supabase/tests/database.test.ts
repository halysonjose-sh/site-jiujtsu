import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
let db: PGlite
const teacher = '00000000-0000-4000-8000-000000000001',
  a = '00000000-0000-4000-8000-000000000002',
  b = '00000000-0000-4000-8000-000000000003'
async function asUser<T = Record<string, unknown>>(
  id: string | null,
  sql: string,
  params: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}`)
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ''])
    return tx.query<T>(sql, params)
  })
}
async function signup(id: string, code: string, role = 'aluno') {
  return db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3::jsonb)', [
    id,
    id + '@test.local',
    JSON.stringify({ name: 'Aluno teste', class_code: code, role }),
  ])
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(
    `create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`,
  )
  await db.exec(readFileSync('supabase/migrations/202609050001_tatame.sql', 'utf8'))
  await db.exec(
    "update public.class_settings set code_hash=encode(sha256(convert_to(code_salt || 'TURMA-TESTE','UTF8')),'hex')",
  )
  await signup(teacher, 'TURMA-TESTE')
  await db.query("update public.profiles set role='professor' where id=$1", [teacher])
  await signup(a, 'TURMA-TESTE', 'professor')
  await signup(b, 'TURMA-TESTE')
})
afterAll(async () => {
  await db?.close()
})
describe('banco real PostgreSQL: cadastro e RLS', () => {
  it('rejeita código inválido sem deixar perfil', async () => {
    await expect(signup('00000000-0000-4000-8000-000000000009', 'ERRADO')).rejects.toThrow(/Código/)
    expect(
      (await db.query("select * from profiles where id='00000000-0000-4000-8000-000000000009'"))
        .rows,
    ).toHaveLength(0)
  })
  it('ignora papel enviado pelo cadastro', async () => {
    expect((await asUser(a, 'select role from public.profiles')).rows).toEqual([{ role: 'aluno' }])
  })
  it('aluno só lê a si; professor lê a turma; visitante não lê', async () => {
    expect((await asUser(a, 'select * from public.profiles')).rows).toHaveLength(1)
    expect((await asUser(teacher, 'select * from public.profiles')).rows).toHaveLength(3)
    await expect(asUser(null, 'select * from public.profiles')).rejects.toThrow()
  })
  it('bloqueia alteração direta de papel e graduação', async () => {
    await expect(asUser(a, "update public.profiles set role='professor'")).rejects.toThrow()
    await expect(
      asUser(
        a,
        "insert into public.graduations(student_id,kind,belt,degrees,actor_id) values ($1,'grau','azul',1,$1)",
        [a],
      ),
    ).rejects.toThrow()
  })
  it('não expõe hash do código', async () => {
    await expect(asUser(a, 'select code_hash from public.class_settings')).rejects.toThrow()
    await expect(asUser(teacher, 'select code_hash from public.class_settings')).rejects.toThrow()
  })
  it('remove código e papel dos metadados e protege auxiliares internas', async () => {
    const metadata = (
      await db.query<{ raw_user_meta_data: Record<string, string> }>(
        'select raw_user_meta_data from auth.users where id=$1',
        [a],
      )
    ).rows[0].raw_user_meta_data
    expect(metadata.class_code).toBeUndefined()
    expect(metadata.role).toBeUndefined()
    await expect(
      asUser(a, 'select public.handle_signup_internal(gen_random_uuid(),$1::jsonb)', [
        JSON.stringify({ name: 'Invasor', class_code: 'TURMA-TESTE' }),
      ]),
    ).rejects.toThrow()
  })
})
describe('operações protegidas', () => {
  it('presenças concorrentes e reenvio resultam em uma aula', async () => {
    await Promise.all([
      asUser(a, 'select public.mark_attendance()'),
      asUser(a, 'select public.mark_attendance()'),
    ])
    expect((await asUser(a, 'select * from public.attendances')).rows).toHaveLength(1)
    await asUser(b, 'select public.mark_attendance()')
    expect((await asUser(b, 'select * from public.attendances')).rows).toHaveLength(1)
  })
  it('aluno não corrige, não concede grau e não acessa resumo alheio', async () => {
    await expect(
      asUser(a, "select public.correct_attendance($1,current_date,'add')", [b]),
    ).rejects.toThrow()
    await expect(
      asUser(a, "select public.graduate_student($1,'grau',gen_random_uuid(),0)", [a]),
    ).rejects.toThrow()
    await expect(asUser(a, 'select public.student_detail($1)', [b])).rejects.toThrow()
  })
  it('professor corrige passado e bloqueia futuro', async () => {
    await asUser(teacher, "select public.correct_attendance($1,public.today_sp()-2,'add')", [a])
    expect((await asUser(a, 'select * from public.attendances')).rows).toHaveLength(2)
    await asUser(teacher, "select public.correct_attendance($1,public.today_sp()-2,'remove')", [a])
    expect((await asUser(a, 'select * from public.attendances')).rows).toHaveLength(1)
    await expect(
      asUser(teacher, "select public.correct_attendance($1,public.today_sp()+1,'add')", [a]),
    ).rejects.toThrow()
  })
  it('define situação inicial uma vez; rejeita graus inválidos', async () => {
    await expect(
      asUser(teacher, "select public.set_initial($1,'branca',5,0)", [b]),
    ).rejects.toThrow()
    await asUser(teacher, "select public.set_initial($1,'azul',2,0)", [a])
    await expect(asUser(teacher, "select public.set_initial($1,'roxa',0,1)", [a])).rejects.toThrow()
  })
  it('concede uma vez, detecta versão desatualizada e desfaz sem apagar presença', async () => {
    const key = '11111111-1111-4111-8111-111111111111'
    await asUser(teacher, "select public.graduate_student($1,'grau',$2,1)", [a, key])
    await asUser(teacher, "select public.graduate_student($1,'grau',$2,1)", [a, key])
    await expect(
      asUser(teacher, "select public.graduate_student($1,'grau',gen_random_uuid(),1)", [a]),
    ).rejects.toThrow(/atualiz/)
    let result = (await asUser<{ student_detail: any }>(a, 'select public.student_detail($1)', [a]))
      .rows[0].student_detail
    expect(result.belt).toBe('azul')
    expect(result.degrees).toBe(3)
    expect(result.total).toBe(1)
    expect(result.cycle).toBe(0)
    await asUser(teacher, 'select public.undo_graduation($1,$2,2)', [a, key])
    result = (await asUser<{ student_detail: any }>(a, 'select public.student_detail($1)', [a]))
      .rows[0].student_detail
    expect(result.degrees).toBe(2)
    expect(result.total).toBe(1)
    expect(result.cycle).toBe(1)
  })
  it('meta opcional, inteira e positiva; código rotacionado', async () => {
    await expect(asUser(teacher, 'select public.update_settings(0,null)')).rejects.toThrow()
    await asUser(teacher, "select public.update_settings(30,'NOVO-CODIGO')")
    await expect(signup('00000000-0000-4000-8000-000000000008', 'TURMA-TESTE')).rejects.toThrow()
    await signup('00000000-0000-4000-8000-000000000008', 'NOVO-CODIGO')
    expect((await asUser(a, 'select public.get_settings() as settings')).rows[0]).toEqual({
      settings: { goal: 30 },
    })
  })
  it('bloqueia revisão ausente e graduação fora do limite; promove sem exigir quatro graus', async () => {
    await expect(
      asUser(teacher, "select public.graduate_student($1,'grau',gen_random_uuid(),null)", [b]),
    ).rejects.toThrow()
    await asUser(teacher, "select public.set_initial($1,'marrom',4,0)", [b])
    await expect(
      asUser(teacher, "select public.graduate_student($1,'grau',gen_random_uuid(),1)", [b]),
    ).rejects.toThrow()
    await asUser(teacher, "select public.graduate_student($1,'faixa',gen_random_uuid(),1)", [b])
    await expect(
      asUser(teacher, "select public.graduate_student($1,'grau',gen_random_uuid(),2)", [b]),
    ).rejects.toThrow()
    await expect(
      asUser(teacher, "select public.graduate_student($1,'faixa',gen_random_uuid(),2)", [b]),
    ).rejects.toThrow()
  })
  it('dia do servidor ignora timezone da sessão e contas não vinculadas não têm acesso', async () => {
    const r = await db.transaction(async (tx) => {
      await tx.exec("set local timezone='Pacific/Auckland'")
      return tx.query<{ ok: boolean }>(
        "select public.today_sp() = (now() at time zone 'America/Sao_Paulo')::date as ok",
      )
    })
    expect(r.rows[0].ok).toBe(true)
    await expect(
      asUser('00000000-0000-4000-8000-000000000099', 'select public.mark_attendance()'),
    ).rejects.toThrow()
  })
})
