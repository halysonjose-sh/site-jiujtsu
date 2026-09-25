import { describe, it, expect } from 'vitest'
import { monthGrid, shiftMonth, sessionPhotoPath, isSessionPhotoPath, MAX_PHOTOS } from './calendar'

describe('grade do mês', () => {
  it('setembro/2026 começa no domingo 30/08 e tem 6 semanas', () => {
    const g = monthGrid('2026-09')
    expect(g).toHaveLength(42)
    expect(g[0]).toEqual({ date: '2026-08-30', inMonth: false })
    expect(g[2]).toEqual({ date: '2026-09-01', inMonth: true })
    expect(g.filter((d) => d.inMonth)).toHaveLength(30)
    expect(g.at(-1)!.date).toBe('2026-10-10')
  })
  it('fevereiro de ano bissexto', () => {
    expect(monthGrid('2028-02').filter((d) => d.inMonth)).toHaveLength(29)
  })
  it('navega entre meses e anos', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-09', 0)).toBe('2026-09')
  })
  it('rejeita mês inválido', () => {
    expect(() => monthGrid('2026-13')).toThrow()
    expect(() => monthGrid('setembro')).toThrow()
  })
})

describe('caminho das fotos do treino', () => {
  it('fica dentro da pasta da equipe e da aula', () => {
    const p = sessionPhotoPath('t1', 's1', 'abc')
    expect(p).toBe('t1/s1/abc.jpg')
    expect(isSessionPhotoPath(p, 't1', 's1')).toBe(true)
  })
  it('recusa outra equipe, outra aula ou caminho com ..', () => {
    expect(isSessionPhotoPath('t2/s1/abc.jpg', 't1', 's1')).toBe(false)
    expect(isSessionPhotoPath('t1/s2/abc.jpg', 't1', 's1')).toBe(false)
    expect(isSessionPhotoPath('t1/s1/../x.jpg', 't1', 's1')).toBe(false)
    expect(isSessionPhotoPath('t1/s1/a/b.jpg', 't1', 's1')).toBe(false)
  })
  it('limite de fotos por aula', () => expect(MAX_PHOTOS).toBe(20))
})
