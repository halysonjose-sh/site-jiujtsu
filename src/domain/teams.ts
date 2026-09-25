export type TeamRole = 'aluno' | 'professor' | 'dono'
export type MemberStatus = 'pendente' | 'ativo' | 'bloqueado'
export type Membership = {
  teamId: string
  userId: string
  role: TeamRole
  status: MemberStatus
}

export function signupMembership(teamId: string, userId: string): Membership {
  return { teamId, userId, role: 'aluno', status: 'pendente' }
}
export function isStaff(m: Membership | null): boolean {
  return !!m && m.status === 'ativo' && (m.role === 'professor' || m.role === 'dono')
}
export function canManageTeam(m: Membership | null): boolean {
  return !!m && m.status === 'ativo' && m.role === 'dono'
}
export function canReadStudent(m: Membership | null, teamId: string, studentId: string): boolean {
  if (!m || m.teamId !== teamId || m.status !== 'ativo') return false
  return isStaff(m) || m.userId === studentId
}
export function approveMember(actor: Membership, target: Membership): Membership {
  if (!isStaff(actor) || actor.teamId !== target.teamId)
    throw new Error('Somente professores da equipe podem aprovar alunos.')
  return target.status === 'pendente' ? { ...target, status: 'ativo' } : target
}
