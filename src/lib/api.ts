import { createClient } from '@supabase/supabase-js'
import type { Belt } from '../domain/rules'
export type Profile = { id: string; name: string; role: 'aluno' | 'professor'; revision: number }
export type RankEvent = {
  id: string
  kind: 'initial' | 'grau' | 'faixa'
  belt: Belt
  degrees: number
  date: string
  cancelled: boolean
}
export type StudentView = Profile & {
  belt: Belt
  degrees: number
  total: number
  cycle: number
  today: string
  initialSet: boolean
  attendances: string[]
  events: RankEvent[]
}
export type Dashboard = {
  profile: Profile
  students: StudentView[]
  goal: number | null
  today: string
}
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = url && key && key !== 'your-public-anon-key' ? createClient(url, key) : null
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine)
    throw new Error('Você está sem conexão. Tente novamente quando a internet voltar.')
  if (!supabase)
    throw new Error(
      'A turma ainda não foi conectada. Use a demonstração para conhecer o aplicativo.',
    )
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}
export async function loadDashboard(id: string): Promise<Dashboard> {
  if (!supabase) throw new Error('Turma não conectada.')
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,name,role,revision')
    .eq('id', id)
    .single()
  if (error || !profile)
    throw new Error(
      'Não foi possível carregar seu perfil. Verifique sua conexão e tente novamente.',
    )
  const [settings, today, students] = await Promise.all([
    rpc<{ goal: number | null }>('get_settings'),
    rpc<string>('today_sp'),
    profile.role === 'professor'
      ? rpc<StudentView[]>('list_students')
      : rpc<StudentView>('student_detail', { p_student: id }).then((s) => [s]),
  ])
  return { profile: profile as Profile, students, goal: settings.goal, today }
}
export function friendlyError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'
  if (/Invalid login credentials/.test(message)) return 'E-mail ou senha incorretos.'
  if (/Email not confirmed/.test(message)) return 'Confirme seu e-mail antes de entrar.'
  if (/User already registered/.test(message))
    return 'Este e-mail já tem uma conta. Entre ou recupere sua senha.'
  if (/Database error saving new user/.test(message))
    return 'Confira o código da turma e seu nome. Não foi possível criar a conta.'
  if (/fetch|network|Failed to fetch/i.test(message))
    return 'Não foi possível confirmar a operação. Verifique a conexão e tente novamente.'
  if (/rate limit/i.test(message))
    return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
  return message
}
