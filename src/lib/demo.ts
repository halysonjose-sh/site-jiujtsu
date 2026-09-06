import {
  counts,
  currentRank,
  graduate,
  recordAttendance,
  setInitial,
  todayInSaoPaulo,
  undoLast,
  type Student,
  type Belt,
} from '../domain/rules'
import type { Dashboard, StudentView, RankEvent } from './api'
type DemoStudent = Student & {
  name: string
  revision: number
  kinds: Record<string, 'grau' | 'faixa'>
}
const professor = {
  id: 'professor-demo',
  name: 'Rafael Costa',
  role: 'professor' as const,
  revision: 0,
}
export function createDemo() {
  const today = todayInSaoPaulo(new Date())
  const dates = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(today + 'T12:00:00Z')
      d.setUTCDate(d.getUTCDate() - (i + 1) * 2)
      return d.toISOString().slice(0, 10)
    })
  let students: DemoStudent[] = [
    {
      id: 'lucas',
      name: 'Lucas Almeida',
      revision: 0,
      initial: { belt: 'azul', degrees: 1 },
      events: [],
      attendances: dates(21),
      kinds: {},
    },
    {
      id: 'marina',
      name: 'Marina Santos',
      revision: 0,
      initial: { belt: 'branca', degrees: 3 },
      events: [],
      attendances: dates(30),
      kinds: {},
    },
    {
      id: 'pedro',
      name: 'Pedro Oliveira',
      revision: 0,
      initial: null,
      events: [],
      attendances: dates(8),
      kinds: {},
    },
  ]
  let goal: number | null = 30
  const view = (s: DemoStudent): StudentView => ({
    ...s,
    belt: currentRank(s).belt,
    degrees: currentRank(s).degrees,
    ...counts(s),
    role: 'aluno',
    today: todayInSaoPaulo(new Date()),
    initialSet: !!s.initial || s.events.length > 0,
    attendances: [...s.attendances].sort().reverse(),
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
                date: dates(45).at(-1)!,
                cancelled: false,
              } as RankEvent,
            ]
          : [],
      ),
  })
  return {
    load(role: 'aluno' | 'professor'): Dashboard {
      return {
        profile:
          role === 'professor'
            ? professor
            : { id: 'lucas', name: 'Lucas Almeida', role: 'aluno', revision: 0 },
        students: (role === 'professor' ? students : students.filter((s) => s.id === 'lucas')).map(
          view,
        ),
        goal,
        today: todayInSaoPaulo(new Date()),
      }
    },
    async mutate(name: string, args: Record<string, unknown> = {}) {
      await new Promise((r) => setTimeout(r, 220))
      if (!navigator.onLine) throw new Error('Você está sem conexão.')
      if (name === 'update_settings') {
        goal = args.p_goal as number | null
        return
      }
      const id = (args.p_student as string) || 'lucas'
      const s = students.find((s) => s.id === id)!
      let next: Student = s
      const day = todayInSaoPaulo(new Date())
      if (name === 'mark_attendance')
        next = recordAttendance(s, { id: 'lucas', role: 'aluno' }, day, day)
      if (name === 'correct_attendance')
        next =
          args.p_action === 'remove'
            ? { ...s, attendances: s.attendances.filter((d) => d !== args.p_date) }
            : recordAttendance(s, professor, args.p_date as string, day)
      if (name === 'set_initial')
        next = setInitial(s, professor, args.p_belt as Belt, args.p_degrees as number)
      if (name === 'graduate_student') {
        next = graduate(s, professor, args.p_kind as 'grau' | 'faixa', day, args.p_key as string)
        s.kinds[args.p_key as string] = args.p_kind as 'grau' | 'faixa'
      }
      if (name === 'undo_graduation') next = undoLast(s, professor)
      students = students.map((item) =>
        item.id === id ? { ...s, ...next, revision: s.revision + 1 } : item,
      )
    },
  }
}
