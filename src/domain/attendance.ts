import type { Graduation } from './rules'
import { localDate, type Session } from './schedule'

export const CHECKIN_DEADLINE_MIN = 60
export type PresenceStatus = 'pendente' | 'confirmada' | 'rejeitada'
export type Presence = {
  sessionId: string
  studentId: string
  date: string // data da aula em São Paulo
  status: PresenceStatus
  source: 'checkin' | 'professor'
  photoPath?: string
  reviewedAt?: string
}
export type Actor = {
  id: string
  teamId: string
  role: 'aluno' | 'professor' | 'dono'
}

const staff = (a: Actor) => a.role === 'professor' || a.role === 'dono'
const sid = (s: Session) => {
  if (!s.id) throw new Error('Aula sem identificador.')
  return s.id
}
const find = (list: Presence[], s: Session, student: string) =>
  list.find((p) => p.sessionId === sid(s) && p.studentId === student)
const without = (list: Presence[], s: Session, student: string) =>
  list.filter((p) => !(p.sessionId === sid(s) && p.studentId === student))
function requireStaff(a: Actor, s: Session) {
  if (!staff(a) || a.teamId !== s.teamId) throw new Error('Somente o professor pode fazer isso.')
}
const started = (s: Session, now: Date) => now.getTime() >= new Date(s.startsAt).getTime()

export function checkInDeadline(s: Session): Date {
  return new Date(new Date(s.startsAt).getTime() - CHECKIN_DEADLINE_MIN * 60000)
}
function requireCheckInWindow(s: Session, a: Actor, now: Date) {
  if (a.role !== 'aluno' || a.teamId !== s.teamId) throw new Error('Check-in não permitido.')
  if (s.status !== 'prevista') throw new Error('Esta aula não está aberta para check-in.')
  if (now.getTime() > checkInDeadline(s).getTime())
    throw new Error('O check-in fecha 1 hora antes do treino.')
}

export function checkIn(list: Presence[], s: Session, a: Actor, now: Date): Presence[] {
  requireCheckInWindow(s, a, now)
  if (find(list, s, a.id)) return list
  return [
    ...list,
    {
      sessionId: sid(s),
      studentId: a.id,
      date: localDate(s.startsAt),
      status: 'pendente',
      source: 'checkin',
    },
  ]
}
export function cancelCheckIn(list: Presence[], s: Session, a: Actor, now: Date): Presence[] {
  requireCheckInWindow(s, a, now)
  return without(list, s, a.id)
}

export function reviewPresence(
  list: Presence[],
  s: Session,
  a: Actor,
  student: string,
  decision: 'confirmada' | 'rejeitada',
  now: Date,
): Presence[] {
  requireStaff(a, s)
  if (!started(s, now)) throw new Error('A presença só pode ser revisada depois do início da aula.')
  const p = find(list, s, student)
  if (!p) throw new Error('O aluno não tem check-in nesta aula.')
  return list.map((x) => (x === p ? { ...x, status: decision, reviewedAt: now.toISOString() } : x))
}

export function teacherAddPresence(
  list: Presence[],
  s: Session,
  a: Actor,
  student: string,
  now: Date,
): Presence[] {
  requireStaff(a, s)
  if (s.status === 'cancelada') throw new Error('Aula cancelada.')
  if (!started(s, now)) throw new Error('Só é possível lançar presença depois do início da aula.')
  const p = find(list, s, student)
  const reviewedAt = now.toISOString()
  if (p) return list.map((x) => (x === p ? { ...x, status: 'confirmada', reviewedAt } : x))
  return [
    ...list,
    {
      sessionId: sid(s),
      studentId: student,
      date: localDate(s.startsAt),
      status: 'confirmada',
      source: 'professor',
      reviewedAt,
    },
  ]
}
export function teacherRemovePresence(
  list: Presence[],
  s: Session,
  a: Actor,
  student: string,
): Presence[] {
  requireStaff(a, s)
  return without(list, s, student)
}

export function attachPhoto(
  list: Presence[],
  s: Session,
  a: Actor,
  path: string,
  now: Date,
): Presence[] {
  if (a.role !== 'aluno' || a.teamId !== s.teamId) throw new Error('Foto não permitida.')
  if (!path.startsWith(`${s.teamId}/${a.id}/`)) throw new Error('Local da foto inválido.')
  if (localDate(now) !== localDate(s.startsAt))
    throw new Error('A foto só pode ser enviada no dia da aula.')
  const p = find(list, s, a.id)
  if (!p) throw new Error('Faça o check-in antes de enviar a foto.')
  if (p.status !== 'pendente') throw new Error('Esta presença já foi revisada.')
  return list.map((x) => (x === p ? { ...x, photoPath: path } : x))
}

export function countPresences(
  list: Presence[],
  student: string,
  events: Graduation[],
): { total: number; cycle: number } {
  const last = events.filter((e) => !e.cancelled).at(-1)
  const ok = list.filter((p) => p.studentId === student && p.status === 'confirmada')
  return {
    total: ok.length,
    cycle: ok.filter((p) => !last || p.date > last.date).length,
  }
}

export function photosToPurge(list: Presence[], retentionDays: number, now: Date): string[] {
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new Error('Informe um prazo em dias maior que zero.')
  const limit = now.getTime() - retentionDays * 86400000
  return list
    .filter(
      (p) =>
        p.photoPath &&
        p.status !== 'pendente' &&
        p.reviewedAt &&
        new Date(p.reviewedAt).getTime() < limit,
    )
    .map((p) => p.photoPath as string)
}
