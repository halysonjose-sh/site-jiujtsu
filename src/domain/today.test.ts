import { describe, it, expect } from 'vitest'
import {
  sessionsOfToday,
  reviewCount,
  callRows,
  callChanges,
  callUndo,
  summarizeToday,
} from './today'
import { zonedToUtc } from './schedule'

const HOJE = '2026-09-25'
type Sessao = {
  id: string
  startsAt: string
  status: 'prevista' | 'cancelada' | 'realizada'
  pending: number | null
}
const s = (
  id: string,
  iso: string,
  status: Sessao['status'] = 'prevista',
  pending: number | null = null,
): Sessao => ({ id, startsAt: iso, status, pending })

describe('sessionsOfToday', () => {
  it('compara a data de São Paulo, não a UTC', () => {
    // 00:30 SP de hoje = 03:30 UTC no mesmo dia
    // 22:00 SP de hoje = 01:00 UTC do dia seguinte
    // 23:30 SP de ontem = 02:30 UTC de hoje (precisa ficar de fora)
    const aulas = [
      s('b', '2026-09-26T01:00:00Z'),
      s('a', '2026-09-25T03:30:00Z'),
      s('c', zonedToUtc('2026-09-24', '23:30')),
    ]
    expect(sessionsOfToday(aulas, HOJE).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('ordena por horário e deixa cancelada por último', () => {
    const aulas = [
      s('d', '2026-09-25T13:00:00Z', 'cancelada'),
      s('b', '2026-09-26T01:00:00Z'),
      s('a', '2026-09-25T13:00:00Z'),
    ]
    expect(sessionsOfToday(aulas, HOJE).map((x) => x.id)).toEqual(['a', 'b', 'd'])
  })
})
describe('reviewCount', () => {
  it('soma pendentes e ignora null', () => {
    expect(reviewCount([s('a', 'x', 'prevista', 2), s('b', 'x', 'prevista', null)])).toBe(2)
  })
})
describe('callRows', () => {
  it('traz quem tem registro primeiro e completa o resto em ordem alfabética, sem duplicar', () => {
    const linhas = callRows(
      [
        { id: 's2', name: 'Bruna', status: 'pendente' },
        { id: 's1', name: 'Ana', status: 'confirmada' },
      ],
      [
        { id: 's3', name: 'Carla' },
        { id: 's1', name: 'Ana' },
      ],
    )
    expect(linhas).toEqual([
      { id: 's2', name: 'Bruna', status: 'pendente' },
      { id: 's1', name: 'Ana', status: 'confirmada' },
      { id: 's3', name: 'Carla', status: null },
    ])
  })
})
describe('callChanges', () => {
  const base = [
    { id: 's1', name: 'Ana', status: 'confirmada' as const },
    { id: 's2', name: 'Bruna', status: 'pendente' as const },
    { id: 's3', name: 'Carla', status: null },
    { id: 's4', name: 'Duda', status: 'rejeitada' as const },
  ]
  it('confirma marcados que não estavam confirmados', () => {
    const c = callChanges(base, new Set(['s1', 's2', 's3', 's4']))
    expect(c.confirm).toEqual(['s2', 's3', 's4'])
    expect(c.remove).toEqual([])
    expect(c.reject).toEqual([])
  })
  it('remove confirmado desmarcado e rejeita pendente desmarcado', () => {
    const c = callChanges(base, new Set())
    expect(c.confirm).toEqual([])
    expect(c.remove).toEqual(['s1'])
    expect(c.reject).toEqual(['s2'])
  })
  it('ignora desmarcado sem registro ou já rejeitado', () => {
    const c = callChanges(
      [
        { id: 's1', name: 'Ana', status: 'confirmada' as const },
        { id: 's3', name: 'Carla', status: null },
        { id: 's4', name: 'Duda', status: 'rejeitada' as const },
      ],
      new Set(['s1']),
    )
    expect(c.reject).toEqual([])
    expect(c.remove).toEqual([])
    expect(c.confirm).toEqual([])
  })
})
describe('callUndo', () => {
  const base = [
    { id: 's1', name: 'Ana', status: 'confirmada' as const },
    { id: 's2', name: 'Bruna', status: 'pendente' as const },
    { id: 's3', name: 'Carla', status: null },
    { id: 's4', name: 'Duda', status: 'rejeitada' as const },
  ]
  it('devolve null quando algo envolve check-in pendente', () => {
    // Produção não tem RPC que volte a 'pendente' (review_presence só aceita
    // 'confirmada' e 'rejeitada'): nem pendente confirmado nem pendente
    // rejeitado pode ser desfeito.
    expect(callUndo(base, callChanges(base, new Set(['s1', 's2', 's3', 's4'])), 'aula1')).toBeNull()
    expect(callUndo(base, callChanges(base, new Set()), 'aula1')).toBeNull()
  })
  it('restaura sem registro com remoção e rejeitada com review_presence', () => {
    // Folha sem pendente: é o único caso restaurável (toda pendente marcada
    // ou desmarcada torna o undo impossível).
    const initial = [
      { id: 's1', name: 'Ana', status: 'confirmada' as const },
      { id: 's3', name: 'Carla', status: null },
      { id: 's4', name: 'Duda', status: 'rejeitada' as const },
    ]
    const changes = callChanges(initial, new Set(['s3', 's4']))
    expect(callUndo(initial, changes, 'aula1')).toEqual([
      { rpc: 'teacher_remove_presence', args: { p_session: 'aula1', p_student: 's3' } },
      {
        rpc: 'review_presence',
        args: { p_session: 'aula1', p_student: 's4', p_decision: 'rejeitada' },
      },
      { rpc: 'teacher_add_presence', args: { p_session: 'aula1', p_student: 's1' } },
    ])
  })
  it('devolve presença confirmada removida', () => {
    const initial = [{ id: 's1', name: 'Ana', status: 'confirmada' as const }]
    const changes = callChanges(initial, new Set())
    expect(callUndo(initial, changes, 'aula1')).toEqual([
      { rpc: 'teacher_add_presence', args: { p_session: 'aula1', p_student: 's1' } },
    ])
  })
})
describe('summarizeToday', () => {
  it('conta presenças a revisar e aprovações pendentes', () => {
    const resumo = summarizeToday([s('a', 'x', 'prevista', 2), s('b', 'x', 'prevista', null)], [
      { id: 'm1' },
      { id: 'm2' },
    ])
    expect(resumo).toEqual({ reviews: 2, approvals: 2 })
  })
})
