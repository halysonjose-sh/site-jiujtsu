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
/** Textos fixos da sidebar, que usa a cor de destaque como fundo. */
export const TEXTO_NAV = ['#4a544c', '#565f57']
/** Contraste mínimo WCAG AA para texto normal. */
export const MINIMO = 4.5

export type FalhaContraste = { par: string; ratio: number }

/**
 * Pares que ficam ilegíveis com as cores escolhidas.
 * - cor principal vs texto claro (botões, dock, toast)
 * - cor de destaque vs cor principal (link Desfazer do toast, marcadores)
 * - cor de destaque vs textos fixos da navegação (sidebar)
 */
export function falhasDeContraste(primary: string, accent: string): FalhaContraste[] {
  const falhas: FalhaContraste[] = []
  const p = contrastRatio(primary, TEXTO_CLARO)
  if (p !== null && p < MINIMO) falhas.push({ par: 'Cor principal com o texto dos botões', ratio: p })
  const a = contrastRatio(accent, primary)
  if (a !== null && a < MINIMO)
    falhas.push({ par: 'Cor de destaque com a cor principal', ratio: a })
  const nav = TEXTO_NAV.map((t) => contrastRatio(accent, t)).filter(
    (r): r is number => r !== null,
  )
  if (nav.length && Math.min(...nav) < MINIMO)
    falhas.push({ par: 'Cor de destaque com o texto da navegação', ratio: Math.min(...nav) })
  return falhas
}
