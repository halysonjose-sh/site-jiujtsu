import {
  currentRank,
  graduate,
  setInitial,
  todayInSaoPaulo,
  undoLast,
  type Belt,
  type Graduation,
} from '../domain/rules'
import {
  cancelSession,
  editSchedule,
  generateSessions,
  localDate,
  validateSchedule,
  zonedToUtc,
  type Schedule,
  type Session,
} from '../domain/schedule'
import {
  cancelCheckIn,
  checkIn,
  countPresences,
  reviewPresence,
  teacherAddPresence,
  teacherRemovePresence,
  type Actor,
  type Presence,
} from '../domain/attendance'
import type {
  PhotoStore,
  SessionJournal,
  Dashboard,
  RankEvent,
  ScheduleView,
  SessionDetail,
  SessionView,
  StudentView,
  Team,
} from './api'

type DemoStudent = {
  id: string
  name: string
  revision: number
  memberStatus: 'pendente' | 'ativo'
  initial: { belt: Belt; degrees: number } | null
  events: Graduation[]
  kinds: Record<string, 'grau' | 'faixa'>
}
const TEAM = 't-demo'
const professor = { id: 'professor-demo', name: 'Rafael Costa', role: 'dono' as const, revision: 0 }
const prof: Actor = { id: professor.id, teamId: TEAM, role: 'dono' }
const lucas: Actor = { id: 'lucas', teamId: TEAM, role: 'aluno' }

const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function createDemo() {
  const today = todayInSaoPaulo(new Date())
  let seq = 0
  const newId = (p: string) => `${p}-${++seq}`
  let team: Team = {
    id: TEAM,
    name: 'Equipe Demonstração',
    slug: 'demo',
    primaryColor: '#234c3a',
    accentColor: '#cee68b',
    logoPath: null,
  }
  let goal: number | null = 30
  let schedules: Schedule[] = [
    {
      id: 'sch-1',
      teamId: TEAM,
      title: 'Jiu-jítsu adulto',
      weekdays: [1, 3, 5],
      startTime: '19:00',
      durationMin: 90,
      validFrom: addDays(today, -60),
      validUntil: null,
    },
  ]
  const withIds = (list: Session[]) => list.map((s) => ({ ...s, id: s.id ?? newId('aula') }))
  const settle = (list: Session[]) => {
    const now = Date.now()
    return list.map((s) =>
      s.status === 'prevista' && new Date(s.startsAt).getTime() + 3600000 < now
        ? { ...s, status: 'realizada' as const }
        : s,
    )
  }
  let sessions: Session[] = settle(
    withIds(generateSessions(schedules, addDays(today, -60), addDays(today, 21), [])),
  )
  const extend = () => {
    sessions = [
      ...sessions,
      ...withIds(generateSessions(schedules, today, addDays(today, 28), sessions)),
    ].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  }
  let students: DemoStudent[] = [
    {
      id: 'lucas',
      name: 'Lucas Almeida',
      revision: 0,
      memberStatus: 'ativo',
      initial: { belt: 'azul', degrees: 1 },
      events: [],
      kinds: {},
    },
    {
      id: 'marina',
      name: 'Marina Santos',
      revision: 0,
      memberStatus: 'ativo',
      initial: { belt: 'branca', degrees: 3 },
      events: [],
      kinds: {},
    },
    {
      id: 'pedro',
      name: 'Pedro Oliveira',
      revision: 0,
      memberStatus: 'ativo',
      initial: null,
      events: [],
      kinds: {},
    },
    {
      id: 'ana',
      name: 'Ana Costa',
      revision: 0,
      memberStatus: 'pendente',
      initial: null,
      events: [],
      kinds: {},
    },
  ]
  const past = sessions.filter((s) => new Date(s.startsAt).getTime() < Date.now())
  let presences: Presence[] = []
  past.forEach((s, i) => {
    for (const [id, every] of [
      ['lucas', 1],
      ['marina', 1],
      ['pedro', 3],
    ] as const)
      if (i % every === 0)
        presences.push({
          sessionId: s.id!,
          studentId: id,
          date: localDate(s.startsAt),
          status: 'confirmada',
          source: 'checkin',
          reviewedAt: s.startsAt,
        })
  })
  if (past.length) {
    const last = past[past.length - 1]
    sessions = sessions.map((s) =>
      s.id === last.id
        ? { ...s, description: 'Passagem de guarda meia-guarda e finalização do triângulo.' }
        : s,
    )
  }
  const nextClass = sessions.find((s) => new Date(s.startsAt).getTime() > Date.now() + 2 * 3600000)
  if (nextClass)
    presences.push({
      sessionId: nextClass.id!,
      studentId: 'marina',
      date: localDate(nextClass.startsAt),
      status: 'pendente',
      source: 'checkin',
    })

  const session = (id: unknown) => {
    const s = sessions.find((x) => x.id === id)
    if (!s) throw new Error('Aula não encontrada.')
    return s
  }
  const student = (id: unknown) => {
    const s = students.find((x) => x.id === id)
    if (!s) throw new Error('Aluno não encontrado.')
    return s
  }
  const view = (s: DemoStudent): StudentView => {
    const rank = currentRank({ ...s, attendances: [] })
    return {
      id: s.id,
      name: s.name,
      role: 'aluno',
      memberStatus: s.memberStatus,
      revision: s.revision,
      belt: rank.belt,
      degrees: rank.degrees,
      ...countPresences(presences, s.id, s.events),
      today,
      initialSet: !!s.initial || s.events.length > 0,
      attendances: presences
        .filter((p) => p.studentId === s.id)
        .map((p) => {
          const x = session(p.sessionId)
          return {
            sessionId: p.sessionId,
            date: p.date,
            title: x.title,
            startsAt: x.startsAt,
            status: p.status,
            source: p.source,
          }
        })
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
      events: [...s.events]
        .reverse()
        .map<RankEvent>((e) => ({ ...e, kind: s.kinds[e.id], cancelled: !!e.cancelled }))
        .concat(
          s.initial
            ? [
                {
                  id: 'initial-' + s.id,
                  kind: 'initial',
                  ...s.initial,
                  date: addDays(today, -60),
                  cancelled: false,
                } as RankEvent,
              ]
            : [],
        ),
    }
  }
  let role: 'aluno' | 'professor' = 'aluno'
  let photos: { id: string; sessionId: string; path: string; caption: string | null }[] = []
  const files = new Map<string, string>()
  const photoStore: PhotoStore = {
    async upload(path, file) {
      files.set(path, URL.createObjectURL(file))
    },
    async urls(paths) {
      return Object.fromEntries(paths.filter((p) => files.has(p)).map((p) => [p, files.get(p)!]))
    },
    async remove(path) {
      const url = files.get(path)
      if (url) URL.revokeObjectURL(url)
      files.delete(path)
    },
  }
  const handlers: Record<string, (a: Record<string, any>) => unknown> = {
    today_sp: () => today,
    list_sessions: (a) => {
      extend()
      const staff = role === 'professor'
      return sessions
        .filter((s) => localDate(s.startsAt) >= a.p_from && localDate(s.startsAt) <= a.p_to)
        .map<SessionView>((s) => {
          const list = presences.filter((p) => p.sessionId === s.id)
          return {
            id: s.id!,
            title: s.title,
            startsAt: s.startsAt,
            durationMin: s.durationMin,
            status: s.status,
            cancelReason: s.cancelReason ?? null,
            description: s.description ?? null,
            scheduleId: s.scheduleId,
            photos: photos.filter((p) => p.sessionId === s.id).length,
            checkins: list.filter((p) => p.status !== 'rejeitada').length,
            pending: staff ? list.filter((p) => p.status === 'pendente').length : null,
            confirmed: staff ? list.filter((p) => p.status === 'confirmada').length : null,
            mine: staff ? null : (list.find((p) => p.studentId === 'lucas')?.status ?? null),
          }
        })
    },
    session_detail: (a) => {
      const s = session(a.p_session)
      return {
        id: s.id!,
        title: s.title,
        startsAt: s.startsAt,
        durationMin: s.durationMin,
        status: s.status,
        cancelReason: s.cancelReason ?? null,
        description: s.description ?? null,
        students: students
          .filter((x) => x.memberStatus === 'ativo')
          .map((x) => {
            const p = presences.find((p) => p.sessionId === s.id && p.studentId === x.id)
            return { id: x.id, name: x.name, status: p?.status ?? null, source: p?.source ?? null }
          })
          .sort((x, y) => Number(!x.status) - Number(!y.status) || x.name.localeCompare(y.name)),
      } satisfies SessionDetail
    },
    session_journal: (a) => {
      const s = session(a.p_session)
      return {
        id: s.id!,
        teamId: TEAM,
        title: s.title,
        startsAt: s.startsAt,
        durationMin: s.durationMin,
        status: s.status,
        cancelReason: s.cancelReason ?? null,
        description: s.description ?? null,
        mine:
          role === 'aluno'
            ? (presences.find((p) => p.sessionId === s.id && p.studentId === 'lucas')?.status ??
              null)
            : null,
        present: presences.filter((p) => p.sessionId === s.id && p.status === 'confirmada').length,
        photos: photos
          .filter((p) => p.sessionId === s.id)
          .map(({ id, path, caption }) => ({ id, path, caption })),
      } satisfies SessionJournal
    },
    update_session_description: (a) => {
      sessions = sessions.map((s) =>
        s.id === a.p_session
          ? { ...s, description: String(a.p_description).trim() || undefined }
          : s,
      )
    },
    add_session_photo: (a) => {
      const s = session(a.p_session)
      if (new Date(s.startsAt).getTime() > Date.now())
        throw new Error('Fotos só podem ser adicionadas depois do início da aula.')
      const id = newId('foto')
      photos = [...photos, { id, sessionId: s.id!, path: a.p_path, caption: a.p_caption ?? null }]
      return id
    },
    delete_session_photo: (a) => {
      const p = photos.find((x) => x.id === a.p_photo)
      if (!p) throw new Error('Foto não encontrada.')
      photos = photos.filter((x) => x.id !== p.id)
      return p.path
    },
    list_schedules: () =>
      schedules
        .filter((s) => !s.validUntil || s.validUntil >= today)
        .map<ScheduleView>((s) => ({
          id: s.id,
          title: s.title,
          weekdays: s.weekdays,
          startTime: s.startTime,
          durationMin: s.durationMin,
          validFrom: s.validFrom,
          validUntil: s.validUntil,
        })),
    checkin: (a) => void (presences = checkIn(presences, session(a.p_session), lucas, new Date())),
    cancel_checkin: (a) =>
      void (presences = cancelCheckIn(presences, session(a.p_session), lucas, new Date())),
    review_presence: (a) => {
      presences = reviewPresence(
        presences,
        session(a.p_session),
        prof,
        a.p_student,
        a.p_decision,
        new Date(),
      )
    },
    teacher_add_presence: (a) => {
      presences = teacherAddPresence(presences, session(a.p_session), prof, a.p_student, new Date())
      sessions = sessions.map((s) =>
        s.id === a.p_session && s.status === 'prevista' ? { ...s, status: 'realizada' } : s,
      )
    },
    teacher_remove_presence: (a) => {
      presences = teacherRemovePresence(presences, session(a.p_session), prof, a.p_student)
    },
    cancel_session: (a) => {
      const c = cancelSession(session(a.p_session), a.p_reason ?? '', new Date())
      sessions = sessions.map((s) => (s.id === c.id ? c : s))
      presences = presences.filter((p) => !(p.sessionId === c.id && p.status === 'pendente'))
    },
    create_session: (a) => {
      const id = newId('avulsa')
      const startsAt = new Date(a.p_starts_at).toISOString()
      sessions = [
        ...sessions,
        {
          id,
          teamId: TEAM,
          scheduleId: null,
          title: String(a.p_title).trim(),
          startsAt,
          durationMin: a.p_duration,
          status: (new Date(startsAt).getTime() <= Date.now()
            ? 'realizada'
            : 'prevista') as Session['status'],
          description: a.p_description ?? undefined,
        },
      ].sort((x, y) => x.startsAt.localeCompare(y.startsAt))
      return id
    },
    create_schedule: (a) => {
      const s: Schedule = {
        id: newId('sch'),
        teamId: TEAM,
        title: String(a.p_title).trim(),
        weekdays: a.p_weekdays,
        startTime: a.p_start,
        durationMin: a.p_duration,
        validFrom: a.p_valid_from,
        validUntil: null,
      }
      if (s.validFrom < today) throw new Error('O início deve ser hoje ou depois.')
      validateSchedule(s)
      schedules = [...schedules, s]
      extend()
      return s.id
    },
    update_schedule: (a) => {
      const old = schedules.find((s) => s.id === a.p_id)
      if (!old) throw new Error('Horário não encontrado.')
      const { closed, next } = editSchedule(
        old,
        {
          title: a.p_title,
          weekdays: a.p_weekdays,
          startTime: a.p_start,
          durationMin: a.p_duration,
        },
        a.p_effective,
        today,
        newId('sch'),
      )
      schedules = schedules.map((s) => (s.id === old.id ? closed : s)).concat(next)
      sessions = sessions.filter(
        (s) =>
          !(
            s.scheduleId === old.id &&
            s.status === 'prevista' &&
            localDate(s.startsAt) >= a.p_effective &&
            !presences.some((p) => p.sessionId === s.id)
          ),
      )
      extend()
      return next.id
    },
    end_schedule: (a) => {
      schedules = schedules.map((s) => (s.id === a.p_id ? { ...s, validUntil: a.p_last_day } : s))
      sessions = sessions.filter(
        (s) =>
          !(
            s.scheduleId === a.p_id &&
            s.status === 'prevista' &&
            localDate(s.startsAt) > a.p_last_day &&
            !presences.some((p) => p.sessionId === s.id)
          ),
      )
    },
    approve_member: (a) => {
      students = a.p_approve
        ? students.map((s) => (s.id === a.p_user ? { ...s, memberStatus: 'ativo' } : s))
        : students.filter((s) => s.id !== a.p_user)
    },
    update_settings: (a) => void (goal = a.p_goal),
    update_team: (a) =>
      void (team = { ...team, name: a.p_name, primaryColor: a.p_primary, accentColor: a.p_accent }),
    set_initial: (a) => {
      const s = student(a.p_student)
      Object.assign(
        s,
        setInitial(
          { ...s, attendances: [] },
          { id: prof.id, role: 'professor' },
          a.p_belt,
          a.p_degrees,
        ),
        { revision: s.revision + 1 },
      )
    },
    graduate_student: (a) => {
      const s = student(a.p_student)
      const next = graduate(
        { ...s, attendances: [] },
        { id: prof.id, role: 'professor' },
        a.p_kind,
        today,
        a.p_key,
      )
      s.kinds[a.p_key] = a.p_kind
      Object.assign(s, { events: next.events, revision: s.revision + 1 })
    },
    undo_graduation: (a) => {
      const s = student(a.p_student)
      Object.assign(s, {
        events: undoLast({ ...s, attendances: [] }, { id: prof.id, role: 'professor' }).events,
        revision: s.revision + 1,
      })
    },
  }
  return {
    photos: photoStore,
    load(as: 'aluno' | 'professor'): Dashboard {
      role = as
      const me =
        as === 'professor'
          ? professor
          : { id: 'lucas', name: 'Lucas Almeida', role: 'aluno' as const, revision: 0 }
      return {
        profile: me,
        team,
        status: 'ativo',
        students: (as === 'professor' ? students : students.filter((s) => s.id === 'lucas')).map(
          view,
        ),
        goal,
        today,
      }
    },
    async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      await new Promise((r) => setTimeout(r, 180))
      if (!navigator.onLine) throw new Error('Você está sem conexão.')
      const h = handlers[name]
      if (!h) throw new Error('Não disponível na demonstração.')
      return h(args) as T
    },
  }
}
export { zonedToUtc }
