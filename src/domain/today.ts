import { localDate } from './schedule'

export type StatusPresenca = 'pendente' | 'confirmada' | 'rejeitada'
export type StatusSessao = 'prevista' | 'cancelada' | 'realizada'

/** Aula do dia: tudo que a tela Hoje precisa de uma sessão. */
export type SessaoHoje = {
  id: string
  title: string
  startsAt: string
  status: StatusSessao
  pending: number | null
  confirmed: number | null
}

/** Linha da folha de chamada: aluno com registro na aula ou da turma. */
export type LinhaChamada = { id: string; name: string; status: StatusPresenca | null }

/** Passo de desfazer: uma chamada RPC com os argumentos prontos. */
export type PassoChamada = { rpc: string; args: Record<string, unknown> }

/** Aulas de hoje em ordem de horário; canceladas vão para o fim. */
export function sessionsOfToday<T extends { startsAt: string; status: StatusSessao }>(
  list: T[],
  today: string,
): T[] {
  const doDia = list.filter((x) => localDate(x.startsAt) === today)
  const porHorario = (a: T, b: T) => a.startsAt.localeCompare(b.startsAt)
  return [
    ...doDia.filter((x) => x.status !== 'cancelada').sort(porHorario),
    ...doDia.filter((x) => x.status === 'cancelada').sort(porHorario),
  ]
}

/** Total de presenças a revisar entre as aulas do dia. */
export function reviewCount(list: { pending: number | null }[]): number {
  return list.reduce((total, x) => total + (x.pending ?? 0), 0)
}

/** Quem tem registro primeiro (ordem da aula), resto da turma alfabético. */
export function callRows(
  students: { id: string; name: string; status: StatusPresenca | null }[],
  roster: { id: string; name: string }[],
): LinhaChamada[] {
  const comRegistro = students.map(({ id, name, status }) => ({ id, name, status }))
  const presentes = new Set(students.map((x) => x.id))
  const resto = roster
    .filter((x) => !presentes.has(x.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(({ id, name }) => ({ id, name, status: null as StatusPresenca | null }))
  return [...comRegistro, ...resto]
}

/** Diferença entre o estado inicial da folha e o que ficou marcado. */
export function callChanges(initial: LinhaChamada[], marked: Set<string>) {
  const confirm: string[] = []
  const remove: string[] = []
  const reject: string[] = []
  for (const { id, status } of initial) {
    if (marked.has(id)) {
      if (status !== 'confirmada') confirm.push(id)
    } else if (status === 'confirmada') {
      remove.push(id)
    } else if (status === 'pendente') {
      // Pendente deixado desmarcado é recusa registrada; sem isso o contador
      // "a revisar" nunca zera.
      reject.push(id)
    }
  }
  return { confirm, remove, reject }
}

/**
 * Inverso de callChanges: passos RPC que restauram o estado inicial.
 * Devolve null quando o estado inicial não é restaurável: produção não tem RPC
 * que volte a 'pendente' (review_presence só aceita 'confirmada' e 'rejeitada'
 * — migration 202609250001), então qualquer mudança envolvendo check-in
 * pendente fica sem Desfazer.
 */
export function callUndo(
  initial: LinhaChamada[],
  changes: { confirm: string[]; remove: string[]; reject: string[] },
  sessionId: string,
): PassoChamada[] | null {
  if (changes.reject.length) return null
  const antes = new Map(initial.map((a) => [a.id, a.status]))
  const passos: PassoChamada[] = []
  for (const id of changes.confirm) {
    const status = antes.get(id) ?? null
    if (status === 'pendente') return null
    passos.push(
      status === null
        ? { rpc: 'teacher_remove_presence', args: { p_session: sessionId, p_student: id } }
        : {
            // 'rejeitada' é decisão válida de review_presence.
            rpc: 'review_presence',
            args: { p_session: sessionId, p_student: id, p_decision: status },
          },
    )
  }
  for (const id of changes.remove) {
    passos.push({ rpc: 'teacher_add_presence', args: { p_session: sessionId, p_student: id } })
  }
  return passos
}

/** Contadores da badge da aba Hoje. */
export function summarizeToday(
  sessions: { pending: number | null }[],
  pendingMembers: unknown[],
): { reviews: number; approvals: number } {
  return { reviews: reviewCount(sessions), approvals: pendingMembers.length }
}
