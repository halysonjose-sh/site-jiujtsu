import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'

let db: PGlite
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const teacher = id(1),
  a = id(2),
  b = id(3),
  novo = id(4),
  outroProf = id(5),
  outroAluno = id(6)
const migrations = readdirSync('supabase/migrations').sort()

async function asUser<T = Record<string, any>>(
  uid: string | null,
  sql: string,
  params: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`)
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ''])
    return tx.query<T>(sql, params)
  })
}
const one = async (uid: string, sql: string, params: unknown[] = []) =>
  Object.values((await asUser(uid, sql, params)).rows[0] ?? {})[0] as any
async function signup(uid: string, code: string, role = 'aluno') {
  return db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3::jsonb)', [
    uid,
    uid + '@test.local',
    JSON.stringify({ name: 'Pessoa ' + uid.slice(-2), class_code: code, role }),
  ])
}
const setCode = (code: string, where = '') =>
  db.query(
    `update public.teams set code_hash=encode(sha256(convert_to(code_salt || $1,'UTF8')),'hex') ${where}`,
    [code],
  )
/** Cria aula com horário relativo a agora, sem passar pelas regras (preparação de cenário). */
async function sessionAt(offset: string, status = 'prevista', team?: string) {
  const r = await db.query<{ id: string }>(
    `insert into public.class_sessions(team_id,title,starts_at,duration_min,status)
     values (coalesce($2::uuid,(select id from public.teams where slug='minha-turma')),'Aula teste',now()+$1::interval,60,$3) returning id`,
    [offset, team ?? null, status],
  )
  return r.rows[0].id
}
const n = async (sql: string, params: unknown[] = []) =>
  Number(Object.values((await db.query<any>(sql, params)).rows[0])[0])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(
    `create role anon nologin; create role authenticated nologin; create schema auth;
     create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
     create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
     grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`,
  )
  // Estado da v1 com dados antes de migrar.
  await db.exec(readFileSync('supabase/migrations/' + migrations[0], 'utf8'))
  await db.exec(
    "update public.class_settings set code_hash=encode(sha256(convert_to(code_salt || 'TURMA-TESTE','UTF8')),'hex')",
  )
  await signup(teacher, 'TURMA-TESTE')
  await db.query("update public.profiles set role='professor' where id=$1", [teacher])
  await signup(a, 'TURMA-TESTE', 'professor')
  await signup(b, 'TURMA-TESTE')
  await asUser(a, 'select public.mark_attendance()')
  await asUser(teacher, "select public.correct_attendance($1,public.today_sp()-3,'add')", [a])
  await asUser(teacher, "select public.set_initial($1,'azul',2,0)", [a])
  for (const m of migrations.slice(1))
    await db.exec(readFileSync('supabase/migrations/' + m, 'utf8'))
})
afterAll(async () => {
  await db?.close()
})

describe('migração da v1', () => {
  it('turma vira equipe; professor vira dono; alunos ativos', async () => {
    const rows = (
      await db.query('select user_id,role,status from public.team_members order by user_id')
    ).rows
    expect(rows).toEqual([
      { user_id: teacher, role: 'dono', status: 'ativo' },
      { user_id: a, role: 'aluno', status: 'ativo' },
      { user_id: b, role: 'aluno', status: 'ativo' },
    ])
  })
  it('presenças antigas viram aulas realizadas e continuam contando', async () => {
    const d = await one(a, 'select public.student_detail($1)', [a])
    expect(d.total).toBe(2)
    expect(d.belt).toBe('azul')
    expect(d.attendances.map((x: any) => x.status)).toEqual(['confirmada', 'confirmada'])
    expect((await db.query('select distinct status from public.class_sessions')).rows).toEqual([
      { status: 'realizada' },
    ])
  })
  it('API antiga foi removida', async () => {
    await expect(db.query('select * from public.class_settings')).rejects.toThrow()
    await expect(asUser(a, 'select public.mark_attendance()')).rejects.toThrow()
  })
})

describe('cadastro, aprovação e isolamento', () => {
  it('rejeita código inválido sem deixar perfil', async () => {
    await expect(signup(id(9), 'ERRADO-123')).rejects.toThrow(/Código/)
    expect(
      (await db.query('select * from public.profiles where id=$1', [id(9)])).rows,
    ).toHaveLength(0)
  })
  it('novo cadastro entra pendente, nunca professor, e não acessa dados', async () => {
    await signup(novo, 'TURMA-TESTE', 'dono')
    expect(
      (await db.query('select role,status from public.team_members where user_id=$1', [novo])).rows,
    ).toEqual([{ role: 'aluno', status: 'pendente' }])
    const settings = await one(novo, 'select public.get_settings()')
    expect(settings.status).toBe('pendente')
    expect(settings.goal).toBeNull()
    await expect(asUser(novo, 'select public.student_detail($1)', [novo])).rejects.toThrow()
    await expect(
      asUser(novo, 'select public.list_sessions(public.today_sp(),public.today_sp())'),
    ).rejects.toThrow()
  })
  it('professor vê o pendente e aprova; aluno não aprova', async () => {
    const list = await one(teacher, 'select public.list_students()')
    expect(list.find((s: any) => s.id === novo).memberStatus).toBe('pendente')
    await expect(asUser(a, 'select public.approve_member($1,true)', [novo])).rejects.toThrow()
    await asUser(teacher, 'select public.approve_member($1,true)', [novo])
    expect((await one(novo, 'select public.student_detail($1)', [novo])).total).toBe(0)
  })
  it('equipes não se enxergam', async () => {
    await db.query("insert into public.teams(slug,name) values ('outra-equipe','Outra equipe')")
    await setCode('OUTRA-EQUIPE', "where slug='outra-equipe'")
    await signup(outroProf, 'OUTRA-EQUIPE')
    await signup(outroAluno, 'OUTRA-EQUIPE')
    await db.query("update public.team_members set role='dono',status='ativo' where user_id=$1", [
      outroProf,
    ])
    await asUser(outroProf, 'select public.approve_member($1,true)', [outroAluno])
    expect((await one(outroProf, 'select public.list_students()')).map((s: any) => s.id)).toEqual([
      outroAluno,
    ])
    await expect(asUser(outroProf, 'select public.student_detail($1)', [a])).rejects.toThrow()
    await expect(asUser(outroProf, 'select public.approve_member($1,false)', [a])).rejects.toThrow()
    expect((await asUser(outroProf, 'select id from public.profiles')).rows).toHaveLength(2)
    expect((await asUser(teacher, 'select id from public.profiles')).rows).toHaveLength(4)
    expect((await asUser(outroProf, 'select * from public.attendances')).rows).toHaveLength(0)
  })
  it('visitante e aluno não leem nem alteram tabelas internas', async () => {
    await expect(asUser(null, 'select * from public.profiles')).rejects.toThrow()
    await expect(asUser(a, 'select code_hash from public.teams')).rejects.toThrow()
    await expect(asUser(a, 'select * from public.team_members')).rejects.toThrow()
    await expect(asUser(a, "update public.team_members set role='dono'")).rejects.toThrow()
    await expect(
      asUser(a, 'select public.generate_sessions(public.my_team(),public.today_sp()+5)'),
    ).rejects.toThrow()
  })
})

describe('aulas padrão', () => {
  let schedule = ''
  const count = (s: string) =>
    n('select count(*) from public.class_sessions where schedule_id=$1', [s])
  it('professor cria horário e as aulas são geradas sem duplicar', async () => {
    schedule = await one(
      teacher,
      "select public.create_schedule('Adulto','{0,1,2,3,4,5,6}',time '23:30',60,public.today_sp()+1)",
    )
    expect(await count(schedule)).toBe(28)
    await asUser(a, 'select public.list_sessions(public.today_sp(),public.today_sp()+30)')
    expect(await count(schedule)).toBe(30)
    await asUser(a, 'select public.list_sessions(public.today_sp(),public.today_sp()+30)')
    expect(await count(schedule)).toBe(30)
    const t = (
      await db.query(
        "select distinct to_char(starts_at at time zone 'America/Sao_Paulo','HH24:MI') as h from public.class_sessions where schedule_id=$1",
        [schedule],
      )
    ).rows
    expect(t).toEqual([{ h: '23:30' }])
  })
  it('rejeita dados inválidos e aluno não cria horário', async () => {
    for (const sql of [
      "select public.create_schedule('Adulto','{}',time '07:00',60,public.today_sp())",
      "select public.create_schedule('Adulto','{1,1}',time '07:00',60,public.today_sp())",
      "select public.create_schedule('Adulto','{7}',time '07:00',60,public.today_sp())",
      "select public.create_schedule('Adulto','{1}',time '07:00',5,public.today_sp())",
      "select public.create_schedule('Adulto','{1}',time '07:00',60,public.today_sp()-1)",
    ])
      await expect(asUser(teacher, sql)).rejects.toThrow()
    await expect(
      asUser(a, "select public.create_schedule('Adulto','{1}',time '07:00',60,public.today_sp())"),
    ).rejects.toThrow()
  })
  it('editar vale a partir da data escolhida, sem mexer em aula com check-in', async () => {
    const target = (
      await db.query<{ id: string }>(
        "select id from public.class_sessions where schedule_id=$1 and (starts_at at time zone 'America/Sao_Paulo')::date=public.today_sp()+10",
        [schedule],
      )
    ).rows[0].id
    await asUser(a, 'select public.checkin($1)', [target])
    await expect(
      asUser(
        teacher,
        "select public.update_schedule($1,'Adulto','{1}',time '19:00',60,public.today_sp())",
        [schedule],
      ),
    ).rejects.toThrow(/amanhã/)
    const next = await one(
      teacher,
      "select public.update_schedule($1,'Adulto noite','{0,1,2,3,4,5,6}',time '19:00',90,public.today_sp()+5)",
      [schedule],
    )
    expect(next).not.toBe(schedule)
    expect(
      await n('select valid_until - public.today_sp() from public.class_schedules where id=$1', [
        schedule,
      ]),
    ).toBe(4)
    expect(
      await n(
        "select count(*) from public.class_sessions where schedule_id=$1 and (starts_at at time zone 'America/Sao_Paulo')::date>=public.today_sp()+5",
        [schedule],
      ),
    ).toBe(1) // só a aula que já tinha check-in
    const hours = (
      await db.query(
        "select distinct to_char(starts_at at time zone 'America/Sao_Paulo','HH24:MI') as h, duration_min from public.class_sessions where schedule_id=$1",
        [next],
      )
    ).rows
    expect(hours).toEqual([{ h: '19:00', duration_min: 90 }])
  })
  it('encerrar remove aulas futuras sem check-in', async () => {
    const [s] = (await one(teacher, 'select public.list_schedules()')).filter(
      (x: any) => x.title === 'Adulto noite',
    )
    await asUser(teacher, 'select public.end_schedule($1,public.today_sp()+6)', [s.id])
    expect(
      await n(
        "select count(*) from public.class_sessions where schedule_id=$1 and (starts_at at time zone 'America/Sao_Paulo')::date>public.today_sp()+6",
        [s.id],
      ),
    ).toBe(0)
  })
})

describe('check-in e presença por aula', () => {
  it('check-in até 1 hora antes, sem duplicar, e desistência no prazo', async () => {
    const s = await sessionAt('3 hours')
    await Promise.all([
      asUser(a, 'select public.checkin($1)', [s]),
      asUser(a, 'select public.checkin($1)', [s]),
    ])
    expect(
      (await db.query('select status,source from public.attendances where session_id=$1', [s]))
        .rows,
    ).toEqual([{ status: 'pendente', source: 'checkin' }])
    const mine = (
      await one(a, 'select public.list_sessions(public.today_sp()-1,public.today_sp()+1)')
    ).find((x: any) => x.id === s)
    expect(mine.mine).toBe('pendente')
    expect(mine.pending).toBeNull() // contagem de revisão só para professor
    await asUser(a, 'select public.cancel_checkin($1)', [s])
    expect(
      (await db.query('select * from public.attendances where session_id=$1', [s])).rows,
    ).toHaveLength(0)
    const late = await sessionAt('59 minutes')
    await expect(asUser(a, 'select public.checkin($1)', [late])).rejects.toThrow(/1 hora/)
    await expect(asUser(teacher, 'select public.checkin($1)', [s])).rejects.toThrow()
    const otherTeam = (
      await db.query<{ id: string }>("select id from public.teams where slug='outra-equipe'")
    ).rows[0].id
    const other = await sessionAt('3 hours', 'prevista', otherTeam)
    await expect(asUser(a, 'select public.checkin($1)', [other])).rejects.toThrow()
  })
  it('professor aprova quem fez check-in; pendente e rejeitada não contam', async () => {
    const s = await sessionAt('3 hours')
    await asUser(a, 'select public.checkin($1)', [s])
    await asUser(b, 'select public.checkin($1)', [s])
    const before = (await one(a, 'select public.student_detail($1)', [a])).total
    await expect(
      asUser(teacher, "select public.review_presence($1,$2,'confirmada')", [s, a]),
    ).rejects.toThrow(/início/)
    await db.query(
      "update public.class_sessions set starts_at=now()-interval '10 minutes' where id=$1",
      [s],
    )
    await expect(
      asUser(a, "select public.review_presence($1,$2,'confirmada')", [s, a]),
    ).rejects.toThrow()
    await asUser(teacher, "select public.review_presence($1,$2,'confirmada')", [s, a])
    await asUser(teacher, "select public.review_presence($1,$2,'rejeitada')", [s, b])
    expect((await one(a, 'select public.student_detail($1)', [a])).total).toBe(before + 1)
    expect(
      (await db.query('select status from public.class_sessions where id=$1', [s])).rows[0].status,
    ).toBe('realizada')
    const detail = await one(teacher, 'select public.session_detail($1)', [s])
    expect(
      detail.students
        .filter((x: any) => x.status)
        .map((x: any) => x.status)
        .sort(),
    ).toEqual(['confirmada', 'rejeitada'])
  })
  it('aluno que esqueceu o check-in: professor lança presença confirmada', async () => {
    const s = await sessionAt('-2 hours', 'realizada')
    const before = (await one(b, 'select public.student_detail($1)', [b])).total
    await asUser(teacher, 'select public.teacher_add_presence($1,$2)', [s, b])
    await asUser(teacher, 'select public.teacher_add_presence($1,$2)', [s, b])
    expect((await one(b, 'select public.student_detail($1)', [b])).total).toBe(before + 1)
    await expect(asUser(a, 'select public.teacher_add_presence($1,$2)', [s, a])).rejects.toThrow()
    const future = await sessionAt('2 hours')
    await expect(
      asUser(teacher, 'select public.teacher_add_presence($1,$2)', [future, b]),
    ).rejects.toThrow()
    await asUser(teacher, 'select public.teacher_remove_presence($1,$2)', [s, b])
    expect((await one(b, 'select public.student_detail($1)', [b])).total).toBe(before)
  })
  it('duas aulas no mesmo dia contam 2', async () => {
    const before = (await one(b, 'select public.student_detail($1)', [b])).total
    for (const off of ['-1 minute', '-2 minutes'])
      await asUser(teacher, 'select public.teacher_add_presence($1,$2)', [
        await sessionAt(off, 'realizada'),
        b,
      ])
    expect((await one(b, 'select public.student_detail($1)', [b])).total).toBe(before + 2)
  })
  it('cancelar aula futura apaga check-ins pendentes; aluno não cancela', async () => {
    const s = await sessionAt('5 hours')
    await asUser(a, 'select public.checkin($1)', [s])
    await expect(asUser(a, "select public.cancel_session($1,'x')", [s])).rejects.toThrow()
    await asUser(teacher, "select public.cancel_session($1,'Feriado')", [s])
    expect(
      (await db.query('select status,cancel_reason from public.class_sessions where id=$1', [s]))
        .rows[0],
    ).toEqual({ status: 'cancelada', cancel_reason: 'Feriado' })
    expect(
      (await db.query('select * from public.attendances where session_id=$1', [s])).rows,
    ).toHaveLength(0)
    await expect(asUser(a, 'select public.checkin($1)', [s])).rejects.toThrow()
    await expect(
      asUser(teacher, 'select public.teacher_add_presence($1,$2)', [
        await sessionAt('-1 hour', 'cancelada'),
        a,
      ]),
    ).rejects.toThrow()
  })
  it('aula avulsa no passado nasce realizada', async () => {
    const s = await one(
      teacher,
      "select public.create_session('Treino extra',now()-interval '1 day',60,'Raspagens')",
    )
    expect(
      (await db.query('select status,description from public.class_sessions where id=$1', [s]))
        .rows[0],
    ).toEqual({ status: 'realizada', description: 'Raspagens' })
  })
})

describe('papéis e configurações', () => {
  it('dono promove professor; professor ajusta meta mas não o código', async () => {
    await expect(asUser(a, "select public.set_member_role($1,'professor')", [b])).rejects.toThrow()
    await asUser(teacher, "select public.set_member_role($1,'professor')", [b])
    expect(await one(b, 'select public.is_teacher()')).toBe(true)
    await asUser(b, 'select public.update_settings(20,null)')
    await expect(asUser(b, "select public.update_settings(20,'NOVO-CODIGO-1')")).rejects.toThrow(
      /dono/,
    )
    await expect(
      asUser(b, "select public.set_member_role($1,'aluno')", [teacher]),
    ).rejects.toThrow()
    await expect(
      asUser(teacher, "select public.set_member_role($1,'aluno')", [teacher]),
    ).rejects.toThrow()
    await asUser(teacher, "select public.update_settings(30,'NOVO-CODIGO-1')")
    await expect(signup(id(10), 'TURMA-TESTE')).rejects.toThrow()
    await signup(id(10), 'NOVO-CODIGO-1')
    await expect(
      asUser(teacher, "select public.update_settings(30,'OUTRA-EQUIPE')"),
    ).rejects.toThrow(/outro código/)
    expect((await one(a, 'select public.get_settings()')).goal).toBe(30)
    await asUser(teacher, "select public.set_member_role($1,'aluno')", [b])
  })
  it('dono personaliza nome e cores; valores inválidos são recusados', async () => {
    await asUser(teacher, "select public.update_team('Equipe Tigre','#112233','#aabbcc')")
    expect((await one(a, 'select public.get_settings()')).team).toMatchObject({
      name: 'Equipe Tigre',
      primaryColor: '#112233',
    })
    await expect(
      asUser(teacher, "select public.update_team('Equipe','vermelho','#aabbcc')"),
    ).rejects.toThrow()
    await expect(
      asUser(b, "select public.update_team('X Y','#112233','#aabbcc')"),
    ).rejects.toThrow()
  })
})

describe('graduação continua protegida', () => {
  it('concede uma vez, detecta versão desatualizada e desfaz', async () => {
    const key = '11111111-1111-4111-8111-111111111111'
    const rev = (await one(a, 'select public.student_detail($1)', [a])).revision
    await asUser(teacher, "select public.graduate_student($1,'grau',$2,$3)", [a, key, rev])
    await asUser(teacher, "select public.graduate_student($1,'grau',$2,$3)", [a, key, rev])
    await expect(
      asUser(teacher, "select public.graduate_student($1,'grau',gen_random_uuid(),$2)", [a, rev]),
    ).rejects.toThrow(/atualiz/)
    let d = await one(a, 'select public.student_detail($1)', [a])
    expect([d.belt, d.degrees, d.cycle]).toEqual(['azul', 3, 0])
    await asUser(teacher, 'select public.undo_graduation($1,$2,$3)', [a, key, d.revision])
    d = await one(a, 'select public.student_detail($1)', [a])
    expect(d.degrees).toBe(2)
    await expect(
      asUser(outroProf, "select public.graduate_student($1,'grau',gen_random_uuid(),0)", [a]),
    ).rejects.toThrow()
  })
  it('dia do servidor ignora timezone da sessão', async () => {
    const r = await db.transaction(async (tx) => {
      await tx.exec("set local timezone='Pacific/Auckland'")
      return tx.query<{ ok: boolean }>(
        "select public.today_sp() = (now() at time zone 'America/Sao_Paulo')::date as ok",
      )
    })
    expect(r.rows[0].ok).toBe(true)
  })
})

describe('diário de treinos', () => {
  it('professor descreve a aula e adiciona fotos; aluno vê, mas não altera', async () => {
    const s = await sessionAt('-3 hours', 'realizada')
    const team = (
      await db.query<{ id: string }>("select id from public.teams where slug='minha-turma'")
    ).rows[0].id
    await asUser(teacher, "select public.update_session_description($1,'Passagem de guarda')", [s])
    await expect(
      asUser(a, "select public.update_session_description($1,'x')", [s]),
    ).rejects.toThrow()
    const photo = await one(teacher, 'select public.add_session_photo($1,$2,$3)', [
      s,
      `${team}/${s}/foto1.jpg`,
      'Aquecimento',
    ])
    await expect(
      asUser(a, 'select public.add_session_photo($1,$2,null)', [s, `${team}/${s}/foto2.jpg`]),
    ).rejects.toThrow()
    for (const bad of [`outra/${s}/x.jpg`, `${team}/${s}/../x.jpg`, `${team}/${s}/x.png`])
      await expect(
        asUser(teacher, 'select public.add_session_photo($1,$2,null)', [s, bad]),
      ).rejects.toThrow(/inválido/)
    const j = await one(a, 'select public.session_journal($1)', [s])
    expect(j.description).toBe('Passagem de guarda')
    expect(j.photos).toEqual([
      { id: photo, path: `${team}/${s}/foto1.jpg`, caption: 'Aquecimento' },
    ])
    const listed = (
      await one(a, 'select public.list_sessions(public.today_sp()-1,public.today_sp()+1)')
    ).find((x: any) => x.id === s)
    expect(listed.photos).toBe(1)
    await expect(asUser(outroProf, 'select public.session_journal($1)', [s])).rejects.toThrow()
    await expect(asUser(a, 'select public.delete_session_photo($1)', [photo])).rejects.toThrow()
    await expect(
      asUser(outroProf, 'select public.delete_session_photo($1)', [photo]),
    ).rejects.toThrow()
    expect(await one(teacher, 'select public.delete_session_photo($1)', [photo])).toBe(
      `${team}/${s}/foto1.jpg`,
    )
    expect((await one(a, 'select public.session_journal($1)', [s])).photos).toEqual([])
  })
  it('foto em aula futura é permitida; cancelada não; no máximo 20 por aula', async () => {
    const team = (
      await db.query<{ id: string }>("select id from public.teams where slug='minha-turma'")
    ).rows[0].id
    const future = await sessionAt('2 hours')
    await asUser(teacher, 'select public.add_session_photo($1,$2,null)', [
      future,
      `${team}/${future}/a.jpg`,
    ])
    const cancelled = await sessionAt('3 hours', 'cancelada')
    await expect(
      asUser(teacher, 'select public.add_session_photo($1,$2,null)', [
        cancelled,
        `${team}/${cancelled}/a.jpg`,
      ]),
    ).rejects.toThrow(/cancelada/)
    const s = await sessionAt('-1 hour', 'realizada')
    for (let i = 0; i < 20; i++)
      await asUser(teacher, 'select public.add_session_photo($1,$2,null)', [
        s,
        `${team}/${s}/f${i}.jpg`,
      ])
    await expect(
      asUser(teacher, 'select public.add_session_photo($1,$2,null)', [s, `${team}/${s}/f21.jpg`]),
    ).rejects.toThrow(/20/)
    const listed = (
      await one(a, 'select public.list_sessions(public.today_sp()-1,public.today_sp()+1)')
    ).find((x: any) => x.id === s)
    expect(listed.cover).toBe(`${team}/${s}/f0.jpg`)
  })
})

describe('registro do treino, logo e notificações', () => {
  it('professor marca vários presentes de uma vez, inclusive quem não fez check-in', async () => {
    const s = await sessionAt('3 hours')
    await asUser(a, 'select public.checkin($1)', [s])
    await db.query(
      "update public.class_sessions set starts_at=now()-interval '5 minutes' where id=$1",
      [s],
    )
    const before = [
      (await one(a, 'select public.student_detail($1)', [a])).total,
      (await one(b, 'select public.student_detail($1)', [b])).total,
    ]
    expect(await one(teacher, 'select public.confirm_presences($1,$2)', [s, [a, b, b]])).toBe(2)
    expect((await one(a, 'select public.student_detail($1)', [a])).total).toBe(before[0] + 1)
    expect((await one(b, 'select public.student_detail($1)', [b])).total).toBe(before[1] + 1)
    expect(
      (await db.query('select status from public.class_sessions where id=$1', [s])).rows[0].status,
    ).toBe('realizada')
    await expect(asUser(a, 'select public.confirm_presences($1,$2)', [s, [a]])).rejects.toThrow()
    await expect(
      asUser(teacher, 'select public.confirm_presences($1,$2)', [s, [outroAluno]]),
    ).rejects.toThrow()
    await expect(
      asUser(teacher, 'select public.confirm_presences($1,$2)', [await sessionAt('2 hours'), [a]]),
    ).rejects.toThrow()
    await expect(asUser(teacher, "select public.confirm_presences($1,'{}')", [s])).rejects.toThrow()
  })
  it('só o dono troca a logo, sempre dentro da pasta da equipe', async () => {
    const team = (
      await db.query<{ id: string }>("select id from public.teams where slug='minha-turma'")
    ).rows[0].id
    await asUser(teacher, 'select public.set_team_logo($1)', [`${team}/logo-abc.png`])
    expect((await one(a, 'select public.get_settings()')).team.logoPath).toBe(
      `${team}/logo-abc.png`,
    )
    expect(await one(teacher, 'select public.set_team_logo(null)')).toBe(`${team}/logo-abc.png`)
    await expect(
      asUser(teacher, 'select public.set_team_logo($1)', ['outra/logo-x.png']),
    ).rejects.toThrow()
    await expect(
      asUser(a, 'select public.set_team_logo($1)', [`${team}/logo-x.png`]),
    ).rejects.toThrow()
  })
  it('só professores registram notificações; aluno não lê inscrições', async () => {
    await asUser(teacher, "select public.save_push_subscription('https://push.example/1','k','a')")
    await asUser(
      teacher,
      "select public.save_push_subscription('https://push.example/1','k2','a2')",
    )
    expect(
      Number((await db.query('select count(*) from public.push_subscriptions')).rows[0].count),
    ).toBe(1)
    await expect(
      asUser(a, "select public.save_push_subscription('https://push.example/2','k','a')"),
    ).rejects.toThrow()
    await expect(
      asUser(teacher, "select public.save_push_subscription('http://inseguro','k','a')"),
    ).rejects.toThrow()
    await expect(asUser(a, 'select * from public.push_subscriptions')).rejects.toThrow()
    await asUser(teacher, "select public.delete_push_subscription('https://push.example/1')")
    expect(
      Number((await db.query('select count(*) from public.push_subscriptions')).rows[0].count),
    ).toBe(0)
  })
})

describe('apagar aula (professor e dono)', () => {
  it('professor (além do dono) apaga aula futura com check-in; ela some da listagem', async () => {
    const s = await sessionAt('6 hours')
    await asUser(a, 'select public.checkin($1)', [s])
    await asUser(teacher, 'select public.delete_session($1)', [s])
    expect(
      (await db.query('select * from public.class_sessions where id=$1', [s])).rows,
    ).toHaveLength(0)
    expect(
      (await db.query('select * from public.attendances where session_id=$1', [s])).rows,
    ).toHaveLength(0)
    const listed = await one(teacher, 'select public.list_sessions(public.today_sp(),public.today_sp()+1)')
    expect(listed.find((x: any) => x.id === s)).toBeUndefined()
    const s2 = await sessionAt('6 hours')
    await asUser(teacher, "select public.set_member_role($1,'professor')", [b])
    await asUser(b, 'select public.delete_session($1)', [s2])
    await asUser(teacher, "select public.set_member_role($1,'aluno')", [b])
    expect((await db.query('select * from public.class_sessions where id=$1', [s2])).rows).toHaveLength(0)
  })
  it('professor apaga aula antiga realizada; contagem do aluno cai', async () => {
    const s = await sessionAt('-2 hours', 'realizada')
    await asUser(teacher, 'select public.teacher_add_presence($1,$2)', [s, b])
    const before = (await one(b, 'select public.student_detail($1)', [b])).total
    await asUser(teacher, 'select public.delete_session($1)', [s])
    expect((await one(b, 'select public.student_detail($1)', [b])    ).total).toBe(before - 1)
    expect(
      (await db.query('select * from public.attendances where session_id=$1', [s])).rows,
    ).toHaveLength(0)
  })
  it('devolve os caminhos das fotos para limpar o Storage', async () => {
    const team = (
      await db.query<{ id: string }>("select id from public.teams where slug='minha-turma'")
    ).rows[0].id
    const s = await sessionAt('4 hours')
    await asUser(teacher, 'select public.add_session_photo($1,$2,null)', [s, `${team}/${s}/a.jpg`])
    await asUser(teacher, 'select public.add_session_photo($1,$2,null)', [s, `${team}/${s}/b.jpg`])
    const paths = await one(teacher, 'select public.delete_session($1)', [s])
    expect((paths as string[]).sort()).toEqual([`${team}/${s}/a.jpg`, `${team}/${s}/b.jpg`].sort())
    expect((await db.query('select * from public.session_photos where session_id=$1', [s])).rows).toHaveLength(0)
  })
  it('aluno, professor de outra equipe e aula inexistente não apagam', async () => {
    const s = await sessionAt('3 hours')
    await expect(asUser(a, 'select public.delete_session($1)', [s])).rejects.toThrow()
    await expect(asUser(outroProf, 'select public.delete_session($1)', [s])).rejects.toThrow()
    await expect(
      asUser(teacher, 'select public.delete_session($1)', [id(99)]),
    ).rejects.toThrow(/encontrada/)
    expect((await db.query('select * from public.class_sessions where id=$1', [s])).rows).toHaveLength(1)
  })
})

describe('código de acesso visível para professores', () => {
  it('dono gera código legível; aluno se cadastra com ele (mesmo em minúsculas)', async () => {
    const code = await one(teacher, 'select public.generate_join_code()')
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(await one(teacher, 'select public.get_join_code()')).toBe(code)
    await signup(id(20), '  ' + code.toLowerCase() + ' ')
    expect(
      (await db.query('select status from public.team_members where user_id=$1', [id(20)])).rows,
    ).toEqual([{ status: 'pendente' }])
    const other = await one(teacher, 'select public.generate_join_code()')
    expect(other).not.toBe(code)
    await expect(signup(id(21), code)).rejects.toThrow(/Código/)
  })
  it('professor vê e compartilha, mas não gera; aluno não vê', async () => {
    await asUser(teacher, "select public.set_member_role($1,'professor')", [b])
    expect(await one(b, 'select public.get_join_code()')).toMatch(/^.{4}-.{4}$/)
    await expect(asUser(b, 'select public.generate_join_code()')).rejects.toThrow(/dono/)
    await asUser(teacher, "select public.set_member_role($1,'aluno')", [b])
    await expect(asUser(a, 'select public.get_join_code()')).rejects.toThrow()
    await expect(asUser(a, 'select join_code from public.teams')).rejects.toThrow()
  })
  it('código definido manualmente também fica visível; cada equipe vê só o seu', async () => {
    await asUser(teacher, "select public.update_settings(30,'MEU-CODIGO-2026')")
    expect(await one(teacher, 'select public.get_join_code()')).toBe('MEU-CODIGO-2026')
    expect(await one(outroProf, 'select public.get_join_code()')).not.toBe('MEU-CODIGO-2026')
    await asUser(teacher, "select public.set_join_code('OUTRO-CODIGO-99')")
    expect(await one(teacher, 'select public.get_join_code()')).toBe('OUTRO-CODIGO-99')
    expect((await one(a, 'select public.get_settings()')).goal).toBe(30)
    await expect(asUser(teacher, "select public.set_join_code('curto')")).rejects.toThrow()
    await expect(asUser(teacher, "select public.set_join_code('OUTRA-EQUIPE')")).rejects.toThrow(
      /outro/,
    )
    await expect(asUser(a, "select public.set_join_code('ALUNO-TENTA-1')")).rejects.toThrow()
  })
})

describe('perfil do aluno: contato, nascimento, avatar e status inativo', () => {
  it('aluno edita o próprio nome, contato e nascimento; professor vê no detalhe', async () => {
    await asUser(novo, "select public.update_my_profile('Novo Nome','(11) 91234-5678','1998-05-20')")
    const d = await one(teacher, 'select public.student_detail($1)', [novo])
    expect(d.name).toBe('Novo Nome')
    expect(d.contact).toBe('(11) 91234-5678')
    expect(d.birthDate).toBe('1998-05-20')
    expect(typeof d.held).toBe('number')
    expect(d.joinedAt).toBeTruthy()
    await expect(
      asUser(novo, "select public.update_my_profile(null,'x','1998-05-20')", []),
    ).resolves.toBeTruthy()
    expect((await one(novo, 'select public.student_detail($1)', [novo])).name).toBe('Novo Nome')
  })
  it('valida nome curto, contato longo e nascimento futuro', async () => {
    await expect(
      asUser(novo, "select public.update_my_profile('A',null,null)"),
    ).rejects.toThrow(/2 e 80/)
    await expect(
      asUser(novo, 'select public.update_my_profile(null,$1,null)', ['x'.repeat(121)]),
    ).rejects.toThrow(/120/)
    await expect(
      asUser(novo, 'select public.update_my_profile(null,null,public.today_sp()+1)'),
    ).rejects.toThrow()
  })
  it('dono promove aluno a professor e lista a equipe técnica; guarda de papel vale', async () => {
    const staffRows = () => asUser(teacher, 'select * from public.list_staff()').then((r) => r.rows)
    // o dono está na lista; o aluno comum não
    expect((await staffRows()).some((m: any) => m.role === 'dono')).toBe(true)
    expect((await staffRows()).some((m: any) => m.id === novo)).toBe(false)
    // aluno não altera papéis
    await expect(
      asUser(novo, 'select public.set_member_role($1,$2)', [novo, 'professor']),
    ).rejects.toThrow()
    // dono promove; promovido aparece no staff e sai da lista de alunos
    await asUser(teacher, 'select public.set_member_role($1,$2)', [novo, 'professor'])
    expect((await staffRows()).some((m: any) => m.id === novo && m.role === 'professor')).toBe(true)
    const alunos = await one(teacher, 'select public.list_students()')
    expect(alunos.some((s: any) => s.id === novo)).toBe(false)
    // dono não altera o próprio papel nem um dono
    await expect(
      asUser(teacher, 'select public.set_member_role($1,$2)', [teacher, 'aluno']),
    ).rejects.toThrow(/próprio/)
    // rebaixa de volta
    await asUser(teacher, 'select public.set_member_role($1,$2)', [novo, 'aluno'])
    expect(
      (await one(teacher, 'select public.list_students()')).some((s: any) => s.id === novo),
    ).toBe(true)
  })
  it('avatar: caminho válido grava e devolve o antigo; caminho inválido é recusado', async () => {
    const team = (
      await db.query<{ id: string }>("select id from public.teams where slug='minha-turma'")
    ).rows[0].id
    const path = `avatars/${team}/${novo}/11111111-2222-3333-4444-555555555555.jpg`
    expect(await one(novo, 'select public.set_avatar($1)', [path])).toBeNull()
    expect(
      await one(novo, 'select public.set_avatar($1)', [
        `avatars/${team}/${novo}/22222222-3333-4444-5555-666666666666.png`,
      ]),
    ).toBe(path)
    await expect(
      asUser(novo, 'select public.set_avatar($1)', [`avatars/${team}/${outroAluno}/x.jpg`]),
    ).rejects.toThrow()
    // subpasta de outro aluno, mesmo com nome de arquivo válido, é recusada
    await expect(
      asUser(novo, 'select public.set_avatar($1)', [
        `avatars/${team}/${outroAluno}/33333333-4444-4555-8666-777777777777.jpg`,
      ]),
    ).rejects.toThrow(/inválido/)
    await expect(asUser(novo, 'select public.set_avatar($1)', ['/etc/passwd'])).rejects.toThrow()
  })
  it('professor marca inativo: aluno perde acesso, professor continua vendo e reativa', async () => {
    await asUser(teacher, 'select public.set_student_status($1,\'inativo\')', [novo])
    await expect(asUser(novo, 'select public.student_detail($1)', [novo])).rejects.toThrow()
    const list = await one(teacher, 'select public.list_students()')
    expect(list.find((s: any) => s.id === novo).memberStatus).toBe('inativo')
    await expect(asUser(a, 'select public.set_student_status($1,\'ativo\')', [novo])).rejects.toThrow()
    await asUser(teacher, 'select public.set_student_status($1,\'ativo\')', [novo])
    expect((await one(novo, 'select public.student_detail($1)', [novo])).total).toBe(0)
    await expect(
      asUser(teacher, 'select public.set_student_status($1,\'bloqueado\')', [novo]),
    ).rejects.toThrow(/Status/)
  })
  it('graduação guarda observação; observação longa é recusada', async () => {
    await asUser(teacher, 'select public.set_initial($1,\'branca\',0,0,$2)', [novo, 'Veio de outra academia'])
    const rev = (await one(teacher, 'select public.student_detail($1)', [novo])).revision
    await asUser(
      teacher,
      'select public.graduate_student($1,\'grau\',gen_random_uuid(),$2,$3)',
      [novo, rev, 'Seminário de raspagem'],
    )
    const d = await one(teacher, 'select public.student_detail($1)', [novo])
    expect(d.events.map((e: any) => e.note)).toEqual(['Seminário de raspagem', 'Veio de outra academia'])
    await expect(
      asUser(teacher, 'select public.graduate_student($1,\'grau\',gen_random_uuid(),0,$2)', [
        novo,
        'x'.repeat(301),
      ]),
    ).rejects.toThrow()
  })
})

describe('mvp: criar turma, editar aula e avisos', () => {
  it('cadastro com new_team cria equipe, dono ativo e código de entrada', async () => {
    await db.query(
      'insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3::jsonb)',
      [id(7), id(7) + '@test.local', JSON.stringify({ name: 'Dona Ana', new_team: 'Academia Coração' })],
    )
    const t = await db.query<any>("select * from public.teams where name='Academia Coração'")
    expect(t.rows).toHaveLength(1)
    const team = t.rows[0]
    expect(team.slug).toMatch(/^academia-cora/)
    expect(team.join_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(team.code_hash).not.toBe('')
    const m = await db.query<any>(
      'select role,status from public.team_members where team_id=$1 and user_id=$2',
      [team.id, id(7)],
    )
    expect([m.rows[0].role, m.rows[0].status]).toEqual(['dono', 'ativo'])
    // outro aluno entra na equipe nova pelo código gerado
    await db.query(
      'insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3::jsonb)',
      [id(8), id(8) + '@test.local', JSON.stringify({ name: 'Aluno Zé', class_code: team.join_code })],
    )
    const m2 = await db.query<any>(
      'select role,status from public.team_members where team_id=$1 and user_id=$2',
      [team.id, id(8)],
    )
    expect([m2.rows[0].role, m2.rows[0].status]).toEqual(['aluno', 'pendente'])
    // nome de turma inválido é recusado
    await expect(
      db.query(
        'insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3::jsonb)',
        [id(9), id(9) + '@test.local', JSON.stringify({ name: 'Nome Válido', new_team: 'A' })],
      ),
    ).rejects.toThrow(/nome da turma/i)
  })
  it('professor edita aula prevista; aula realizada e aluno são recusados', async () => {
    const s = await sessionAt('2 days')
    await asUser(teacher, 'select public.update_session($1,$2,now()+$3::interval,$4)', [
      s,
      'Aula editada',
      '3 days',
      90,
    ])
    const row = await db.query<any>(
      'select title,starts_at,duration_min from public.class_sessions where id=$1',
      [s],
    )
    expect(row.rows[0].title).toBe('Aula editada')
    expect(row.rows[0].duration_min).toBe(90)
    await expect(
      asUser(a, 'select public.update_session($1,$2,now()+$3::interval,$4)', [s, 'Tentativa aluno', '3 days', 60]),
    ).rejects.toThrow()
    const done = await sessionAt('-1 day', 'realizada')
    await expect(
      asUser(teacher, 'select public.update_session($1,$2,now(),60)', [done, 'Mudança tarde']),
    ).rejects.toThrow(/prevista/)
    await expect(
      asUser(teacher, 'select public.update_session($1,$2,now()+$3::interval,$4)', [s, 'Aula editada', '3 days', 10]),
    ).rejects.toThrow(/duração/i)
  })
  it('avisos: staff publica, equipe lê, autor ou dono apaga', async () => {
    const avisoId = await one(
      teacher,
      'select public.create_announcement($1) as id',
      ['Sem treino no sábado, campeonato na semana que vem'],
    )
    expect(Number(await one(a, 'select count(*) from public.announcements'))).toBe(1)
    // aluno não publica
    await expect(asUser(a, 'select public.create_announcement($1)', ['Tentativa do aluno'])).rejects.toThrow()
    // aviso curto demais é recusado
    await expect(asUser(teacher, 'select public.create_announcement($1)', ['x'])).rejects.toThrow(/2 e 500/)
    // aluno que não é autor não apaga (security definer: a guarda está na função)
    await expect(asUser(a, 'select public.delete_announcement($1)', [avisoId])).rejects.toThrow(/não encontrado/i)
    expect(Number(await one(a, 'select count(*) from public.announcements'))).toBe(1)
    // autor apaga o próprio aviso
    await asUser(teacher, 'select public.delete_announcement($1)', [avisoId])
    expect(Number(await one(a, 'select count(*) from public.announcements'))).toBe(0)
    // apagar aviso inexistente falha
    await expect(
      asUser(teacher, 'select public.delete_announcement($1)', [avisoId]),
    ).rejects.toThrow(/não encontrado/i)
  })
})
