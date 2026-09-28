/** Frequência: percentual de presença e sequência atual de treinos. */

/**
 * Percentual de presença: presenças confirmadas ÷ aulas que aconteceram
 * desde a entrada do aluno. Sem aulas realizadas, não há percentual (null) —
 * não inventa 0% nem 100% para quem acabou de entrar.
 */
export function frequencyRate(present: number, held: number): number | null {
  if (!Number.isInteger(present) || !Number.isInteger(held) || present < 0 || held < 0)
    throw new Error('Contagens de frequência inválidas.')
  if (present > held) throw new Error('Mais presenças do que aulas realizadas.')
  if (held === 0) return null
  return Math.round((present / held) * 100)
}

/**
 * Sequência atual de treinos: dias consecutivos de presença terminando no
 * último treino do aluno. Não exige presença hoje — a sequência vale até o
 * próximo treino acontecer; quebra quando passa um dia sem treino registrado
 * depois do último. Retorna 0 sem presenças.
 */
export function streak(dates: string[], today: string): number {
  const unicas = [...new Set(dates)].sort()
  if (unicas.length === 0) return 0
  const dia = (d: string) => new Date(d + 'T12:00:00Z').getTime()
  const DIA = 86400000
  const ultimo = unicas[unicas.length - 1]
  // Sequência encerrada: último treino é de antes de ontem.
  if (dia(today) - dia(ultimo) > DIA) return 0
  let n = 1
  for (let i = unicas.length - 1; i > 0; i--) {
    if (dia(unicas[i]) - dia(unicas[i - 1]) !== DIA) break
    n++
  }
  return n
}
