export type CalendarDay = { date: string; inMonth: boolean }
export const MAX_PHOTOS = 20

function parseMonth(month: string): [number, number] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!m) throw new Error('Mês inválido.')
  return [Number(m[1]), Number(m[2])]
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Grade fixa de 6 semanas (domingo a sábado) que contém o mês AAAA-MM. */
export function monthGrid(month: string): CalendarDay[] {
  const [y, m] = parseMonth(month)
  const first = new Date(Date.UTC(y, m - 1, 1, 12))
  const start = new Date(first)
  start.setUTCDate(1 - first.getUTCDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    return { date: iso(d), inMonth: d.getUTCMonth() === m - 1 }
  })
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parseMonth(month)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12))
  return iso(d).slice(0, 7)
}
export function sessionPhotoPath(teamId: string, sessionId: string, id: string): string {
  return `${teamId}/${sessionId}/${id}.jpg`
}
export function isSessionPhotoPath(path: string, teamId: string, sessionId: string): boolean {
  const prefix = `${teamId}/${sessionId}/`
  if (!path.startsWith(prefix)) return false
  return /^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|webp)$/.test(path.slice(prefix.length))
}
