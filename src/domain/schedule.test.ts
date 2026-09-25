import { describe, it, expect } from 'vitest'
import {
  validateSchedule,
  generateSessions,
  editSchedule,
  cancelSession,
  localDate,
  localTime,
  type Schedule,
  type Session,
} from './schedule'

// 2026-09-28 é segunda-feira.
const base: Schedule = {
  id: 's1',
  teamId: 't1',
  title: 'Jiu-jítsu adulto',
  weekdays: [1, 3, 5],
  startTime: '07:00',
  durationMin: 60,
  validFrom: '2026-09-28',
  validUntil: null,
}

describe('validação de aula padrão', () => {
  it('aceita seg/qua/sex às 7h por 60 min', () =>
    expect(() => validateSchedule(base)).not.toThrow())
  it.each([
    ['sem dias', { weekdays: [] }],
    ['dia inválido', { weekdays: [7] }],
    ['dia repetido', { weekdays: [1, 1] }],
    ['hora inválida', { startTime: '25:00' }],
    ['formato de hora', { startTime: '7h' }],
    ['duração curta', { durationMin: 10 }],
    ['duração longa', { durationMin: 400 }],
    ['fim antes do início', { validUntil: '2026-09-27' }],
    ['título vazio', { title: '  ' }],
  ])('rejeita %s', (_, change) =>
    expect(() => validateSchedule({ ...base, ...change } as Schedule)).toThrow(),
  )
})

describe('geração de aulas', () => {
  it('gera as ocorrências da semana no horário de São Paulo', () => {
    const out = generateSessions([base], '2026-09-28', '2026-10-04', [])
    expect(out.map((s) => localDate(s.startsAt))).toEqual([
      '2026-09-28',
      '2026-09-30',
      '2026-10-02',
    ])
    expect(out.every((s) => localTime(s.startsAt) === '07:00')).toBe(true)
    expect(out[0].startsAt).toBe('2026-09-28T10:00:00.000Z')
    expect(out[0]).toMatchObject({
      scheduleId: 's1',
      teamId: 't1',
      status: 'prevista',
      durationMin: 60,
    })
  })
  it('é idempotente: não duplica aulas já existentes', () => {
    const first = generateSessions([base], '2026-09-28', '2026-10-04', [])
    expect(generateSessions([base], '2026-09-28', '2026-10-04', first)).toEqual([])
  })
  it('não recria aula cancelada', () => {
    const [first, ...rest] = generateSessions([base], '2026-09-28', '2026-10-04', [])
    const existing = [{ ...first, status: 'cancelada' as const }, ...rest]
    expect(generateSessions([base], '2026-09-28', '2026-10-04', existing)).toEqual([])
  })
  it('respeita início e fim de vigência', () => {
    const s = { ...base, validFrom: '2026-09-30', validUntil: '2026-10-01' }
    expect(
      generateSessions([s], '2026-09-28', '2026-10-04', []).map((x) => localDate(x.startsAt)),
    ).toEqual(['2026-09-30'])
  })
  it('combina vários horários padrão da mesma equipe', () => {
    const noite = { ...base, id: 's2', weekdays: [2], startTime: '19:30' }
    expect(generateSessions([base, noite], '2026-09-28', '2026-10-04', [])).toHaveLength(4)
  })
})

describe('edição de aula padrão', () => {
  it('encerra o padrão antigo na véspera e cria o novo a partir da data', () => {
    const { closed, next } = editSchedule(
      base,
      { startTime: '18:00' },
      '2026-10-05',
      '2026-10-01',
      's9',
    )
    expect(closed.validUntil).toBe('2026-10-04')
    expect(next).toMatchObject({
      id: 's9',
      startTime: '18:00',
      validFrom: '2026-10-05',
      validUntil: null,
    })
  })
  it('não altera aulas passadas', () => {
    expect(() =>
      editSchedule(base, { startTime: '18:00' }, '2026-09-30', '2026-10-01', 's9'),
    ).toThrow()
  })
  it('valida o novo padrão', () => {
    expect(() => editSchedule(base, { weekdays: [] }, '2026-10-05', '2026-10-01', 's9')).toThrow()
  })
})

describe('cancelamento de uma aula', () => {
  const session: Session = generateSessions([base], '2026-09-28', '2026-09-28', [])[0]
  it('professor cancela aula futura informando motivo', () => {
    const c = cancelSession(session, 'Feriado', new Date('2026-09-27T12:00:00Z'))
    expect(c).toMatchObject({ status: 'cancelada', cancelReason: 'Feriado' })
  })
  it('não cancela aula já iniciada', () => {
    expect(() => cancelSession(session, 'x', new Date('2026-09-28T10:00:00Z'))).toThrow()
  })
})
