import { describe, expect, it } from 'vitest'
import { contrastRatio, escalaSidebar, falhasDeContraste, luminance, mixHex } from './contrast'

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
    expect(falhas.map((f) => f.par)).toEqual([expect.stringContaining('Cor principal')])
  })
  it('destaque parecido com a principal falha', () => {
    const falhas = falhasDeContraste('#234c3a', '#1d3a2c')
    expect(falhas.map((f) => f.par)).toEqual([
      expect.stringContaining('Cor de destaque com a cor principal'),
    ])
  })
  it('destaque escuro com principal clara só falha no par da principal', () => {
    // O texto da navegação se adapta ao destaque, então não bloqueia mais.
    const falhas = falhasDeContraste('#f6f5ef', '#1d3a2c')
    expect(falhas.map((f) => f.par)).toEqual([expect.stringContaining('Cor principal')])
  })
  it('duas cores claras geram a falha de botão; destaque próximo falha no par de destaque', () => {
    expect(falhasDeContraste('#cccccc', '#eeeeee')).toHaveLength(2)
  })
  it('cor inválida não quebra: nenhum par avaliável, nenhuma falha', () => {
    expect(falhasDeContraste('x', '#cee68b')).toEqual([])
  })
})

describe('mixHex', () => {
  it('peso 0 devolve a primeira cor e peso 1 a segunda', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
  })
  it('peso 0.5 mistura os canais', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
  it('aceita 3 dígitos', () => {
    expect(mixHex('#000', '#fff', 1)).toBe('#ffffff')
  })
  it('peso fora de [0,1] é limitado', () => {
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000')
  })
  it('cor inválida devolve null', () => {
    expect(mixHex('x', '#ffffff', 0.5)).toBeNull()
    expect(mixHex('#000000', 'x', 0.5)).toBeNull()
  })
})

describe('escalaSidebar', () => {
  it('destaque claro (padrão Tatame) pede texto escuro', () => {
    const esc = escalaSidebar('#cee68b')!
    expect(contrastRatio(esc.texto, '#cee68b')!).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(esc.ativoTexto, esc.ativoBg)!).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(esc.fraco, '#cee68b')!).toBeGreaterThanOrEqual(4.5)
  })
  it('destaque escuro pede texto claro', () => {
    const esc = escalaSidebar('#101820')!
    expect(contrastRatio(esc.texto, '#101820')!).toBeGreaterThanOrEqual(4.5)
    expect(esc.texto.toLowerCase()).not.toBe(escalaSidebar('#f5f5e7')!.texto.toLowerCase())
  })
  it('destaque médio encontra algum texto legível', () => {
    const esc = escalaSidebar('#7a8b6f')!
    expect(contrastRatio(esc.texto, '#7a8b6f')!).toBeGreaterThanOrEqual(4.5)
  })
  it('hover e ativo diferem do fundo', () => {
    const esc = escalaSidebar('#cee68b')!
    expect(esc.hoverBg.toLowerCase()).not.toBe('#cee68b')
    expect(esc.ativoBg.toLowerCase()).not.toBe('#cee68b')
  })
  it('cor inválida devolve null (CSS cai no padrão)', () => {
    expect(escalaSidebar('x')).toBeNull()
  })
})
