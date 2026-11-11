/** Aluno que o professor cadastra direto no aplicativo, sem esperar login. */
export type AlunoNovo = {
  id: string
  nome: string
  email: string
  aulas: number
}

/** Limite de aulas anteriores aceito pelo banco. */
export const MAX_AULAS = 10000

export function normalizaEmail(valor: string): string {
  return valor.trim().toLowerCase()
}

export function emailValido(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
}

/** Texto das aulas anteriores ("12", "3 aulas") vira número; vazio é zero. */
export function aulasDoTexto(texto: string): number {
  const digitos = texto.replace(/[^\d]/g, '')
  if (!digitos) return 0
  return Math.min(Number(digitos), MAX_AULAS)
}

/**
 * Erro do primeiro aluno inválido (ou null quando está tudo certo).
 * O e-mail é opcional: sem ele o aluno entra na equipe e o professor informa
 * o e-mail depois, no perfil dele.
 */
export function validaAluno(aluno: { nome: string; email: string; aulas: number }): string | null {
  const nome = aluno.nome.trim()
  if (nome.length < 2) return 'Informe o nome completo do aluno.'
  if (nome.length > 100) return 'O nome deve ter até 100 caracteres.'
  const email = normalizaEmail(aluno.email)
  if (email && !emailValido(email)) return 'E-mail inválido.'
  if (!Number.isInteger(aluno.aulas) || aluno.aulas < 0) return 'Informe quantas aulas ele já fez.'
  if (aluno.aulas > MAX_AULAS) return 'Informe quantas aulas ele já fez.'
  return null
}

/** Valida o lote inteiro: um aluno repetido (e-mail) derruba a lista. */
export function validaLote(alunos: AlunoNovo[]): string | null {
  const vistos = new Set<string>()
  for (const aluno of alunos) {
    const erro = validaAluno(aluno)
    if (erro) return erro
    const email = normalizaEmail(aluno.email)
    if (!email) continue
    if (vistos.has(email)) return 'Este e-mail está repetido na lista.'
    vistos.add(email)
  }
  return null
}

/** "1 aula anterior" / "12 aulas anteriores". */
export function rotuloAulas(aulas: number): string {
  return `${aulas} ${aulas === 1 ? 'aula anterior' : 'aulas anteriores'}`
}

/** "Criar aluno" / "Criar 3 alunos". */
export function rotuloBotao(total: number): string {
  return total === 1 ? 'Criar aluno' : `Criar ${total} alunos`
}
