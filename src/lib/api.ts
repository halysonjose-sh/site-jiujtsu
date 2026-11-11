import { createClient } from '@supabase/supabase-js'
import type { Belt } from '../domain/rules'

export type TeamRole = 'aluno' | 'professor' | 'dono'
export type MemberStatus = 'pendente' | 'ativo' | 'inativo' | 'bloqueado'
export type PresenceStatus = 'pendente' | 'confirmada' | 'rejeitada'
export type Profile = { id: string; name: string; role: TeamRole; revision: number }
export type Team = {
  id: string
  name: string
  slug: string
  primaryColor: string
  accentColor: string
  logoPath: string | null
}
export type RankEvent = {
  id: string
  kind: 'initial' | 'grau' | 'faixa'
  belt: Belt
  degrees: number
  date: string
  note?: string | null
  cancelled: boolean
}
export type AttendanceView = {
  sessionId: string
  date: string
  title: string
  startsAt: string
  status: PresenceStatus
  source: 'checkin' | 'professor'
}
export type StudentView = {
  id: string
  name: string
  role: TeamRole
  memberStatus: MemberStatus
  revision: number
  belt: Belt
  degrees: number
  total: number
  cycle: number
  today: string
  initialSet: boolean
  /** Aulas que aconteceram desde a entrada do aluno (denominador da frequência). */
  held: number
  avatarPath: string | null
  contact: string | null
  birthDate: string | null
  /** E-mail informado pelo professor (aluno criado sem conta no aplicativo). */
  email: string | null
  /** O aluno já tem conta no aplicativo? */
  hasAccount: boolean
  joinedAt: string
  attendances: AttendanceView[]
  events: RankEvent[]
}
export type SessionView = {
  id: string
  title: string
  startsAt: string
  durationMin: number
  status: 'prevista' | 'cancelada' | 'realizada'
  cancelReason: string | null
  description: string | null
  scheduleId: string | null
  photos: number
  cover: string | null
  checkins: number
  pending: number | null
  confirmed: number | null
  mine: PresenceStatus | null
}
export type SessionDetail = {
  id: string
  title: string
  startsAt: string
  durationMin: number
  status: SessionView['status']
  cancelReason: string | null
  description: string | null
  students?: { id: string; name: string; status: PresenceStatus | null; source: string | null }[]
}
export type SessionPhoto = { id: string; path: string; caption: string | null }
export type SessionJournal = {
  id: string
  teamId: string
  title: string
  startsAt: string
  durationMin: number
  status: SessionView['status']
  cancelReason: string | null
  description: string | null
  mine: PresenceStatus | null
  present: number
  photos: SessionPhoto[]
}
/** Arquivos das fotos do treino (Storage do Supabase ou memória na demonstração). */
export type PhotoStore = {
  upload(path: string, file: Blob): Promise<void>
  urls(paths: string[]): Promise<Record<string, string>>
  remove(path: string): Promise<void>
}
export const PHOTO_BUCKET = 'session-photos'
export const LOGO_BUCKET = 'team-branding'
/** Endereço público da logo (na demonstração o caminho já é um blob:). */
export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^(blob:|data:)/.test(path)) return path
  return url ? `${url}/storage/v1/object/public/${LOGO_BUCKET}/${path}` : null
}
export async function uploadLogo(teamId: string, file: Blob): Promise<string> {
  if (!supabase) throw new Error('Equipe não conectada.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${teamId}/logo-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' })
  if (error) throw new Error(error.message)
  return path
}
export async function removeLogo(path: string) {
  if (supabase && !/^(blob:|data:)/.test(path))
    await supabase.storage.from(LOGO_BUCKET).remove([path])
}
export const AVATAR_BUCKET = 'avatars'
/** Caminho do avatar: avatars/{equipe}/{aluno}/{uuid}.{ext}. */
export function avatarPath(teamId: string, studentId: string, file: Blob): string {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  return `${AVATAR_BUCKET}/${teamId}/${studentId}/${crypto.randomUUID()}.${ext}`
}
export async function uploadAvatar(path: string, file: Blob) {
  if (!supabase) throw new Error('Equipe não conectada.')
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
}
export async function removeAvatar(path: string) {
  if (supabase && !/^(blob:|data:)/.test(path))
    await supabase.storage.from(AVATAR_BUCKET).remove([path])
}
/** URLs assinadas de avatares (bucket privado, 1 hora). */
export async function avatarUrls(paths: string[]): Promise<Record<string, string>> {
  if (!supabase || paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrls(paths, 3600)
  if (error) throw new Error(error.message)
  return Object.fromEntries(
    (data ?? [])
      .filter((d) => d.signedUrl && d.path)
      .map((d) => [d.path!, d.signedUrl as string]),
  )
}
export const supabasePhotos: PhotoStore = {
  async upload(path, file) {
    if (!supabase) throw new Error('Equipe não conectada.')
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
    if (error) throw new Error(error.message)
  },
  async urls(paths) {
    if (!supabase || paths.length === 0) return {}
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
    if (error) throw new Error(error.message)
    return Object.fromEntries(
      (data ?? [])
        .filter((d) => d.signedUrl && d.path)
        .map((d) => [d.path!, d.signedUrl as string]),
    )
  },
  async remove(path) {
    if (!supabase) return
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
  },
}
export type ScheduleView = {
  id: string
  title: string
  weekdays: number[]
  startTime: string
  durationMin: number
  validFrom: string
  validUntil: string | null
}
export type Settings = {
  goal: number | null
  role: TeamRole
  status: MemberStatus
  team: Team
}
export type Dashboard = {
  profile: Profile
  team: Team | null
  status: MemberStatus
  students: StudentView[]
  goal: number | null
  today: string
}
/** Consulta ou ação no servidor (ou na demonstração). */
export type Call = <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<T>

const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = url && key && key !== 'your-public-anon-key' ? createClient(url, key) : null
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine)
    throw new Error('Você está sem conexão. Tente novamente quando a internet voltar.')
  if (!supabase)
    throw new Error(
      'A equipe ainda não foi conectada. Use a demonstração para conhecer o app.',
    )
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}
export const isStaff = (role: TeamRole | undefined) => role === 'professor' || role === 'dono'

/** Aviso publicado pela equipe. */
export type Announcement = {
  id: string
  author_id: string
  author_name: string
  body: string
  created_at: string
}



/** Edita uma aula ainda prevista: título, início e duração. */
export const updateSession = (id: string, title: string, startsAt: string, durationMin: number) =>
  rpc('update_session', { p_id: id, p_title: title, p_starts_at: startsAt, p_duration_min: durationMin })

export async function loadDashboard(id: string): Promise<Dashboard> {
  if (!supabase) throw new Error('Equipe não conectada.')
  // id é a conta de login (auth.uid()); o perfil é o do aluno — que pode ter
  // outro id, quando o aluno foi criado pelo professor e só depois entrou.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,name,revision')
    .eq('auth_id', id)
    .single()
  if (error || !profile)
    throw new Error(
      'Não foi possível carregar seu perfil. Verifique sua conexão e tente novamente.',
    )
  const [settings, today] = await Promise.all([
    rpc<Settings | null>('get_settings'),
    rpc<string>('today_sp'),
  ])
  if (!settings) throw new Error('Sua conta não está vinculada a nenhuma equipe.')
  const base = {
    profile: { ...profile, role: settings.role } as Profile,
    team: settings.team,
    status: settings.status,
    goal: settings.goal,
    today,
  }
  if (settings.status !== 'ativo') return { ...base, students: [] }
  const students = isStaff(settings.role)
    ? await rpc<StudentView[]>('list_students')
    : [await rpc<StudentView>('student_detail', { p_student: profile.id })]
  return { ...base, students }
}
export function friendlyError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'
  if (/Invalid login credentials/.test(message)) return 'E-mail ou senha incorretos.'
  if (/Email not confirmed/.test(message)) return 'Confirme seu e-mail antes de entrar.'
  if (/User already registered/.test(message))
    return 'Este e-mail já tem uma conta. Entre ou recupere sua senha.'
  if (/Database error saving new user/.test(message))
    return 'Confira o código da equipe e seu nome. Não foi possível criar a conta.'
  if (/fetch|network|Failed to fetch/i.test(message))
    return 'Não foi possível confirmar a operação. Verifique a conexão e tente novamente.'
  if (/rate limit/i.test(message))
    return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
  return message
}
