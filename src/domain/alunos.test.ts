import { describe, expect, it } from 'vitest'
import {
  aulasDoTexto,
  emailValido,
  normalizaEmail,
  rotuloAulas,
  rotuloBotao,
  validaAluno,
  validaLote,
  type AlunoNovo,
} from './alunos'

const aluno = (over: Partial<AlunoNovo> = {}): AlunoNovo => ({
  id: 'id-1',
  nome: 'Carlos Lima',
  email: '',
  aulas: 0,
  ...over,
})

describe('normalizaEmail', () => {
  it('apara espaços e lowers', () => {
    expect(normalizaEmail('  Convidado@TEST.local ')).toBe('convidado@test.local')
  })
})

describe('emailValido', () => {
  it('aceita e-mail com arroba e ponto', () => {
    expect(emailValido('carlos@test.local')).toBe(true)
  })
  it('recusa e-mail sem arroba, sem ponto ou com espaço', () => {
    expect(emailValido('sem-arroba')).toBe(false)
    expect(emailValido('sem@ponto')).toBe(false)
    expect(emailValido('com espaco@test.local')).toBe(false)
  })
})

describe('aulasDoTexto', () => {
  it('vazio é zero', () => {
    expect(aulasDoTexto('')).toBe(0)
  })
  it('lê os dígitos e ignora o resto', () => {
    expect(aulasDoTexto('12')).toBe(12)
    expect(aulasDoTexto('3 aulas')).toBe(3)
  })
  it('nunca passa do limite', () => {
    expect(aulasDoTexto('999999')).toBe(10000)
  })
})

describe('validaAluno', () => {
  it('aceita aluno sem e-mail', () => {
    expect(validaAluno(aluno({ aulas: 12 }))).toBeNull()
  })
  it('exige nome com pelo menos duas letras', () => {
    expect(validaAluno(aluno({ nome: 'C' }))).toMatch(/nome/)
    expect(validaAluno(aluno({ nome: '  ' }))).toMatch(/nome/)
  })
  it('limita o tamanho do nome', () => {
    expect(validaAluno(aluno({ nome: 'a'.repeat(101) }))).toMatch(/100/)
  })
  it('recusa e-mail inválido', () => {
    expect(validaAluno(aluno({ email: 'sem-arroba' }))).toMatch(/E-mail/)
  })
  it('recusa aulas negativas ou fracionadas', () => {
    expect(validaAluno(aluno({ aulas: -1 }))).toMatch(/aulas/)
    expect(validaAluno(aluno({ aulas: 1.5 }))).toMatch(/aulas/)
  })
  it('recusa aulas acima do limite', () => {
    expect(validaAluno(aluno({ aulas: 10001 }))).toMatch(/aulas/)
  })
})

describe('validaLote', () => {
  it('aceita lote sem e-mail', () => {
    expect(validaLote([aluno(), aluno({ id: 'id-2' })])).toBeNull()
  })
  it('acha o aluno inválido do lote', () => {
    expect(validaLote([aluno(), aluno({ id: 'id-2', nome: 'X' })])).toMatch(/nome/)
  })
  it('recusa e-mail repetido na lista', () => {
    const erro = validaLote([
      aluno({ id: 'id-1', email: 'mesmo@test.local' }),
      aluno({ id: 'id-2', nome: 'Outra Pessoa', email: ' MESMO@test.local ' }),
    ])
    expect(erro).toMatch(/repetido/)
  })
})

describe('rótulos', () => {
  it('pluraliza as aulas anteriores', () => {
    expect(rotuloAulas(1)).toBe('1 aula anterior')
    expect(rotuloAulas(12)).toBe('12 aulas anteriores')
  })
  it('pluraliza o botão', () => {
    expect(rotuloBotao(1)).toBe('Criar aluno')
    expect(rotuloBotao(3)).toBe('Criar 3 alunos')
  })
})
