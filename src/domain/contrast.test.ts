import { describe, expect, it } from 'vitest'
import { contrastRatio, falhasDeContraste, luminance } from './contrast'

describe('luminance', () => {
  it('preto é 0 e branco é 1', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })
  it('aceita 3 dígitos e devolve o mesmo de 6', () => {
    expect(luminance('#fff')).toBe(luminance('#ffffff'))
  })
  it('cor inválida devolve null', () => {
    expect(luminance('azul')).toBeNull()
    expect(luminance('')).toBeNull()
    expect(luminance('#12345')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('preto vs branco é 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  })
  it('a ordem das cores não muda o resultado', () => {
    expect(contrastRatio('#234c3a', '#cee68b')).toBe(contrastRatio('#cee68b', '#234c3a'))
  })
  it('cores iguais dão 1', () => {
    expect(contrastRatio('#7a7a7a', '#7a7a7a')).toBe(1)
  })
  it('cor inválida devolve null', () => {
    expect(contrastRatio('#234c3a', 'x')).toBeNull()
  })
})

describe('falhasDeContraste', () => {
  it('cores padrão do Tatame passam', () => {
    expect(falhasDeContraste('#234c3a', '#cee68b')).toEqual([])
  })
  it('cor principal clara demais falha com o texto dos botões', () => {
    const falhas = falhasDeContraste('#7a7a7a', '#000000')
    expect(falhas.map((f) => f.par)).toEqual([
      expect.stringContaining('Cor principal'),
      expect.stringContaining('navegação'),
    ])
  })
  it('destaque parecido com a principal falha', () => {
    const falhas = falhasDeContraste('#234c3a', '#1d3a2c')
    expect(falhas.map((f) => f.par)).toEqual([
      expect.stringContaining('Cor de destaque com a cor principal'),
      expect.stringContaining('navegação'),
    ])
  })
  it('destaque escuro é bloqueado pela navegação (e pela principal clara)', () => {
    const falhas = falhasDeContraste('#f6f5ef', '#1d3a2c')
    expect(falhas.map((f) => f.par)).toEqual([
      expect.stringContaining('Cor principal'),
      expect.stringContaining('navegação'),
    ])
  })
  it('duas cores ruins geram as falhas de botão e de destaque', () => {
    // #eeeeee contrasta com o texto escuro da navegação, então só 2 pares falham.
    expect(falhasDeContraste('#cccccc', '#eeeeee')).toHaveLength(2)
  })
  it('cor inválida não quebra: nenhum par avaliável, nenhuma falha', () => {
    // Destaque padrão passa na navegação, então só pares com a principal
    // inválida seriam avaliáveis — e nenhum é.
    expect(falhasDeContraste('x', '#cee68b')).toEqual([])
  })
})
