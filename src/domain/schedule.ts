export const TIME_ZONE = 'America/Sao_Paulo'
export type Schedule = {
  id: string
  teamId: string
  title: string
  weekdays: number[] // 0 = domingo ... 6 = sábado
  startTime: string // HH:MM, horário de São Paulo
  durationMin: number
  validFrom: string // AAAA-MM-DD
  validUntil: string | null
}
export type SessionStatus = 'prevista' | 'cancelada' | 'realizada'
export type Session = {
  id?: string
  teamId: string
  scheduleId: string | null
  title: string
  startsAt: string // ISO UTC
  durationMin: number
  status: SessionStatus
  description?: string
  cancelReason?: string
}

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
export function localDate(iso: string | Date): string {
  const p = parts(new Date(iso))
  return `${p.year}-${p.month}-${p.day}`
}
export function localTime(iso: string | Date): string {
  const p = parts(new Date(iso))
  return `${p.hour}:${p.minute}`
}
/** Converte data + hora de São Paulo para ISO UTC, respeitando o deslocamento vigente. */
export function zonedToUtc(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`)
  const p = parts(guess)
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return new Date(guess.getTime() - (asLocal - guess.getTime())).toISOString()
}
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay()

export function validateSchedule(s: Schedule): void {
  if (!s.title.trim()) throw new Error('Informe o nome da aula.')
  if (
    !s.weekdays.length ||
    new Set(s.weekdays).size !== s.weekdays.length ||
    s.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw new Error('Escolha os dias da semana.')
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.startTime)
  if (!m) throw new Error('Horário inválido.')
  if (!Number.isInteger(s.durationMin) || s.durationMin < 15 || s.durationMin > 300)
    throw new Error('A duração deve ficar entre 15 e 300 minutos.')
  if (s.validUntil !== null && s.validUntil < s.validFrom)
    throw new Error('O fim da vigência deve ser depois do início.')
}

export function generateSessions(
  schedules: Schedule[],
  from: string,
  until: string,
  existing: Session[],
): Session[] {
  const taken = new Set(existing.map((e) => `${e.scheduleId}|${e.startsAt}`))
  const out: Session[] = []
  for (const s of schedules) {
    validateSchedule(s)
    const start = from > s.validFrom ? from : s.validFrom
    const end = s.validUntil && s.validUntil < until ? s.validUntil : until
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!s.weekdays.includes(weekday(d))) continue
      const startsAt = zonedToUtc(d, s.startTime)
      if (taken.has(`${s.id}|${startsAt}`)) continue
      taken.add(`${s.id}|${startsAt}`)
      out.push({
        teamId: s.teamId,
        scheduleId: s.id,
        title: s.title,
        startsAt,
        durationMin: s.durationMin,
        status: 'prevista',
      })
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

export function editSchedule(
  old: Schedule,
  changes: Partial<Omit<Schedule, 'id' | 'teamId' | 'validFrom'>>,
  effectiveFrom: string,
  today: string,
  newId: string,
): { closed: Schedule; next: Schedule } {
  if (effectiveFrom <= today) throw new Error('A mudança só pode valer a partir de amanhã.')
  const next: Schedule = {
    ...old,
    ...changes,
    id: newId,
    validFrom: effectiveFrom,
  }
  validateSchedule(next)
  return { closed: { ...old, validUntil: addDays(effectiveFrom, -1) }, next }
}

export function cancelSession(s: Session, reason: string, now: Date): Session {
  if (s.status !== 'prevista') throw new Error('Esta aula não pode ser cancelada.')
  if (now.getTime() >= new Date(s.startsAt).getTime())
    throw new Error('Não é possível cancelar uma aula que já começou.')
  return { ...s, status: 'cancelada', cancelReason: reason.trim() }
}
