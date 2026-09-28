import { describe, expect, it } from 'vitest'
import { horariosFrequentes } from './quickSession'
import type { ScheduleView } from '../lib/api'

const horario = (over: Partial<ScheduleView> = {}): ScheduleView => ({
  id: 'h1',
  title: 'Jiu-jítsu adulto',
  weekdays: [1, 3, 5],
  startTime: '19:00',
  durationMin: 60,
  validFrom: '2026-01-01',
  validUntil: null,
  ...over,
})

describe('horariosFrequentes', () => {
  it('lista vazia devolve lista vazia', () => {
    expect(horariosFrequentes([], '2026-09-27')).toEqual([])
  })
  it('usa só horários em vigor hoje', () => {
    const ops = horariosFrequentes(
      [
        horario({ id: 'a', validFrom: '2026-10-01' }), // ainda não vale
        horario({ id: 'b', validUntil: '2026-09-20' }), // já encerrou
        horario({ id: 'c', title: 'Turma da manhã', startTime: '07:00' }),
      ],
      '2026-09-27',
    )
    expect(ops).toEqual([{ title: 'Turma da manhã', start: '07:00', durationMin: 60 }])
  })
  it('deduplica por horário e duração, mantendo o primeiro título', () => {
    const ops = horariosFrequentes(
      [
        horario({ id: 'a', title: 'Adulto', startTime: '19:00' }),
        horario({ id: 'b', title: 'Adulto avançado', startTime: '19:00' }),
        horario({ id: 'c', startTime: '19:00', durationMin: 90 }), // duração diferente: entra
      ],
      '2026-09-27',
    )
    expect(ops).toEqual([
      { title: 'Adulto', start: '19:00', durationMin: 60 },
      { title: 'Jiu-jítsu adulto', start: '19:00', durationMin: 90 },
    ])
  })
  it('ordena pelo horário', () => {
    const ops = horariosFrequentes(
      [horario({ startTime: '19:00' }), horario({ startTime: '07:00' })],
      '2026-09-27',
    )
    expect(ops.map((o) => o.start)).toEqual(['07:00', '19:00'])
  })
})
