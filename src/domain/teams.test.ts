import { describe, it, expect } from 'vitest'
import {
  signupMembership,
  isStaff,
  canManageTeam,
  canReadStudent,
  approveMember,
  type Membership,
} from './teams'

const m = (p: Partial<Membership>): Membership => ({
  teamId: 't1',
  userId: 'u',
  role: 'aluno',
  status: 'ativo',
  ...p,
})
const dono = m({ userId: 'd', role: 'dono' })
const prof = m({ userId: 'p', role: 'professor' })
const prof2 = m({ userId: 'p2', role: 'professor' })
const aluno = m({ userId: 'a' })
const pendente = m({ userId: 'n', status: 'pendente' })
const outraEquipe = m({ teamId: 't2', userId: 'x', role: 'professor' })

describe('vínculo com a equipe', () => {
  it('cadastro público cria aluno pendente, nunca professor ou dono', () => {
    expect(signupMembership('t1', 'n')).toEqual({
      teamId: 't1',
      userId: 'n',
      role: 'aluno',
      status: 'pendente',
    })
  })
  it('equipe aceita vários professores e dono também é equipe técnica', () => {
    expect([dono, prof, prof2].every(isStaff)).toBe(true)
    expect(isStaff(aluno)).toBe(false)
    expect(isStaff(m({ role: 'professor', status: 'pendente' }))).toBe(false)
  })
  it('somente dono ativo gerencia visual, código e professores', () => {
    expect(canManageTeam(dono)).toBe(true)
    expect(canManageTeam(prof)).toBe(false)
    expect(canManageTeam(aluno)).toBe(false)
    expect(canManageTeam(m({ role: 'dono', status: 'bloqueado' }))).toBe(false)
  })
})

describe('leitura isolada por equipe', () => {
  it('aluno lê só a si mesmo; professor lê alunos da própria equipe', () => {
    expect(canReadStudent(aluno, 't1', 'a')).toBe(true)
    expect(canReadStudent(aluno, 't1', 'b')).toBe(false)
    expect(canReadStudent(prof, 't1', 'b')).toBe(true)
    expect(canReadStudent(outraEquipe, 't1', 'b')).toBe(false)
    expect(canReadStudent(null, 't1', 'a')).toBe(false)
  })
  it('pendente não acessa nem os próprios dados da equipe', () => {
    expect(canReadStudent(pendente, 't1', 'n')).toBe(false)
  })
})

describe('aprovação de novos alunos', () => {
  it('professor ou dono aprova pendente da própria equipe', () => {
    expect(approveMember(prof, pendente).status).toBe('ativo')
    expect(approveMember(dono, pendente).status).toBe('ativo')
  })
  it('aluno, pendente e professor de outra equipe não aprovam', () => {
    expect(() => approveMember(aluno, pendente)).toThrow()
    expect(() => approveMember(pendente, pendente)).toThrow()
    expect(() => approveMember(outraEquipe, pendente)).toThrow()
  })
  it('aprovar quem já está ativo não altera nada', () => {
    expect(approveMember(prof, aluno)).toEqual(aluno)
  })
})
