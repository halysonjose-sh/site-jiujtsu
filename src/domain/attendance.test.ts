import { describe, it, expect } from 'vitest'
import {
  checkIn,
  cancelCheckIn,
  checkInDeadline,
  reviewPresence,
  teacherAddPresence,
  teacherRemovePresence,
  attachPhoto,
  countPresences,
  photosToPurge,
  type Presence,
  type Actor,
} from './attendance'
import type { Session } from './schedule'

const aula: Session = {
  id: 'aula1',
  teamId: 't1',
  scheduleId: 's1',
  title: 'Adulto',
  startsAt: '2026-09-28T10:00:00.000Z', // 07:00 em São Paulo
  durationMin: 60,
  status: 'prevista',
}
const aula2: Session = {
  ...aula,
  id: 'aula2',
  startsAt: '2026-09-28T22:00:00.000Z',
} // 19:00 mesmo dia
const aluno: Actor = { id: 'a', teamId: 't1', role: 'aluno' }
const outro: Actor = { id: 'b', teamId: 't1', role: 'aluno' }
const prof: Actor = { id: 'p', teamId: 't1', role: 'professor' }
const profFora: Actor = { id: 'x', teamId: 't2', role: 'professor' }
const at = (iso: string) => new Date(iso)
const cedo = at('2026-09-27T20:00:00Z')

describe('check-in', () => {
  it('prazo é 1 hora antes do início', () =>
    expect(checkInDeadline(aula).toISOString()).toBe('2026-09-28T09:00:00.000Z'))
  it('cria presença pendente até o prazo, inclusive exatamente no limite', () => {
    const p = checkIn([], aula, aluno, at('2026-09-28T09:00:00Z'))
    expect(p).toEqual([
      {
        sessionId: 'aula1',
        studentId: 'a',
        date: '2026-09-28',
        status: 'pendente',
        source: 'checkin',
      },
    ])
  })
  it('recusa depois do prazo', () =>
    expect(() => checkIn([], aula, aluno, at('2026-09-28T09:00:01Z'))).toThrow(/1 hora/))
  it('repetir o check-in não duplica', () => {
    const p = checkIn([], aula, aluno, cedo)
    expect(checkIn(p, aula, aluno, cedo)).toHaveLength(1)
  })
  it('recusa aula cancelada, de outra equipe e ator professor', () => {
    expect(() => checkIn([], { ...aula, status: 'cancelada' }, aluno, cedo)).toThrow()
    expect(() => checkIn([], { ...aula, teamId: 't2' }, aluno, cedo)).toThrow()
    expect(() => checkIn([], aula, prof, cedo)).toThrow()
  })
  it('aluno desiste até o prazo; depois não', () => {
    const p = checkIn([], aula, aluno, cedo)
    expect(cancelCheckIn(p, aula, aluno, cedo)).toEqual([])
    expect(() => cancelCheckIn(p, aula, aluno, at('2026-09-28T09:30:00Z'))).toThrow()
  })
  it('desistir não remove check-in de outro aluno', () => {
    const p = checkIn(checkIn([], aula, aluno, cedo), aula, outro, cedo)
    expect(cancelCheckIn(p, aula, aluno, cedo)).toHaveLength(1)
  })
})

describe('aprovação pelo professor', () => {
  const pend = checkIn([], aula, aluno, cedo)
  const depois = at('2026-09-28T11:00:00Z')
  it('professor confirma ou rejeita quem fez check-in', () => {
    expect(reviewPresence(pend, aula, prof, 'a', 'confirmada', depois)[0].status).toBe('confirmada')
    expect(reviewPresence(pend, aula, prof, 'a', 'rejeitada', depois)[0].status).toBe('rejeitada')
  })
  it('não revisa antes do início da aula', () =>
    expect(() => reviewPresence(pend, aula, prof, 'a', 'confirmada', cedo)).toThrow())
  it('aluno e professor de outra equipe não revisam', () => {
    expect(() => reviewPresence(pend, aula, aluno, 'a', 'confirmada', depois)).toThrow()
    expect(() => reviewPresence(pend, aula, profFora, 'a', 'confirmada', depois)).toThrow()
  })
  it('falha se o aluno não tem registro na aula', () =>
    expect(() => reviewPresence(pend, aula, prof, 'b', 'confirmada', depois)).toThrow())
})

describe('presença lançada pelo professor (aluno esqueceu o check-in)', () => {
  const depois = at('2026-09-28T11:00:00Z')
  it('adiciona já confirmada', () => {
    expect(teacherAddPresence([], aula, prof, 'a', depois)).toEqual([
      {
        sessionId: 'aula1',
        studentId: 'a',
        date: '2026-09-28',
        status: 'confirmada',
        source: 'professor',
        reviewedAt: '2026-09-28T11:00:00.000Z',
      },
    ])
  })
  it('se já havia check-in pendente ou rejeitado, confirma o existente', () => {
    const p = checkIn([], aula, aluno, cedo)
    const r = teacherAddPresence(p, aula, prof, 'a', depois)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ status: 'confirmada', source: 'checkin' })
  })
  it('não lança em aula futura nem cancelada', () => {
    expect(() => teacherAddPresence([], aula, prof, 'a', cedo)).toThrow()
    expect(() =>
      teacherAddPresence([], { ...aula, status: 'cancelada' }, prof, 'a', depois),
    ).toThrow()
  })
  it('aluno não lança presença', () =>
    expect(() => teacherAddPresence([], aula, aluno, 'a', depois)).toThrow())
  it('professor remove presença; aluno não', () => {
    const p = teacherAddPresence([], aula, prof, 'a', depois)
    expect(teacherRemovePresence(p, aula, prof, 'a')).toEqual([])
    expect(() => teacherRemovePresence(p, aula, aluno, 'a')).toThrow()
  })
})

describe('foto opcional da presença', () => {
  const p = checkIn([], aula, aluno, cedo)
  const noDia = at('2026-09-28T10:30:00Z')
  it('aluno anexa foto no dia da aula, no próprio caminho', () => {
    const r = attachPhoto(p, aula, aluno, 't1/a/aula1.jpg', noDia)
    expect(r[0].photoPath).toBe('t1/a/aula1.jpg')
  })
  it('recusa caminho de outro aluno/equipe, outro dia ou sem check-in', () => {
    expect(() => attachPhoto(p, aula, aluno, 't1/b/aula1.jpg', noDia)).toThrow()
    expect(() => attachPhoto(p, aula, aluno, 't2/a/aula1.jpg', noDia)).toThrow()
    expect(() =>
      attachPhoto(p, aula, aluno, 't1/a/aula1.jpg', at('2026-09-30T12:00:00Z')),
    ).toThrow()
    expect(() => attachPhoto([], aula, aluno, 't1/a/aula1.jpg', noDia)).toThrow()
  })
  it('não troca foto depois de revisada', () => {
    const rev = reviewPresence(p, aula, prof, 'a', 'confirmada', noDia)
    expect(() => attachPhoto(rev, aula, aluno, 't1/a/aula1.jpg', noDia)).toThrow()
  })
})

describe('contagem por aula', () => {
  const depois = at('2026-09-29T12:00:00Z')
  it('só confirmadas contam; duas aulas no mesmo dia contam 2', () => {
    let p = teacherAddPresence([], aula, prof, 'a', depois)
    p = teacherAddPresence(p, aula2, prof, 'a', depois)
    p = checkIn(p, { ...aula, id: 'aula3', startsAt: '2026-09-30T10:00:00.000Z' }, aluno, depois)
    expect(countPresences(p, 'a', [])).toEqual({ total: 2, cycle: 2 })
  })
  it('rejeitadas não contam', () => {
    const p = reviewPresence(checkIn([], aula, aluno, cedo), aula, prof, 'a', 'rejeitada', depois)
    expect(countPresences(p, 'a', []).total).toBe(0)
  })
  it('aulas no dia da graduação ficam no ciclo encerrado; cancelada é ignorada', () => {
    let p = teacherAddPresence([], aula, prof, 'a', depois)
    p = teacherAddPresence(p, aula2, prof, 'a', depois)
    const next = { ...aula, id: 'aula4', startsAt: '2026-09-29T10:00:00.000Z' }
    p = teacherAddPresence(p, next, prof, 'a', depois)
    const events = [
      { id: 'g1', date: '2026-09-28', belt: 'branca' as const, degrees: 1 },
      {
        id: 'g2',
        date: '2026-09-29',
        belt: 'branca' as const,
        degrees: 2,
        cancelled: true,
      },
    ]
    expect(countPresences(p, 'a', events)).toEqual({ total: 3, cycle: 1 })
  })
  it('conta somente o aluno pedido', () => {
    const p = teacherAddPresence([], aula, prof, 'b', depois)
    expect(countPresences(p, 'a', [])).toEqual({ total: 0, cycle: 0 })
  })
})

describe('retenção de fotos', () => {
  const base: Presence = {
    sessionId: 'aula1',
    studentId: 'a',
    date: '2026-06-01',
    status: 'confirmada',
    source: 'checkin',
    photoPath: 't1/a/aula1.jpg',
    reviewedAt: '2026-06-01T12:00:00.000Z',
  }
  const now = at('2026-09-01T12:00:00Z') // 92 dias depois
  it('apaga fotos revisadas há mais que o prazo', () =>
    expect(photosToPurge([base], 90, now)).toEqual(['t1/a/aula1.jpg']))
  it('mantém dentro do prazo, pendentes e já apagadas', () => {
    expect(photosToPurge([base], 120, now)).toEqual([])
    expect(photosToPurge([{ ...base, status: 'pendente', reviewedAt: undefined }], 1, now)).toEqual(
      [],
    )
    expect(photosToPurge([{ ...base, photoPath: undefined }], 1, now)).toEqual([])
  })
  it('rejeita prazo inválido', () => expect(() => photosToPurge([base], 0, now)).toThrow())
})
