import { describe, it, expect } from 'vitest'
import { planNewSession, overlapping, type NewSessionInput } from './newSession'

// 25/09/2026 12:00 em São Paulo = 15:00 UTC
const now = new Date('2026-09-25T15:00:00Z')
const base: NewSessionInput = {
  title: 'Treino',
  date: '2026-09-25',
  time: '19:00',
  durationMin: 60,
  description: '',
  photoCount: 0,
  presentCount: 0,
}
const plan = (p: Partial<NewSessionInput>) => planNewSession({ ...base, ...p }, now)

describe('cadastro de aula: dados básicos', () => {
  it('aula futura válida', () => {
    const r = plan({})
    expect(r.errors).toEqual([])
    expect(r.startsAt).toBe('2026-09-25T22:00:00.000Z')
    expect(r.past).toBe(false)
  })
  it('aula que já aconteceu permite fotos e presença', () => {
    const r = plan({ time: '07:00' })
    expect(r.past).toBe(true)
    expect(r.errors).toEqual([])
  })
  it('início exatamente agora conta como aula já começada', () => {
    expect(plan({ time: '12:00' }).past).toBe(true)
  })
  it.each([
    ['título vazio', { title: '   ' }, 'Informe o nome da aula.'],
    ['título curto', { title: 'A' }, 'Informe o nome da aula.'],
    ['título longo', { title: 'x'.repeat(81) }, 'O nome pode ter até 80 caracteres.'],
    ['duração curta', { durationMin: 10 }, 'A duração deve ficar entre 15 e 300 minutos.'],
    ['duração longa', { durationMin: 301 }, 'A duração deve ficar entre 15 e 300 minutos.'],
    ['duração fracionada', { durationMin: 60.5 }, 'A duração deve ficar entre 15 e 300 minutos.'],
    ['duração vazia', { durationMin: NaN }, 'A duração deve ficar entre 15 e 300 minutos.'],
    ['data inválida', { date: '2026-02-30' }, 'Informe uma data válida.'],
    ['data vazia', { date: '' }, 'Informe uma data válida.'],
    ['hora inválida', { time: '25:00' }, 'Informe um horário válido.'],
    ['hora vazia', { time: '' }, 'Informe um horário válido.'],
    [
      'descrição longa',
      { description: 'x'.repeat(2001) },
      'A descrição pode ter até 2000 caracteres.',
    ],
  ])('rejeita %s', (_, change, message) => {
    const r = plan(change as Partial<NewSessionInput>)
    expect(r.errors).toContain(message)
    expect(r.startsAt === null || r.errors.length > 0).toBe(true)
  })
  it('aula a mais de 1 ano no futuro é recusada', () => {
    expect(plan({ date: '2027-09-26' }).errors).toContain('Escolha uma data até 1 ano à frente.')
    expect(plan({ date: '2027-09-24' }).errors).toEqual([])
  })
  it('treinos antigos podem ser registrados', () => {
    expect(plan({ date: '2024-01-10', time: '19:00' }).errors).toEqual([])
  })
})

describe('cadastro de aula: fotos e presenças', () => {
  it('aula futura aceita fotos, mas não presença', () => {
    expect(plan({ photoCount: 3 }).errors).toEqual([])
    expect(plan({ presentCount: 2 }).errors).toContain(
      'Presenças só podem ser registradas em aulas que já começaram.',
    )
  })
  it('até 20 fotos, em aula passada ou futura', () => {
    expect(plan({ time: '07:00', photoCount: 20 }).errors).toEqual([])
    expect(plan({ photoCount: 21 }).errors).toContain('Limite de 20 fotos por aula.')
  })
  it('aula passada aceita marcar presentes', () => {
    expect(plan({ time: '07:00', presentCount: 5 }).errors).toEqual([])
  })
})

describe('conflito de horário (apenas aviso)', () => {
  const existing = [
    {
      id: 'a',
      title: 'Adulto',
      startsAt: '2026-09-25T22:00:00.000Z',
      durationMin: 60,
      status: 'prevista' as const,
    },
    {
      id: 'b',
      title: 'Cancelada',
      startsAt: '2026-09-25T22:30:00.000Z',
      durationMin: 60,
      status: 'cancelada' as const,
    },
  ]
  it('encontra aula que se sobrepõe', () => {
    expect(overlapping(existing, '2026-09-25T22:30:00.000Z', 60).map((s) => s.id)).toEqual(['a'])
  })
  it('aula que termina quando a outra começa não conflita', () => {
    expect(overlapping(existing, '2026-09-25T21:00:00.000Z', 60)).toEqual([])
    expect(overlapping(existing, '2026-09-25T23:00:00.000Z', 30)).toEqual([])
  })
  it('ignora aulas canceladas', () => {
    expect(overlapping(existing, '2026-09-25T23:10:00.000Z', 30)).toEqual([])
  })
})
