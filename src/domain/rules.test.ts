import { describe, it, expect } from 'vitest'
import {
  todayInSaoPaulo,
  recordAttendance,
  counts,
  progress,
  graduate,
  undoLast,
  setInitial,
  canRead,
  type Student,
} from './rules'
const student = (): Student => ({ id: 'a', initial: null, attendances: [], events: [] })
const teacher = { id: 'p', role: 'professor' as const }
const aluno = { id: 'a', role: 'aluno' as const }
describe('presenças e permissões', () => {
  it('conta zero e impede duplicatas por aluno e data', () => {
    let s = student()
    expect(counts(s)).toEqual({ total: 0, cycle: 0 })
    s = recordAttendance(s, aluno, '2026-09-05', '2026-09-05')
    expect(recordAttendance(s, aluno, '2026-09-05', '2026-09-05').attendances).toHaveLength(1)
    expect(counts(s)).toEqual({ total: 1, cycle: 1 })
    expect(
      recordAttendance(
        { ...student(), id: 'b' },
        { id: 'b', role: 'aluno' },
        '2026-09-05',
        '2026-09-05',
      ).attendances,
    ).toHaveLength(1)
  })
  it('usa São Paulo na virada do dia', () => {
    expect(todayInSaoPaulo(new Date('2026-09-06T02:59:59Z'))).toBe('2026-09-05')
    expect(todayInSaoPaulo(new Date('2026-09-06T03:00:00Z'))).toBe('2026-09-06')
  })
  it('rejeita passado, futuro e presença de outro aluno', () => {
    for (const day of ['2026-09-04', '2026-09-06'])
      expect(() => recordAttendance(student(), aluno, day, '2026-09-05')).toThrow()
    expect(() =>
      recordAttendance(student(), { id: 'b', role: 'aluno' }, '2026-09-05', '2026-09-05'),
    ).toThrow()
  })
  it('professor corrige passado e hoje, nunca futuro; remoção recalcula', () => {
    const s = recordAttendance(student(), teacher, '2026-09-04', '2026-09-05')
    expect(counts(s).total).toBe(1)
    expect(counts({ ...s, attendances: [] }).total).toBe(0)
    expect(() => recordAttendance(s, teacher, '2026-09-06', '2026-09-05')).toThrow()
    expect(recordAttendance(s, teacher, '2026-09-05', '2026-09-05').attendances).toHaveLength(2)
  })
  it('limita leitura', () => {
    expect(canRead(aluno, 'a')).toBe(true)
    expect(canRead(aluno, 'b')).toBe(false)
    expect(canRead(teacher, 'b')).toBe(true)
    expect(canRead(null, 'a')).toBe(false)
  })
})
describe('meta', () => {
  it('é opcional e informativa, com progresso limitado visualmente', () => {
    expect(progress(10, null)).toBeNull()
    expect(progress(2, 10)).toEqual({ percent: 20, remaining: 8, reached: false })
    expect(progress(10, 10)).toEqual({ percent: 100, remaining: 0, reached: true })
    expect(progress(12, 10)).toEqual({ percent: 100, remaining: 0, reached: true })
  })
  it.each([0, -1, 1.5, NaN, Infinity])('rejeita meta %s', (n) =>
    expect(() => progress(0, n)).toThrow(),
  )
})
describe('graduação e ciclo', () => {
  it('concede abaixo da meta, preserva total e começa no próximo dia', () => {
    let s = recordAttendance(student(), aluno, '2026-09-05', '2026-09-05')
    s = graduate(s, teacher, 'grau', '2026-09-05', '1')
    expect(s.events[0].degrees).toBe(1)
    expect(counts(s)).toEqual({ total: 1, cycle: 0 })
    s = recordAttendance(s, teacher, '2026-09-04', '2026-09-06')
    s = recordAttendance(s, aluno, '2026-09-06', '2026-09-06')
    expect(counts(s)).toEqual({ total: 3, cycle: 1 })
  })
  it('reenvio de mesma operação não concede outro grau', () => {
    const s = graduate(student(), teacher, 'grau', '2026-09-05', '1')
    expect(graduate(s, teacher, 'grau', '2026-09-05', '1').events).toHaveLength(1)
  })
  it('impede quinto grau e graus da preta', () => {
    const s = setInitial(student(), teacher, 'branca', 4)
    expect(() => graduate(s, teacher, 'grau', '2026-09-05', '1')).toThrow()
    expect(() =>
      graduate(setInitial(student(), teacher, 'preta', 0), teacher, 'grau', '2026-09-05', '1'),
    ).toThrow()
  })
  it('avança faixas sem exigir quatro graus e não avança além da preta', () => {
    let s = student()
    for (const belt of ['azul', 'roxa', 'marrom', 'preta']) {
      s = graduate(s, teacher, 'faixa', '2026-09-05', belt)
      expect(s.events.at(-1)).toMatchObject({ belt, degrees: 0 })
      expect(counts(s).cycle).toBe(0)
    }
    expect(() => graduate(s, teacher, 'faixa', '2026-09-05', 'fim')).toThrow()
  })
  it('desfaz última graduação e restaura ciclo sem apagar presença', () => {
    let s = setInitial(student(), teacher, 'azul', 2)
    s = recordAttendance(s, teacher, '2026-09-01', '2026-09-05')
    s = graduate(s, teacher, 'grau', '2026-09-02', '1')
    s = recordAttendance(s, teacher, '2026-09-03', '2026-09-05')
    s = graduate(s, teacher, 'faixa', '2026-09-04', '2')
    s = undoLast(s, teacher)
    expect(s.events.filter((e) => !e.cancelled).at(-1)).toMatchObject({ belt: 'azul', degrees: 3 })
    expect(counts(s)).toEqual({ total: 2, cycle: 1 })
    s = undoLast(s, teacher)
    expect(counts(s)).toEqual({ total: 2, cycle: 2 })
    expect(() => undoLast(s, teacher)).toThrow()
  })
  it('situação inicial uma vez e antes da primeira graduação', () => {
    const s = setInitial(student(), teacher, 'roxa', 3)
    expect(s.initial).toEqual({ belt: 'roxa', degrees: 3, note: null })
    expect(s.events).toHaveLength(0)
    expect(counts(s).total).toBe(0)
    expect(() => setInitial(s, teacher, 'azul', 0)).toThrow()
    expect(() =>
      setInitial(graduate(student(), teacher, 'grau', '2026-09-05', '1'), teacher, 'azul', 0),
    ).toThrow()
  })
  it.each([-1, 5, 0.5])('rejeita graus iniciais %s', (n) =>
    expect(() => setInitial(student(), teacher, 'branca', n)).toThrow(),
  )
  it('rejeita grau inicial na preta', () =>
    expect(() => setInitial(student(), teacher, 'preta', 1)).toThrow())
  it('aluno não altera graduação', () => {
    expect(() => graduate(student(), aluno, 'grau', '2026-09-05', '1')).toThrow()
    expect(() => setInitial(student(), aluno, 'azul', 0)).toThrow()
    expect(() => undoLast(student(), aluno)).toThrow()
  })
})
