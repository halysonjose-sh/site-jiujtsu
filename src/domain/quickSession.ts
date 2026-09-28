import type { ScheduleView } from '../lib/api'

export type HorarioFrequente = { title: string; start: string; durationMin: number }

/**
 * Horários frequentes para os chips da folha "+ Aula": só horários padrão em
 * vigor hoje, deduplicados por horário+duração (o título repetido não ajuda),
 * ordenados pelo horário. Lista vazia quando a equipe não tem horários.
 */
export function horariosFrequentes(schedules: ScheduleView[], today: string): HorarioFrequente[] {
  const vigen = schedules.filter(
    (s) => s.validFrom <= today && (!s.validUntil || s.validUntil >= today),
  )
  const vistos = new Set<string>()
  const ops: HorarioFrequente[] = []
  for (const s of [...vigen].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const chave = `${s.startTime}|${s.durationMin}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    ops.push({ title: s.title, start: s.startTime, durationMin: s.durationMin })
  }
  return ops
}
