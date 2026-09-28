import { describe, expect, it } from 'vitest'
import { frequencyRate, streak } from './frequency'

describe('frequencyRate', () => {
  it('percentual simples', () => {
    expect(frequencyRate(14, 17)).toBe(82)
    expect(frequencyRate(1, 3)).toBe(33)
    expect(frequencyRate(3, 3)).toBe(100)
  })
  it('sem aulas realizadas não há percentual', () => {
    expect(frequencyRate(0, 0)).toBeNull()
  })
  it('arredonda para o inteiro mais próximo', () => {
    expect(frequencyRate(1, 6)).toBe(17)
    expect(frequencyRate(2, 3)).toBe(67)
  })
  it('entrada degenerada', () => {
    expect(() => frequencyRate(-1, 5)).toThrow()
    expect(() => frequencyRate(5, 4)).toThrow()
    expect(() => frequencyRate(1.5, 5)).toThrow()
  })
})

describe('streak', () => {
  const hoje = '2026-09-27'
  it('sem presenças', () => {
    expect(streak([], hoje)).toBe(0)
  })
  it('sequência que termina ontem continua valendo', () => {
    expect(streak(['2026-09-24', '2026-09-25', '2026-09-26'], hoje)).toBe(3)
  })
  it('sequência que termina hoje', () => {
    expect(streak(['2026-09-25', '2026-09-26', '2026-09-27'], hoje)).toBe(3)
  })
  it('último treino é de antes de ontem: sequência encerrada', () => {
    expect(streak(['2026-09-20', '2026-09-21', '2026-09-22'], hoje)).toBe(0)
  })
  it('buraco no meio quebra a contagem', () => {
    expect(streak(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-23'], hoje)).toBe(3)
  })
  it('duplicatas e um elemento só', () => {
    expect(streak(['2026-09-27', '2026-09-27'], hoje)).toBe(1)
    expect(streak(['2026-09-27'], hoje)).toBe(1)
  })
})
