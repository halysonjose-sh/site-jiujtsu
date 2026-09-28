/**
 * Contraste WCAG 2.1 para as cores escolhidas pelo dono da equipe.
 * Pares validados (superfícies onde a cor escolhida encontra texto fixo):
 * - cor principal como fundo de botões/dock/toast com texto claro (#fffef9);
 * - cor de destaque como texto sobre a cor principal (link Desfazer do toast);
 * - cor de destaque como fundo da sidebar com textos fixos de navegação.
 */

/** Luminância relativa WCAG (hex #rgb ou #rrggbb). */
export function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste WCAG (1 a 21); null se alguma cor for inválida. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Texto claro usado sobre botões primários e no dock. */
export const TEXTO_CLARO = '#fffef9'
/** Contraste mínimo WCAG AA para texto normal. */
export const MINIMO = 4.5

export type FalhaContraste = { par: string; ratio: number }

/**
 * Pares que ficam ilegíveis com as cores escolhidas.
 * - cor principal vs texto claro (botões, dock, toast)
 * - cor de destaque vs cor principal (link Desfazer do toast, marcadores)
 * O texto da navegação não entra mais: ele é derivado do destaque por
 * escalaSidebar, então se adapta a qualquer cor escolhida.
 */
export function falhasDeContraste(primary: string, accent: string): FalhaContraste[] {
  const falhas: FalhaContraste[] = []
  const p = contrastRatio(primary, TEXTO_CLARO)
  if (p !== null && p < MINIMO) falhas.push({ par: 'Cor principal com o texto dos botões', ratio: p })
  const a = contrastRatio(accent, primary)
  if (a !== null && a < MINIMO)
    falhas.push({ par: 'Cor de destaque com a cor principal', ratio: a })
  return falhas
}

/** Mistura duas cores no espaço sRGB; pesoB é a fração da segunda cor. */
export function mixHex(a: string, b: string, pesoB: number): string | null {
  const parse = (hex: string): [number, number, number] | null => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return null
    let h = m[1]
    if (h.length === 3) h = [...h].map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  }
  const ra = parse(a)
  const rb = parse(b)
  if (!ra || !rb) return null
  const p = Math.min(1, Math.max(0, pesoB))
  const canal = (i: number) => Math.round(ra[i] + (rb[i] - ra[i]) * p)
  return '#' + [0, 1, 2].map((i) => canal(i).toString(16).padStart(2, '0')).join('')
}

export type EscalaSidebar = {
  texto: string
  fraco: string
  hoverBg: string
  ativoBg: string
  ativoTexto: string
}

/** Primeiro candidato com contraste AA sobre o fundo; null se nenhum passar. */
function primeiraLegivel(fundo: string, candidatos: string[]): string | null {
  for (const c of candidatos) {
    const r = contrastRatio(c, fundo)
    if (r !== null && r >= MINIMO) return c
  }
  return null
}

/**
 * Escala de cores da sidebar a partir da cor de destaque escolhida pelo dono.
 * A sidebar usa o destaque como fundo, então o texto precisa ser derivado dele:
 * destaque escuro pede texto claro, destaque claro pede texto escuro.
 * Devolve null se o destaque for inválido (o CSS cai nos valores padrão).
 */
export function escalaSidebar(accent: string): EscalaSidebar | null {
  if (luminance(accent) === null) return null
  const escuro = mixHex(accent, '#000000', 0.85) ?? '#1c241e'
  const claro = mixHex(accent, '#ffffff', 0.92) ?? TEXTO_CLARO
  const texto =
    primeiraLegivel(accent, [TEXTO_CLARO, claro, escuro, '#000000']) ?? '#1c241e'
  const fraco =
    primeiraLegivel(accent, [mixHex(texto, accent, 0.35) ?? texto, texto]) ?? texto
  // Realce do item ativo: o próprio texto misturado ao fundo mantém o matiz
  // da equipe e garante contraste próximo ao do par original.
  const ativoBg = mixHex(accent, texto, 0.14) ?? accent
  const ativoTexto =
    primeiraLegivel(ativoBg, [texto]) ?? texto
  const hoverBg = mixHex(accent, texto, 0.08) ?? accent
  return { texto, fraco, hoverBg, ativoBg, ativoTexto }
}
