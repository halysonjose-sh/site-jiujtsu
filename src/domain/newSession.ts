import { localDate, zonedToUtc, type SessionStatus } from './schedule'
import { MAX_PHOTOS } from './calendar'

export type NewSessionInput = {
  title: string
  date: string // AAAA-MM-DD (São Paulo)
  time: string // HH:MM (São Paulo)
  durationMin: number
  description: string
  photoCount: number
  presentCount: number
}
export type NewSessionPlan = { startsAt: string | null; past: boolean; errors: string[] }
type Slot = {
  id: string
  title: string
  startsAt: string
  durationMin: number
  status: SessionStatus
}

const validDate = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const x = new Date(d + 'T12:00:00Z')
  return !isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d
}
const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Valida o cadastro de uma aula e diz se ela já começou (liberando fotos e presenças). */
export function planNewSession(input: NewSessionInput, now: Date): NewSessionPlan {
  const errors: string[] = []
  const title = input.title.trim()
  if (title.length < 2) errors.push('Informe o nome da aula.')
  else if (title.length > 80) errors.push('O nome pode ter até 80 caracteres.')
  if (!Number.isInteger(input.durationMin) || input.durationMin < 15 || input.durationMin > 300)
    errors.push('A duração deve ficar entre 15 e 300 minutos.')
  if (input.description.length > 2000) errors.push('A descrição pode ter até 2000 caracteres.')
  const dateOk = validDate(input.date)
  if (!dateOk) errors.push('Informe uma data válida.')
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
  if (!timeOk) errors.push('Informe um horário válido.')
  if (!dateOk || !timeOk) return { startsAt: null, past: false, errors }

  if (input.date > addDays(localDate(now), 365)) errors.push('Escolha uma data até 1 ano à frente.')
  const startsAt = zonedToUtc(input.date, input.time)
  const past = new Date(startsAt).getTime() <= now.getTime()
  if (!past && input.presentCount > 0)
    errors.push('Presenças só podem ser registradas em aulas que já começaram.')
  if (input.photoCount > MAX_PHOTOS) errors.push(`Limite de ${MAX_PHOTOS} fotos por aula.`)
  return { startsAt, past, errors }
}

/** Aulas não canceladas cujo horário se sobrepõe ao novo (aviso, não bloqueia). */
export function overlapping<T extends Slot>(
  existing: T[],
  startsAt: string,
  durationMin: number,
): T[] {
  const start = new Date(startsAt).getTime(),
    end = start + durationMin * 60000
  return existing.filter((s) => {
    if (s.status === 'cancelada') return false
    const a = new Date(s.startsAt).getTime(),
      b = a + s.durationMin * 60000
    return a < end && start < b
  })
}
