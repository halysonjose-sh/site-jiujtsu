export type Belt = 'branca' | 'azul' | 'roxa' | 'marrom' | 'preta'
export type Actor = { id: string; role: 'aluno' | 'professor' }
export type Graduation = {
  id: string
  date: string
  belt: Belt
  degrees: number
  cancelled?: boolean
}
export type Student = {
  id: string
  initial: { belt: Belt; degrees: number } | null
  attendances: string[]
  events: Graduation[]
}
export const belts: Belt[] = ['branca', 'azul', 'roxa', 'marrom', 'preta']
export function todayInSaoPaulo(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
export function canRead(actor: Actor | null, studentId: string): boolean {
  return !!actor && (actor.role === 'professor' || actor.id === studentId)
}
function requireTeacher(actor: Actor) {
  if (actor.role !== 'professor') throw new Error('Somente o professor pode fazer isso.')
}
export function recordAttendance(
  s: Student,
  actor: Actor,
  date: string,
  serverToday: string,
): Student {
  if (
    !canRead(actor, s.id) ||
    date > serverToday ||
    (actor.role === 'aluno' && date !== serverToday)
  )
    throw new Error('Presença não permitida.')
  return { ...s, attendances: [...new Set([...s.attendances, date])] }
}
export function counts(s: Student): { total: number; cycle: number } {
  const last = s.events.filter((e) => !e.cancelled).at(-1)
  const dates = [...new Set(s.attendances)]
  return { total: dates.length, cycle: dates.filter((d) => !last || d > last.date).length }
}
export function progress(count: number, goal: number | null) {
  if (goal === null) return null
  if (!Number.isInteger(goal) || goal <= 0)
    throw new Error('Informe uma meta inteira maior que zero.')
  return {
    percent: Math.min(100, Math.round((count / goal) * 100)),
    remaining: Math.max(0, goal - count),
    reached: count >= goal,
  }
}
export function currentRank(s: Student) {
  return (
    s.events.filter((e) => !e.cancelled).at(-1) ??
    s.initial ?? { belt: 'branca' as Belt, degrees: 0 }
  )
}
export function graduate(
  s: Student,
  actor: Actor,
  kind: 'grau' | 'faixa',
  date: string,
  key: string,
): Student {
  requireTeacher(actor)
  if (s.events.some((e) => e.id === key)) return s
  let { belt, degrees } = currentRank(s)
  if (kind === 'grau') {
    if (belt === 'preta' || degrees >= 4)
      throw new Error('Não é possível conceder outro grau nesta faixa.')
    degrees++
  } else {
    if (belt === 'preta') throw new Error('A faixa preta encerra as promoções nesta versão.')
    belt = belts[belts.indexOf(belt) + 1]
    degrees = 0
  }
  return { ...s, events: [...s.events, { id: key, date, belt, degrees }] }
}
export function undoLast(s: Student, actor: Actor): Student {
  requireTeacher(actor)
  const last = s.events.filter((e) => !e.cancelled).at(-1)
  if (!last) throw new Error('Não há graduação para desfazer.')
  return { ...s, events: s.events.map((e) => (e.id === last.id ? { ...e, cancelled: true } : e)) }
}
export function setInitial(s: Student, actor: Actor, belt: Belt, degrees: number): Student {
  requireTeacher(actor)
  if (s.initial || s.events.length)
    throw new Error('A situação inicial já foi definida ou existe uma graduação.')
  if (
    !Number.isInteger(degrees) ||
    degrees < 0 ||
    degrees > 4 ||
    (belt === 'preta' && degrees !== 0)
  )
    throw new Error('Graus inválidos para esta faixa.')
  return { ...s, initial: { belt, degrees } }
}
