import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Award,
  Camera,
  Copy,
  Link2,
  RefreshCw,
  Share2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  GraduationCap,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  TrendingUp,
  User,
  Users,
  WifiOff,
  X,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { ActionButton } from './components/ActionButton'
import { belts, progress, type Belt } from './domain/rules'
import {
  friendlyError,
  isStaff,
  loadDashboard,
  logoUrl,
  removeLogo,
  uploadLogo,
  supabasePhotos,
  rpc,
  supabase,
  avatarUrls as supabaseAvatarUrls,
  uploadAvatar as supabaseUploadAvatar,
  removeAvatar,
  avatarPath as buildAvatarPath,
  type Call,
  type Dashboard,
  type StudentView,
  type Team,
  type Announcement,
} from './lib/api'
import { Agenda, dayLabel, presenceLabel, Schedules, timeLabel } from './components/Classes'
import { TrainTab } from './components/StudentTrain'
import { Today } from './components/Today'
import { ToastProvider, useToast } from './components/Toast'
import { BottomSheet } from './components/BottomSheet'
import { OverflowMenu } from './components/OverflowMenu'
import { zonedToUtc } from './domain/schedule'
import { escalaSidebar, falhasDeContraste } from './domain/contrast'
import { compressImage } from './lib/image'
import {
  currentSubscription,
  disablePush,
  enablePush,
  notifyCheckin,
  pushSupported,
} from './lib/push'
import { createDemo } from './lib/demo'
import { useConnection } from './lib/useConnection'
import { frequencyRate, streak } from './domain/frequency'

/** Aplica o visual da equipe no :root: cores principais e escala legível da sidebar. */
function aplicarVisual(root: CSSStyleDeclaration, primary: string, accent: string) {
  root.setProperty('--green', primary)
  root.setProperty('--accent', accent)
  // A sidebar usa a cor principal como fundo, então o texto deriva dela.
  const esc = escalaSidebar(primary)
  if (esc) {
    root.setProperty('--side-text', esc.texto)
    root.setProperty('--side-weak', esc.fraco)
    root.setProperty('--side-hover-bg', esc.hoverBg)
    root.setProperty('--side-active-bg', esc.ativoBg)
    root.setProperty('--side-active-text', esc.ativoTexto)
  } else {
    limparVisual(root)
  }
}
/** Volta ao visual padrão do Tatame (sem equipe carregada ou cor inválida). */
function limparVisual(root: CSSStyleDeclaration) {
  for (const t of [
    '--green',
    '--accent',
    '--side-text',
    '--side-weak',
    '--side-hover-bg',
    '--side-active-bg',
    '--side-active-text',
  ])
    root.removeProperty(t)
}

const dateLabel = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
    new Date(day + 'T12:00:00Z'),
  )
/** Marca Tatame: faixa amarrada com ponteira preta e dois graus. Usa a cor da equipe. */
function BeltMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="3" y="20" width="58" height="11" rx="3" fill="currentColor" />
      <path d="M27 31 L35 32 L25.5 58 L17.5 55 Z" fill="currentColor" />
      <path d="M30 32 L38 31 L47.5 55 L39.5 58 Z" fill="currentColor" />
      <path d="M43.2 44.2 L47.5 55 L39.5 58 L35.4 47.3 Z" fill="#161616" />
      <path d="M37.1 50.4 L44.1 47.6 M38.1 53.1 L45.1 50.3" stroke="#fff" strokeWidth="1.5" />
      <rect
        x="23"
        y="15"
        width="18"
        height="21"
        rx="5"
        fill="currentColor"
        stroke="var(--cream)"
        strokeWidth="2"
      />
      <path
        d="M27 18.5 L37 32.5"
        stroke="var(--cream)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity=".45"
      />
    </svg>
  )
}
function Brand({ team }: { team?: Team | null }) {
  const logo = logoUrl(team?.logoPath)
  if (logo)
    return (
      <div className="brand">
        <img className="brand-logo" src={logo} alt={'Logo ' + (team?.name ?? 'da equipe')} />
        <span className="brand-team">{team?.name}</span>
      </div>
    )
  return (
    <div className="brand">
      <BeltMark />
      <span>
        tatame<span className="brand-dot">.</span>
      </span>
    </div>
  )
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
function BeltVisual({ belt, degrees }: { belt: Belt; degrees: number }) {
  return (
    <div
      className={'belt-visual belt-' + belt}
      role="img"
      aria-label={`Faixa ${belt}, ${degrees} graus`}
    >
      <span className="belt-stitch" />
      <span className="belt-tip">
        {Array.from({ length: degrees }, (_, i) => (
          <i key={i} />
        ))}
      </span>
    </div>
  )
}
const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
const avatarUrlCache = new Map<string, string>()
/** Foto do aluno; sem foto (ou antes de carregar a URL), iniciais sobre a faixa. */
function StudentAvatar({
  path,
  name,
  belt,
  resolve,
  className = 'avatar small',
}: {
  path: string | null
  name: string
  belt: Belt
  resolve: (paths: string[]) => Promise<Record<string, string>>
  className?: string
}) {
  const [url, setUrl] = useState(() => (path ? avatarUrlCache.get(path) : undefined))
  useEffect(() => {
    if (!path) {
      setUrl(undefined)
      return
    }
    const cached = avatarUrlCache.get(path)
    if (cached) {
      setUrl(cached)
      return
    }
    let vivo = true
    resolve([path])
      .then((r) => {
        const u = r[path]
        if (u && vivo) {
          avatarUrlCache.set(path, u)
          setUrl(u)
        }
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [path, resolve])
  if (url)
    return <img className={className + ' photo'} src={url} alt="" aria-hidden="true" />
  return (
    <span className={className + ' belt-' + belt} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
function Install() {
  const [prompt, setPrompt] = useState<any>(null),
    [help, setHelp] = useState(false)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    const listener = (e: Event) => {
      e.preventDefault()
      setPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', listener)
    return () => window.removeEventListener('beforeinstallprompt', listener)
  }, [])
  return (
    <>
      {needRefresh && (
        <div className="notice">
          Uma nova versão está disponível.{' '}
          <button className="text-button" onClick={() => void updateServiceWorker(true)}>
            Atualizar agora
          </button>
        </div>
      )}
      <button
        className="install-button"
        onClick={async () => {
          if (prompt) {
            await prompt.prompt()
            setPrompt(null)
          } else setHelp(!help)
        }}
      >
        <ArrowDownToLine size={16} /> Instalar no celular
      </button>
      {help && (
        <p className="install-help">
          No iPhone, abra no Safari e use Compartilhar → Adicionar à Tela de Início. No Android, use
          o menu do navegador → Instalar aplicativo. Se já estiver instalado, abra pelo ícone na
          tela inicial.
        </p>
      )}
    </>
  )
}
/** Mural de avisos da equipe: professor publica e apaga; todos leem. */
function Avisos({ call, staff }: { call: Call; staff: boolean }) {
  const [itens, setItens] = useState<Announcement[] | null>(null)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState('')
  const [pending, setPending] = useState(false)
  const load = useCallback(() => {
    call<Announcement[]>('list_announcements')
      .then(setItens)
      .catch(() => {
        setItens([])
        setErro('Não foi possível carregar os avisos. Verifique sua conexão.')
      })
  }, [call])
  useEffect(load, [load])
  async function publicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setErro('')
    setPending(true)
    try {
      await call('create_announcement', { p_body: texto.trim() })
      setTexto('')
      load()
    } catch (err) {
      setErro(friendlyError(err))
    } finally {
      setPending(false)
    }
  }
  async function apagar(id: string) {
    setErro('')
    try {
      await call('delete_announcement', { p_id: id })
      load()
    } catch (err) {
      setErro(friendlyError(err))
    }
  }
  return (
    <section className="announcements">
      <div className="section-heading">
        <h2>Avisos</h2>
      </div>
      {staff && (
        <form className="announcement-form" onSubmit={publicar}>
          <label className="sr-only" htmlFor="aviso-body">
            Novo aviso
          </label>
          <textarea
            id="aviso-body"
            value={texto}
            maxLength={500}
            rows={2}
            placeholder="Escreva um aviso para a equipe…"
            onChange={(e) => setTexto(e.target.value)}
          />
          <button className="primary" disabled={pending || texto.trim().length < 2}>
            Publicar
          </button>
        </form>
      )}
      {erro && (
        <p className="error-message" role="alert">
          {erro}
        </p>
      )}
      {itens === null ? null : itens.length === 0 ? (
        <p className="empty">
          Nenhum aviso publicado.
          {staff ? ' Use o campo acima para avisar a equipe sobre mudanças de horário, eventos ou recados.' : ' Os avisos da equipe aparecem aqui.'}
        </p>
      ) : (
        itens.map((n) => (
          <article className="announcement" key={n.id}>
            <p>{n.body}</p>
            <footer>
              <span>
                {n.author_name} ·{' '}
                {new Date(n.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                })}
              </span>
              {staff && (
                <button className="text-button" onClick={() => apagar(n.id)} aria-label="Apagar aviso">
                  Apagar
                </button>
              )}
            </footer>
          </article>
        ))
      )}
    </section>
  )
}
function Auth({
  onDemo,
  recovery,
  onRecovered,
}: {
  onDemo: () => void
  recovery: boolean
  onRecovered: () => void
}) {
  const inviteCode = new URLSearchParams(location.search).get('codigo') ?? ''
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(inviteCode ? 'signup' : 'login'),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [criandoTurma, setCriandoTurma] = useState(false)
  const [verSenha, setVerSenha] = useState(false)
  const lock = useRef(false)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (lock.current) return
    setError('')
    setMessage('')
    if (!navigator.onLine) {
      setError('Você está sem conexão.')
      return
    }
    if (!supabase) {
      setError('A equipe ainda não foi conectada. Enquanto isso, conheça a demonstração abaixo.')
      return
    }
    lock.current = true
    setPending(true)
    const data = new FormData(e.currentTarget),
      email = String(data.get('email') ?? '').trim(),
      password = String(data.get('password') ?? '')
    try {
      if (recovery) {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setMessage('Senha atualizada.')
        onRecovered()
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              name: String(data.get('name')).trim(),
              ...(criandoTurma
                ? { new_team: String(data.get('new_team')).trim() }
                : { class_code: String(data.get('code')).trim() }),
            },
          },
        })
        if (error) throw error
        setMessage('Cadastro recebido! Confira seu e-mail para confirmar a conta antes de entrar.')
        setMode('login')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/?recovery=1',
        })
        if (error) throw error
        setMessage(
          'Se houver uma conta com este e-mail, você receberá um link para redefinir a senha.',
        )
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  function switchMode(next: typeof mode) {
    setMode(next)
    setVerSenha(false)
    setError('')
    setMessage('')
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow" aria-hidden="true">
            UM TREINO DE CADA VEZ
          </span>
          <h1>
            O seu caminho
            <br />
            no tatame.
          </h1>
          <p>Cada presença faz parte da sua evolução.</p>
          <div className="gi-art" aria-hidden="true">
            <div className="gi-fold fold-left" />
            <div className="gi-fold fold-right" />
            <div className="gi-belt">
              <i />
              <i />
              <i />
            </div>
            <div className="gi-knot" />
          </div>
        </div>
        <span className="story-footer" aria-hidden="true">
          PRESENÇA. CONSTÂNCIA. EVOLUÇÃO.
        </span>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow" aria-hidden="true">
            MINHA TURMA
          </span>
          <h2>
            {recovery
              ? 'Crie sua nova senha'
              : mode === 'signup'
                ? 'Vamos começar.'
                : mode === 'forgot'
                  ? 'Recuperar acesso'
                  : 'Bom ter você aqui.'}
          </h2>
          <p className="muted">
            {recovery
              ? 'Escolha uma senha com pelo menos 8 caracteres.'
                : mode === 'signup'
                  ? criandoTurma
                    ? 'Dê um nome à sua turma; você vira o responsável.'
                    : 'Alunos usam o código da equipe; professores usam o código de professor.'
                  : mode === 'forgot'
                  ? 'Enviaremos um link para o seu e-mail.'
                  : 'Entre para acompanhar seus treinos.'}
          </p>
          <form onSubmit={submit}>
            {!recovery && mode === 'signup' && (
              <Field label="Nome completo">
                <input name="name" autoComplete="name" minLength={2} maxLength={100} required />
              </Field>
            )}
            {!recovery && (
              <Field label="E-mail">
                <input name="email" type="email" autoComplete="email" required />
              </Field>
            )}
            {(recovery || mode !== 'forgot') && (
              <Field label="Senha">
                <div className="password-wrap">
                  <input
                    name="password"
                    type={verSenha ? 'text' : 'password'}
                    minLength={8}
                    autoComplete={mode === 'signup' || recovery ? 'new-password' : 'current-password'}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setVerSenha((v) => !v)}
                    aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    aria-pressed={verSenha}
                  >
                    {verSenha ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </Field>
            )}
            {!recovery && mode === 'signup' && (
              <>
                <div className="signup-choice" role="group" aria-label="Como entrar">
                  <button
                    type="button"
                    className={!criandoTurma ? 'choice active' : 'choice'}
                    aria-pressed={!criandoTurma}
                    onClick={() => setCriandoTurma(false)}
                  >
                    Tenho um código
                  </button>
                  <button
                    type="button"
                    className={criandoTurma ? 'choice active' : 'choice'}
                    aria-pressed={criandoTurma}
                    onClick={() => setCriandoTurma(true)}
                  >
                    Criar minha turma
                  </button>
                </div>
                {criandoTurma ? (
                  <Field label="Nome da sua turma">
                    <input name="new_team" minLength={2} maxLength={80} autoComplete="organization" required />
                  </Field>
                ) : (
                  <Field label="Código da equipe ou de professor">
                    <input
                      name="code"
                      minLength={8}
                      maxLength={128}
                      autoComplete="off"
                      defaultValue={inviteCode}
                      required
                    />
                  </Field>
                )}
              </>
            )}
            {mode === 'login' && !recovery && (
              <button
                type="button"
                className="text-button forgot"
                onClick={() => switchMode('forgot')}
              >
                Esqueci minha senha
              </button>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="success-message" role="status">
                {message}
              </p>
            )}
            <button className="primary full" disabled={pending}>
              {pending
                ? 'Aguarde…'
                : recovery
                  ? 'Salvar nova senha'
                  : mode === 'signup'
                    ? 'Cadastrar'
                    : mode === 'forgot'
                      ? 'Enviar link'
                      : 'Entrar'}
              <ArrowRight size={18} />
            </button>
          </form>
          {!recovery && (
            <p className="auth-switch">
              {mode === 'login' ? 'Primeira vez por aqui? ' : ''}
              <button
                className="text-button"
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
              >
                {mode === 'login' ? 'Criar conta' : 'Voltar para entrar'}
              </button>
            </p>
          )}
          {recovery && (
            <button className="text-button" onClick={onRecovered}>
              Voltar para entrar
            </button>
          )}
          {!supabase && (
            <div className="setup-note">
              <ShieldCheck size={19} />
              <span>A equipe está em preparação. O acesso real será liberado após a conexão.</span>
            </div>
          )}
          {!recovery && (
            <button className="demo-entry" onClick={onDemo}>
              <span className="demo-entry-head">
                Conhecer a demonstração <ArrowRight size={16} />
              </span>
              <span className="demo-entry-detail">
                Presença, graduação, agenda e gestão com dados fictícios — nada é salvo.
              </span>
            </button>
          )}
          <Install />
        </div>
      </section>
    </main>
  )
}
type Mutate = (name: string, args?: Record<string, unknown>) => Promise<void>
type AvatarUpload = (path: string, file: Blob) => Promise<void>
function StudentSummary({
  student: s,
  goal,
  teacher,
  call,
  mutate,
  resolveAvatars,
  uploadAvatarFile,
  teamId,
  onChanged,
  account,
}: {
  student: StudentView
  goal: number | null
  teacher: boolean
  call?: Call
  mutate?: Mutate
  resolveAvatars?: (paths: string[]) => Promise<Record<string, string>>
  uploadAvatarFile?: AvatarUpload
  teamId?: string
  onChanged?: () => void
  account?: { email: string; changeEmail: (v: string) => Promise<void>; changePassword: (v: string) => Promise<void> }
}) {
  const p = progress(s.cycle, goal)
  // Presença histórica lançada antes da entrada do aluno deixa total > held;
  // nesse caso a frequência não é calculável — mostra "—" em vez de derrubar a tela.
  const freq = s.total <= s.held ? frequencyRate(s.total, s.held) : null
  const seq = streak(
    s.attendances.filter((a) => a.status === 'confirmada').map((a) => a.date),
    s.today,
  )
  const toast = useToast()
  const [edit, setEdit] = useState(false),
    [nome, setNome] = useState(s.name),
    [contact, setContact] = useState(s.contact ?? ''),
    [birth, setBirth] = useState(s.birthDate ?? ''),
    [foto, setFoto] = useState<File | null>(null),
    [novoEmail, setNovoEmail] = useState(''),
    [novaSenha, setNovaSenha] = useState('')
  // O dono edita o perfil da equipe técnica; qualquer professor edita o perfil
  // dos alunos. A foto continua sendo enviada pelo próprio membro (Storage).
  const podeEditar = !!call && !!mutate && !!uploadAvatarFile && !!teamId
  const escolherFoto = async (file: File | null) => {
    if (!file || !uploadAvatarFile || !teamId) return
    try {
      const blob = await compressImage(file)
      const path = buildAvatarPath(teamId, s.id, blob)
      await uploadAvatarFile(path, blob)
      const old = await call!<string>('set_avatar', { p_path: path })
      await removeAvatar(old)
      avatarUrlCache.delete(path)
      onChanged?.()
      toast.show('Foto atualizada.')
    } catch (e) {
      toast.show(friendlyError(e))
    }
  }
  return (
    <>
      <section className="profile-card">
        <StudentAvatar
          path={s.avatarPath}
          name={s.name}
          belt={s.belt}
          resolve={resolveAvatars ?? (async () => ({}))}
          className="avatar"
        />
        <div className="profile-meta">
          <h2>{s.name}</h2>
          <span>Na equipe desde {dateLabel(s.joinedAt.slice(0, 10))} de {s.joinedAt.slice(0, 4)}</span>
          {teacher && s.contact && <span>Contato: {s.contact}</span>}
          {teacher && s.birthDate && <span>Nascimento: {dateLabel(s.birthDate)}</span>}
          {s.memberStatus === 'inativo' && <span className="status-pill">Inativo</span>}
        </div>
        {podeEditar && (
          <button
            className="secondary edit-profile"
            type="button"
            onClick={() => {
              // Reabre com os dados atuais: um refresh em segundo plano pode ter mudado o perfil.
              setNome(s.name)
              setContact(s.contact ?? '')
              setBirth(s.birthDate ?? '')
              setNovoEmail('')
              setNovaSenha('')
              setEdit(true)
            }}
          >
            <Camera size={16} /> Editar perfil
          </button>
        )}
      </section>
      {podeEditar && (
        <BottomSheet open={edit} title="Editar perfil" onClose={() => setEdit(false)}>
          <div className="menu-list profile-edit">
            {!teacher && (
              <>
                <Field label="Foto">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Escolher foto do perfil"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      setFoto(f)
                      if (f) escolherFoto(f)
                    }}
                  />
                </Field>
                {foto && <p className="field-help">A foto é enviada assim que escolhida.</p>}
              </>
            )}
            <Field label="Nome">
              <input
                value={nome}
                maxLength={80}
                onChange={(e) => setNome(e.target.value)}
              />
            </Field>
            <Field label="Contato (telefone ou e-mail)">
              <input
                value={contact}
                maxLength={120}
                onChange={(e) => setContact(e.target.value)}
              />
            </Field>
            <Field label="Nascimento">
              <input
                type="date"
                value={birth}
                max={s.today}
                onChange={(e) => setBirth(e.target.value)}
              />
            </Field>
            <ActionButton
              className="primary"
              action={async () => {
                if (teacher) {
                  await mutate!('update_member_profile', {
                    p_user: s.id,
                    p_name: nome,
                    p_contact: contact,
                    p_birth_date: birth || null,
                  })
                } else {
                  await mutate!('update_my_profile', {
                    p_name: nome,
                    p_contact: contact,
                    p_birth_date: birth || null,
                  })
                }
                setEdit(false)
                onChanged?.()
              }}
              success="Perfil atualizado."
            >
              Salvar perfil
            </ActionButton>
            {account && (
              <>
                <h4 className="sheet-section">Conta</h4>
                <p className="field-help">
                  E-mail atual: {account.email}
                </p>
                <Field label="Novo e-mail">
                  <input
                    type="email"
                    value={novoEmail}
                    autoComplete="email"
                    onChange={(e) => setNovoEmail(e.target.value)}
                  />
                </Field>
                <ActionButton
                  className="secondary"
                  action={async () => {
                    const v = novoEmail.trim()
                    if (!v || !v.includes('@')) throw new Error('Informe um e-mail válido.')
                    await account.changeEmail(v)
                    setNovoEmail('')
                  }}
                  success="Enviamos uma confirmação para o novo e-mail. Confirme lá para valer."
                >
                  Alterar e-mail
                </ActionButton>
                <Field label="Nova senha">
                  <input
                    type="password"
                    value={novaSenha}
                    autoComplete="new-password"
                    minLength={6}
                    onChange={(e) => setNovaSenha(e.target.value)}
                  />
                </Field>
                <ActionButton
                  className="secondary"
                  action={async () => {
                    if (novaSenha.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.')
                    await account.changePassword(novaSenha)
                    setNovaSenha('')
                  }}
                  success="Senha alterada."
                >
                  Alterar senha
                </ActionButton>
              </>
            )}
          </div>
        </BottomSheet>
      )}
      <section className="rank-card">
        <div className="rank-heading">
          <span className="eyebrow" aria-hidden="true">
            {teacher ? 'GRADUAÇÃO ATUAL' : 'SUA GRADUAÇÃO'}
          </span>
          <Award size={20} />
        </div>
        <div className="rank-name">
          <h2>Faixa {s.belt}</h2>
          <span data-testid="current-degrees">
            {s.degrees} {s.degrees === 1 ? 'grau' : 'graus'}
          </span>
        </div>
        <BeltVisual belt={s.belt} degrees={s.degrees} />
        <div className="rank-footer" aria-hidden="true">
          <span>A evolução se constrói a cada treino.</span>
          <span>JIU-JÍTSU</span>
        </div>
      </section>
      <div className="stats-grid">
        <section className="stat-card">
          <span className="stat-label">
            <CalendarDays size={18} /> Total de aulas
          </span>
          <strong>{s.total}</strong>
          <span className="muted">Toda a sua caminhada</span>
        </section>
        <section className="stat-card">
          <span className="stat-label">
            <GraduationCap size={19} /> Neste ciclo
          </span>
          <strong data-testid="cycle-count">{s.cycle}</strong>
          <span className="muted">Desde a última graduação</span>
        </section>
        <section className="stat-card">
          <span className="stat-label">
            <TrendingUp size={18} /> Frequência
          </span>
          <strong data-testid="frequency-rate">{freq === null ? '—' : freq + '%'}</strong>
          <span className="muted">
            {seq > 0
              ? `Sequência: ${seq} ${seq === 1 ? 'treino' : 'treinos'}`
              : 'Desde sua entrada na equipe'}
          </span>
        </section>
      </div>
      {p && (
        <section className="goal-card">
          <div className="section-heading">
            <h3>Próximo passo</h3>
            <span>
              {s.cycle} / {goal} aulas
            </span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Progresso da meta de aulas"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p.percent}
          >
            <div style={{ width: p.percent + '%' }} />
          </div>
          <p>
            {p.reached
              ? 'Meta de referência alcançada.'
              : `Faltam ${p.remaining} aulas para a meta de referência.`}{' '}
            <span className="muted">A graduação é uma decisão do professor.</span>
          </p>
        </section>
      )}
    </>
  )
}
function History({
  s,
  teacher,
  mutate,
  call,
  collapsed = false,
}: {
  s: StudentView
  teacher: boolean
  mutate: Mutate
  call: Call
  /** Visão do professor: histórico vem recolhido para o Graduar dominar a tela. */
  collapsed?: boolean
}) {
  const [tab, setTab] = useState<'presencas' | 'graduacoes'>('presencas'),
    [limit, setLimit] = useState(12),
    [correction, setCorrection] = useState(s.today),
    [correctionTime, setCorrectionTime] = useState('19:00'),
    [aberto, setAberto] = useState(!collapsed)
  if (!aberto)
    return (
      <section className="history-card collapsed">
        <div className="section-heading">
          <h3>{teacher ? 'Histórico do aluno' : 'Seu histórico'}</h3>
          <span className="muted">{s.total} aulas</span>
        </div>
        <button className="secondary" type="button" onClick={() => setAberto(true)}>
          Ver histórico
        </button>
      </section>
    )
  return (
    <section className="history-card">
      <div className="section-heading">
        <h3>{teacher ? 'Histórico do aluno' : 'Seu histórico'}</h3>
        <span className="muted">{s.total} aulas</span>
      </div>
      <div className="tabs">
        <button
          className={tab === 'presencas' ? 'active' : ''}
          onClick={() => {
            setTab('presencas')
            setLimit(12)
          }}
        >
          Presenças
        </button>
        <button
          className={tab === 'graduacoes' ? 'active' : ''}
          onClick={() => {
            setTab('graduacoes')
            setLimit(12)
          }}
        >
          Graduações
        </button>
      </div>
      {tab === 'presencas' ? (
        <>
          {teacher && (
            <div className="correction-row">
              <Field label="Data do treino">
                <input
                  type="date"
                  max={s.today}
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                />
              </Field>
              <Field label="Horário">
                <input
                  type="time"
                  value={correctionTime}
                  onChange={(e) => setCorrectionTime(e.target.value)}
                />
              </Field>
              <ActionButton
                className="secondary"
                disabled={
                  !correction ||
                  correction > s.today ||
                  new Date(zonedToUtc(correction, correctionTime)).getTime() > Date.now()
                }
                action={async () => {
                  const session = await call<string>('create_session', {
                    p_title: 'Treino',
                    p_starts_at: zonedToUtc(correction, correctionTime),
                    p_duration: 60,
                  })
                  await mutate('teacher_add_presence', { p_session: session, p_student: s.id })
                }}
                success="Presença adicionada."
              >
                <Plus size={17} /> Adicionar
              </ActionButton>
            </div>
          )}
          {s.attendances.length === 0 ? (
            <p className="empty">
              Nenhuma presença ainda. Sua caminhada começa no primeiro treino.
            </p>
          ) : (
            s.attendances.slice(0, limit).map((a) => (
              <div
                className={'history-row ' + (a.status === 'rejeitada' ? 'cancelled' : '')}
                key={a.sessionId}
              >
                <span className="history-icon">
                  <Check size={17} />
                </span>
                <div>
                  <strong>{a.title}</strong>
                  <span>
                    {dayLabel(a.startsAt)} de {a.date.slice(0, 4)} · {timeLabel(a.startsAt)}
                  </span>
                </div>
                <span className="status-pill">
                  {a.status === 'confirmada' ? 'Presente' : presenceLabel[a.status]}
                </span>
                {teacher && (
                  <ActionButton
                    label={`Remover presença de ${dayLabel(a.startsAt)}`}
                    className="icon-button danger"
                    confirm={`Remover a presença de ${dayLabel(a.startsAt)}? A contagem de aulas será atualizada.`}
                    action={() =>
                      mutate('teacher_remove_presence', {
                        p_student: s.id,
                        p_session: a.sessionId,
                      })
                    }
                  >
                    <Trash2 size={17} />
                  </ActionButton>
                )}
              </div>
            ))
          )}
        </>
      ) : s.events.length === 0 ? (
        <p className="empty">Suas graduações aparecerão aqui.</p>
      ) : (
        s.events.slice(0, limit).map((e) => (
          <div className={'history-row ' + (e.cancelled ? 'cancelled' : '')} key={e.id}>
            <span className="history-icon">
              <Award size={19} />
            </span>
            <div>
              <strong>
                {e.kind === 'initial'
                  ? 'Situação inicial'
                  : e.kind === 'faixa'
                    ? 'Nova faixa'
                    : 'Grau recebido'}
                {e.cancelled ? ' · Desfeito' : ''}
              </strong>
              <span>
                Faixa {e.belt} · {e.degrees} {e.degrees === 1 ? 'grau' : 'graus'} ·{' '}
                {dateLabel(e.date)} de {e.date.slice(0, 4)}
              </span>
              {e.note && <span className="muted">{e.note}</span>}
            </div>
          </div>
        ))
      )}
      {(tab === 'presencas' ? s.attendances.length : s.events.length) > limit && (
        <button className="text-button more" onClick={() => setLimit(limit + 12)}>
          Mostrar mais
        </button>
      )}
    </section>
  )
}
function TeacherActions({ s, mutate, owner }: { s: StudentView; mutate: Mutate; owner: boolean }) {
  const [belt, setBelt] = useState<Belt>('branca'),
    [degrees, setDegrees] = useState(0),
    [note, setNote] = useState(''),
    [sheet, setSheet] = useState(false)
  const toast = useToast()
  // A failed/uncertain retry keeps its request key until the server revision changes.
  const keys = useRef<Record<string, string>>({})
  // O toast de Desfazer roda depois do refresh; o ref guarda o estado mais recente.
  const sRef = useRef(s)
  sRef.current = s
  const keyFor = (kind: string) =>
    keys.current[sRef.current.revision + kind] ??
    (keys.current[sRef.current.revision + kind] = crypto.randomUUID())
  const last = s.events.find((e) => e.kind !== 'initial' && !e.cancelled),
    next = belts[belts.indexOf(s.belt) + 1]
  // Plano UX fase 5: graduar em 2 toques — a folha executa na hora e o toast
  // oferece o Desfazer; por isso não há diálogo de confirmação aqui. A folha
  // só fecha no sucesso: se o mutate falhar, o erro aparece dentro dela.
  const graduar = (kind: 'grau' | 'faixa') => {
    const st = sRef.current
    return mutate('graduate_student', {
      p_student: st.id,
      p_kind: kind,
      p_key: keyFor(kind),
      p_revision: st.revision,
      p_note: note.trim() || null,
    })
      .then(() => {
        setSheet(false)
        setNote('')
        const msg =
          kind === 'grau'
            ? 'Grau concedido.'
            : `Promovido para a faixa ${belts[belts.indexOf(st.belt) + 1]}.`
        toast.show(msg, () => {
          const atual = sRef.current
          const ev = atual.events.find((e) => e.kind !== 'initial' && !e.cancelled)
          return mutate('undo_graduation', {
            p_student: st.id,
            p_event: ev?.id,
            p_revision: atual.revision,
          })
        })
      })
  }
  return (
    <section className="teacher-actions">
      <div className="section-heading">
        <h3>Acompanhar evolução</h3>
        <ShieldCheck size={19} />
      </div>
      {!s.initialSet && (
        <div className="initial-form">
          <p>
            Este aluno já tem uma graduação? Defina a situação inicial antes de conceder graus. Isso
            não adiciona aulas anteriores.
          </p>
          <div className="form-grid">
            <Field label="Faixa inicial">
              <select
                value={belt}
                onChange={(e) => {
                  setBelt(e.target.value as Belt)
                  setDegrees(0)
                }}
              >
                {belts.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Graus iniciais">
              <select value={degrees} onChange={(e) => setDegrees(Number(e.target.value))}>
                {Array.from({ length: belt === 'preta' ? 1 : 5 }, (_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Observação (opcional)">
              <input
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <ActionButton
            className="secondary"
            confirm={`Definir faixa ${belt} com ${degrees} graus como situação inicial? Essa definição é feita uma única vez.`}
            action={() =>
              mutate('set_initial', {
                p_student: s.id,
                p_belt: belt,
                p_degrees: degrees,
                p_revision: s.revision,
                p_note: note.trim() || null,
              })
            }
          >
            Salvar situação inicial
          </ActionButton>
        </div>
      )}
      {s.belt !== 'preta' && (
        <button className="primary graduar-trigger" type="button" onClick={() => setSheet(true)}>
          <Award size={18} /> Graduar
        </button>
      )}
      {s.belt === 'preta' && (
        <p className="muted">Graus da faixa preta não são acompanhados nesta versão.</p>
      )}
      <div className="teacher-actions-row">
        <OverflowMenu label="Mais ações">
          {/* data-stay: o menu não fecha ao clicar, para o diálogo de confirmação existir. */}
          <div data-stay>
            {last && (
              <ActionButton
                className="text-button danger"
                confirm="Desfazer a última graduação? A faixa, os graus e a contagem do ciclo serão restaurados; as presenças serão mantidas."
                success="Graduação desfeita."
                action={() =>
                  mutate('undo_graduation', {
                    p_student: s.id,
                    p_event: last.id,
                    p_revision: s.revision,
                  })
                }
              >
                Desfazer última graduação
              </ActionButton>
            )}
            {owner && s.role === 'aluno' && (
              <ActionButton
                className="text-button"
                confirm={`Tornar ${s.name} professor? Ele passa a ver a agenda, lançar presenças e publicar avisos.`}
                success={`${s.name} agora é professor.`}
                action={() => mutate('set_member_role', { p_user: s.id, p_role: 'professor' })}
              >
                Tornar professor
              </ActionButton>
            )}
            {s.memberStatus === 'ativo' ? (
              <ActionButton
                className="text-button danger"
                confirm={`Marcar ${s.name} como inativo? O aluno perde o acesso ao app; o histórico fica guardado e você pode reativar depois.`}
                success="Aluno marcado como inativo."
                action={() =>
                  mutate('set_student_status', { p_user: s.id, p_status: 'inativo' })
                }
              >
                Marcar como inativo
              </ActionButton>
            ) : (
              s.memberStatus === 'inativo' && (
                <ActionButton
                  className="text-button"
                  confirm={`Reativar ${s.name}? O aluno volta a ter acesso ao app.`}
                  success="Aluno reativado."
                  action={() =>
                    mutate('set_student_status', { p_user: s.id, p_status: 'ativo' })
                  }
                >
                  Reativar aluno
                </ActionButton>
              )
            )}
          </div>
        </OverflowMenu>
      </div>
      <BottomSheet open={sheet} title="Graduar" onClose={() => setSheet(false)}>
        <div className="menu-list">
          <Field label="Observação (opcional)">
            <input
              value={note}
              maxLength={300}
              placeholder="Ex.: examenito, seminário..."
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <ActionButton className="primary" disabled={s.degrees >= 4} action={() => graduar('grau')}>
            <Award size={18} /> +1 grau
          </ActionButton>
          {next && (
            <ActionButton className="secondary" action={() => graduar('faixa')}>
              Nova faixa {next}
            </ActionButton>
          )}
          <p className="field-help">A ação é aplicada na hora; use o Desfazer do aviso se errar.</p>
        </div>
      </BottomSheet>
    </section>
  )
}
function JoinCode({ call, owner, teamName }: { call: Call; owner: boolean; teamName: string }) {
  const [code, setCode] = useState<string | null | undefined>(undefined),
    [custom, setCustom] = useState(''),
    [copied, setCopied] = useState(''),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    setError('')
    setCode(undefined)
    call<string | null>('get_join_code')
      .then(setCode)
      .catch((e) => setError(friendlyError(e)))
  }, [call, retry])
  const link = code ? `${location.origin}/?codigo=${encodeURIComponent(code)}` : ''
  const message = code
    ? `Olá! Para entrar na equipe ${teamName} no app Tatame, abra ${link} e cadastre-se. Código da equipe: ${code}`
    : ''
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(what)
    setTimeout(() => setCopied(''), 2500)
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Código da equipe', text: message })
        return
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return
      }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank', 'noopener')
  }
  return (
    <section className="settings-card join-code">
      <h2>Código de acesso.</h2>
      <p className="muted">
        Envie para seus alunos. Quem se cadastrar com ele entra como pendente até você aprovar em
        Alunos.
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setRetry((r) => r + 1)}>
            Tentar de novo
          </button>
        </p>
      )}
      {code === undefined && !error && <p className="muted">Carregando…</p>}
      {code === null && (
        <p className="notice">
          O código atual foi criado antes desta versão e não pode ser exibido.{' '}
          {owner ? 'Gere um novo código abaixo.' : 'Peça ao dono da equipe para gerar um novo.'}
        </p>
      )}
      {code && (
        <>
          <p className="join-code-value" aria-label="Código da equipe">
            {code}
          </p>
          <div className="graduation-buttons">
            <button className="primary" onClick={() => void share()}>
              <Share2 size={17} /> Compartilhar
            </button>
            <button className="secondary" onClick={() => void copy(code, 'code')}>
              <Copy size={17} /> {copied === 'code' ? 'Copiado!' : 'Copiar código'}
            </button>
            <button className="secondary" onClick={() => void copy(link, 'link')}>
              <Link2 size={17} /> {copied === 'link' ? 'Copiado!' : 'Copiar link de cadastro'}
            </button>
          </div>
          <p className="field-help">O link abre o cadastro com o código já preenchido.</p>
        </>
      )}
      {owner && (
        <details className="join-code-owner">
          <summary>Trocar código</summary>
          <p className="field-help">
            Quem já está cadastrado continua com acesso. O código antigo deixa de funcionar para
            novos cadastros.
          </p>
          <ActionButton
            className="secondary"
            confirm="Gerar um novo código? O código atual deixará de funcionar para novos cadastros."
            success="Novo código gerado."
            action={async () => setCode(await call<string>('generate_join_code'))}
          >
            <RefreshCw size={16} /> Gerar novo código
          </ActionButton>
          <Field label="Ou defina um código próprio">
            <input
              value={custom}
              minLength={8}
              maxLength={128}
              autoComplete="off"
              placeholder="Mínimo de 8 caracteres"
              onChange={(e) => setCustom(e.target.value)}
            />
          </Field>
          <ActionButton
            className="text-button"
            disabled={custom.trim().length < 8}
            success="Código atualizado."
            action={async () => {
              await call('set_join_code', { p_code: custom.trim() })
              setCode(custom.trim())
              setCustom('')
            }}
          >
            Usar este código
          </ActionButton>
        </details>
      )}
    </section>
  )
}
function Notifications({ demo }: { demo: boolean }) {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    if (demo) return setOn(false)
    currentSubscription()
      .then((s) => setOn(!!s))
      .catch(() => setOn(false))
  }, [demo])
  return (
    <div className="team-form">
      <h2>Notificações.</h2>
      <p className="muted">
        Receba um aviso neste aparelho quando um aluno fizer check-in. No iPhone, instale o app na
        tela inicial antes de ativar.
      </p>
      {!pushSupported() && <p className="field-help">Este navegador não oferece notificações.</p>}
      <ActionButton
        className={on ? 'secondary' : 'primary'}
        disabled={demo || on === null || !pushSupported()}
        success={on ? 'Notificações ativadas neste aparelho.' : 'Notificações desativadas.'}
        action={async () => {
          if (on) await disablePush()
          else await enablePush()
          setOn(!on)
        }}
      >
        {demo
          ? 'Indisponível na demonstração'
          : on
            ? 'Desativar notificações'
            : 'Ativar notificações'}
      </ActionButton>
    </div>
  )
}
/** Folha de edição do perfil de um membro da equipe técnica (dono edita professores). */
function StaffProfileSheet({
  m,
  mutate,
  onClose,
}: {
  m: StudentView
  mutate: Mutate
  onClose: () => void
}) {
  const [nome, setNome] = useState(m.name),
    [contact, setContact] = useState(m.contact ?? ''),
    [birth, setBirth] = useState(m.birthDate ?? '')
  return (
    <BottomSheet open title={`Perfil de ${m.name}`} onClose={onClose}>
      <form
        className="menu-list profile-edit"
        onSubmit={(e) => {
          e.preventDefault()
        }}
      >
        <Field label="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="Contato">
          <input
            value={contact}
            inputMode="tel"
            onChange={(e) => setContact(e.target.value)}
            placeholder="(11) 90000-0000"
          />
        </Field>
        <Field label="Data de nascimento">
          <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
        </Field>
        <ActionButton
          className="primary"
          action={async () => {
            await mutate('update_member_profile', {
              p_user: m.id,
              p_name: nome,
              p_contact: contact,
              p_birth_date: birth || null,
            })
            onClose()
          }}
          success="Perfil atualizado."
        >
          Salvar perfil
        </ActionButton>
      </form>
    </BottomSheet>
  )
}

/** Folha de graduação de um professor: situação inicial, grau, faixa e desfazer. */
function StaffGraduationSheet({
  m,
  mutate,
  onClose,
}: {
  m: StudentView
  mutate: Mutate
  onClose: () => void
}) {
  const [belt, setBelt] = useState<Belt>('branca'),
    [degrees, setDegrees] = useState(0),
    [note, setNote] = useState('')
  const next = belts[belts.indexOf(m.belt) + 1]
  const last = m.events.find((e) => e.kind !== 'initial' && !e.cancelled)
  const keyFor = (kind: string) => crypto.randomUUID()
  return (
    <BottomSheet open title={`Graduação de ${m.name}`} onClose={onClose}>
      <div className="menu-list profile-edit">
        {!m.initialSet ? (
          <>
            <p className="field-help">
              Defina a situação inicial: a faixa que a pessoa já tem e quantos graus.
            </p>
            <Field label="Faixa inicial">
              <select value={belt} onChange={(e) => setBelt(e.target.value as Belt)}>
                {belts.map((b) => (
                  <option key={b} value={b}>
                    Faixa {b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Graus iniciais">
              <select value={degrees} onChange={(e) => setDegrees(Number(e.target.value))}>
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Observação">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Opcional"
                maxLength={300}
              />
            </Field>
            <ActionButton
              className="primary"
              action={async () => {
                await mutate('set_initial', {
                  p_student: m.id,
                  p_belt: belt,
                  p_degrees: degrees,
                  p_revision: m.revision,
                  p_note: note.trim() || null,
                })
                onClose()
              }}
              success="Situação inicial definida."
            >
              Salvar situação inicial
            </ActionButton>
          </>
        ) : (
          <>
            <p className="field-help">
              Faixa {m.belt} · {m.degrees} {m.degrees === 1 ? 'grau' : 'graus'}
            </p>
            <Field label="Observação">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Opcional"
                maxLength={300}
              />
            </Field>
            <div className="form-grid">
              {m.degrees < 4 && (
                <ActionButton
                  className="primary"
                  action={async () => {
                    await mutate('graduate_student', {
                      p_student: m.id,
                      p_kind: 'grau',
                      p_key: keyFor('grau'),
                      p_revision: m.revision,
                      p_note: note.trim() || null,
                    })
                    onClose()
                  }}
                  success="Grau concedido."
                >
                  +1 grau
                </ActionButton>
              )}
              {next && (
                <ActionButton
                  className="secondary"
                  action={async () => {
                    await mutate('graduate_student', {
                      p_student: m.id,
                      p_kind: 'faixa',
                      p_key: keyFor('faixa'),
                      p_revision: m.revision,
                      p_note: note.trim() || null,
                    })
                    onClose()
                  }}
                  success={`Promovido para a faixa ${next}.`}
                >
                  Faixa {next}
                </ActionButton>
              )}
            </div>
            {last && (
              <ActionButton
                className="secondary"
                confirm="Desfazer a última graduação? A faixa e os graus serão restaurados."
                success="Graduação desfeita."
                action={async () => {
                  await mutate('undo_graduation', {
                    p_student: m.id,
                    p_event: last.id,
                    p_revision: m.revision,
                  })
                  onClose()
                }}
              >
                Desfazer última graduação
              </ActionButton>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  )
}

/** Equipe técnica: o dono edita perfis, gradua professores, elege o sucessor e rebaixa. */
function StaffSection({ call, mutate }: { call: Call; mutate: Mutate }) {
  const [staff, setStaff] = useState<StudentView[] | null>(null)
  const [erro, setErro] = useState('')
  const [perfil, setPerfil] = useState<StudentView | null>(null)
  const [graduar, setGraduar] = useState<StudentView | null>(null)
  const load = useCallback(() => {
    call<StudentView[]>('list_staff')
      .then((s) => {
        setErro('')
        setStaff(s)
      })
      .catch(() => {
        setStaff([])
        setErro('Não foi possível carregar a equipe técnica.')
      })
  }, [call])
  useEffect(() => {
    load()
  }, [load])
  return (
    <section className="settings-card">
      <h2>Equipe técnica.</h2>
      <p className="muted">
        Professores entram com o código de professor ou são promovidos na aba Alunos. Aqui o dono
        edita perfis, gradua e elege o próximo dono.
      </p>
      {erro && (
        <p className="error-message" role="alert">
          {erro}
        </p>
      )}
      {staff === null ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="staff-list">
          {staff.map((m) => (
            <li key={m.id}>
              <span className="staff-member">
                <StudentAvatar
                  path={m.avatarPath}
                  name={m.name}
                  belt={m.belt}
                  resolve={async () => ({})}
                />
                <span>
                  <strong>{m.name}</strong>
                  <span className="muted">
                    {m.role === 'dono' ? 'Dono da equipe' : 'Professor'} · Faixa {m.belt}
                    {m.degrees > 0 ? ` · ${m.degrees} ${m.degrees === 1 ? 'grau' : 'graus'}` : ''}
                  </span>
                </span>
              </span>
              {m.role === 'dono' ? (
                <span className="muted">Você</span>
              ) : (
                <OverflowMenu label={`Ações para ${m.name}`}>
                  <button className="menu-item" type="button" onClick={() => setPerfil(m)}>
                    <User size={16} /> Editar perfil
                  </button>
                  <button className="menu-item" type="button" onClick={() => setGraduar(m)}>
                    <GraduationCap size={16} /> Graduar
                  </button>
                  {/* data-stay: o menu não fecha ao clicar, para o diálogo de confirmação existir. */}
                  <div data-stay>
                    <ActionButton
                      className="text-button"
                      confirm={`Eleger ${m.name} como dono? Você volta a ser professor e ele passa a gerenciar a equipe.`}
                      success={`${m.name} agora é o dono da equipe.`}
                      action={async () => {
                        await mutate('transfer_ownership', { p_user: m.id })
                        load()
                      }}
                    >
                      <ShieldCheck size={16} /> Eleger como dono
                    </ActionButton>
                    <ActionButton
                      className="text-button danger"
                      confirm={`Voltar ${m.name} para aluno? Ele perde o acesso de professor.`}
                      success={`${m.name} voltou para aluno.`}
                      action={async () => {
                        await mutate('set_member_role', { p_user: m.id, p_role: 'aluno' })
                        load()
                      }}
                    >
                      Voltar para aluno
                    </ActionButton>
                  </div>
                </OverflowMenu>
              )}
            </li>
          ))}
        </ul>
      )}
      {perfil && (
        <StaffProfileSheet
          m={perfil}
          mutate={mutate}
          onClose={() => {
            setPerfil(null)
            load()
          }}
        />
      )}
      {graduar && (
        <StaffGraduationSheet
          m={graduar}
          mutate={mutate}
          onClose={() => {
            setGraduar(null)
            load()
          }}
        />
      )}
    </section>
  )
}

/** Código de professor: quem se cadastra com ele entra direto como professor ativo. */
function ProfCode({ call }: { call: Call }) {
  const [code, setCode] = useState<string | null | undefined>(undefined)
  const [custom, setCustom] = useState('')
  const [copied, setCopied] = useState(false)
  const [erro, setErro] = useState('')
  useEffect(() => {
    call<string | null>('get_prof_code')
      .then(setCode)
      .catch((e) => setErro(friendlyError(e)))
  }, [call])
  const link = 'https://tatame.app'
  const message = code
    ? `Olá! Para entrar como professor no app Tatame, abra ${link} e cadastre-se. Código de professor: ${code}`
    : ''
  return (
    <section className="settings-card">
      <h2>Código de professor.</h2>
      <p className="muted">
        Quem se cadastra com este código entra direto como professor, sem passar pela aprovação de
        aluno. Guarde-o: ele dá acesso de professor à equipe.
      </p>
      {erro && (
        <p className="error-message" role="alert">
          {erro}
        </p>
      )}
      {code === undefined ? (
        <p className="muted">Carregando…</p>
      ) : code ? (
        <>
          <p className="join-code-value" aria-label="Código de professor">
            {code}
          </p>
          <div className="join-code-actions">
            <button
              className="text-button"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code)
                } catch {
                  const area = document.createElement('textarea')
                  area.value = code
                  document.body.appendChild(area)
                  area.select()
                  document.execCommand('copy')
                  area.remove()
                }
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar'}
            </button>
            <ActionButton
              className="text-button"
              confirm="Gerar um novo código? O código atual deixa de funcionar."
              success="Novo código gerado."
              action={async () => setCode(await call<string>('generate_prof_code'))}
            >
              <RefreshCw size={16} /> Gerar novo
            </ActionButton>
          </div>
          {typeof navigator.share === 'function' && (
            <ActionButton
              className="secondary"
              action={async () => {
                await navigator.share({ title: 'Código de professor', text: message })
              }}
            >
              <Share2 size={17} /> Compartilhar
            </ActionButton>
          )}
        </>
      ) : (
        <p className="muted">Nenhum código de professor ainda.</p>
      )}
      <Field label="Definir código próprio">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Ex.: PROF-ACADEMIA-2026"
          minLength={8}
          maxLength={128}
        />
      </Field>
      <p className="field-help">Entre 8 e 128 caracteres.</p>
      <ActionButton
        className="secondary"
        disabled={custom.trim().length < 8}
        success="Código de professor salvo."
        action={async () => {
          await call('set_prof_code', { p_code: custom.trim() })
          setCode(custom.trim())
          setCustom('')
        }}
      >
        Salvar código
      </ActionButton>
    </section>
  )
}

/** Perfil do próprio professor: faixa, graus, contato e nascimento. */
function MyProfileSection({
  call,
  mutate,
  profileId,
}: {
  call: Call
  mutate: Mutate
  profileId: string
}) {
  const [me, setMe] = useState<StudentView | null>(null)
  const [erro, setErro] = useState('')
  const [edit, setEdit] = useState(false)
  const reload = useCallback(() => {
    call<StudentView>('student_detail', { p_student: profileId })
      .then((v) => {
        setErro('')
        setMe(v)
      })
      .catch((e) => {
        setMe(null)
        setErro(friendlyError(e))
      })
  }, [call, profileId])
  useEffect(() => {
    reload()
  }, [reload])
  return (
    <section className="settings-card">
      <h2>Seu perfil.</h2>
      {erro && (
        <p className="error-message" role="alert">
          {erro}
        </p>
      )}
      {!me && !erro && <p className="muted">Carregando…</p>}
      {me && (
        <>
          <p className="muted">
            Faixa {me.belt} · {me.degrees} {me.degrees === 1 ? 'grau' : 'graus'} · Na equipe desde{' '}
            {dateLabel(me.joinedAt)}.
          </p>
          <ActionButton
            className="secondary"
            action={async () => {
              setEdit(true)
            }}
          >
            <User size={17} /> Editar meu perfil
          </ActionButton>
          {edit && (
            <StaffProfileSheet
              m={me}
              mutate={mutate}
              onClose={() => {
                setEdit(false)
                reload()
              }}
            />
          )}
        </>
      )}
    </section>
  )
}

/** O dono exclui a própria conta e elege um professor para assumir a equipe. */
function DeleteAccount({
  call,
  owner,
  demo,
  onDeleted,
}: {
  call: Call
  owner: boolean
  demo: boolean
  onDeleted: () => void
}) {
  const [staff, setStaff] = useState<StudentView[] | null>(null)
  const [sucessor, setSucessor] = useState('')
  useEffect(() => {
    if (!owner) return
    call<StudentView[]>('list_staff')
      .then((s) => setStaff(s.filter((m) => m.role === 'professor')))
      .catch(() => setStaff(null))
  }, [call, owner])
  if (!owner) return null
  return (
    <section className="settings-card">
      <h2>Excluir minha conta.</h2>
      <p className="muted">
        A equipe passa para o professor escolhido. O que você registrou como professor (presenças,
        avisos, aulas) fica com ele; seu histórico como aluno é apagado. Essa ação não pode ser
        desfeita.
      </p>
      {demo ? (
        <p className="muted">Indisponível na demonstração.</p>
      ) : staff === null ? (
        <p className="error-message" role="alert">
          Não foi possível carregar a equipe técnica.
        </p>
      ) : staff.length === 0 ? (
        <p className="muted">
          Você precisa de um professor ativo na equipe para poder excluir sua conta — promova um
          professor na aba Alunos ou compartilhe o código de professor.
        </p>
      ) : (
        <>
          <Field label="Professor que assume a equipe">
            <select value={sucessor} onChange={(e) => setSucessor(e.target.value)}>
              <option value="">Escolher…</option>
              {staff.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <ActionButton
            className="danger"
            disabled={!sucessor}
            confirm={`Excluir sua conta? ${
              staff.find((m) => m.id === sucessor)?.name ?? 'O professor escolhido'
            } assume a equipe. Essa ação não pode ser desfeita.`}
            action={async () => {
              await call('delete_my_account', { p_successor: sucessor })
              onDeleted()
            }}
          >
            <Trash2 size={17} /> Excluir minha conta
          </ActionButton>
        </>
      )}
    </section>
  )
}

function Settings({
  goal,
  mutate,
  team,
  owner,
  call,
  demo,
  today,
  onChanged,
  onPreview,
  profileId,
  onDeleted,
}: {
  goal: number | null
  mutate: Mutate
  team: Team | null
  owner: boolean
  call: Call
  demo: boolean
  today: string
  onChanged: () => Promise<void>
  onPreview: (cores: { p: string; a: string } | null) => void
  profileId: string
  onDeleted: () => void
}) {
  const [value, setValue] = useState(goal?.toString() ?? ''),
    [name, setName] = useState(team?.name ?? ''),
    [primary, setPrimary] = useState(team?.primaryColor ?? '#234c3a'),
    [accent, setAccent] = useState(team?.accentColor ?? '#cee68b'),
    [logoError, setLogoError] = useState('')
  // Pré-visualização ao vivo: o App aplica as cores escolhidas; ao desmontar
  // (salvar ou sair da página) o preview é limpo e o visual salvo volta a valer.
  useEffect(() => {
    return () => onPreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const preview = (p: string, a: string) => onPreview({ p, a })
  const valid =
    value === '' ||
    (Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647)
  return (
    <>
      <JoinCode call={call} owner={owner} teamName={team?.name ?? 'da equipe'} />
      {owner && <ProfCode call={call} />}
      {owner && <StaffSection call={call} mutate={mutate} />}
      <MyProfileSection call={call} mutate={mutate} profileId={profileId} />
      <DeleteAccount call={call} owner={owner} demo={demo} onDeleted={onDeleted} />
      <section className="settings-card">
        <h2>Do jeito da sua equipe.</h2>
        <p className="muted">Uma referência para acompanhar a constância dos alunos.</p>
        <Field label="Meta de aulas por ciclo">
          <input
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Sem meta"
          />
        </Field>
        <p className="field-help">
          Deixe vazio para não usar meta. Ela nunca impede uma graduação.
        </p>
        <ActionButton
          className="primary"
          disabled={!valid}
          success="Configurações salvas."
          action={async () => {
            await mutate('update_settings', {
              p_goal: value === '' ? null : Number(value),
              p_code: null,
            })
          }}
        >
          Salvar configurações
        </ActionButton>
        {owner && (
          <div className="team-form">
            <h2>Visual da equipe.</h2>
            <p className="muted">Nome e cores aparecem para todos os alunos da equipe.</p>
            <Field label="Nome da equipe">
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="form-grid">
              <Field label="Cor principal">
                <input
                  type="color"
                  value={primary}
                  onChange={(e) => {
                    setPrimary(e.target.value)
                    preview(e.target.value, accent)
                  }}
                />
              </Field>
              <Field label="Cor de destaque">
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => {
                    setAccent(e.target.value)
                    preview(primary, e.target.value)
                  }}
                />
              </Field>
            </div>
            {(() => {
              // Bloqueia cores ilegíveis em vez de ajustá-las: o dono escolhe a alternativa.
              const falhas = falhasDeContraste(primary, accent)
              if (!falhas.length) return null
              return (
                <p className="error-message" role="alert">
                  {falhas.map((f) => `${f.par} fica difícil de ler. `).join('')}
                  Escolha uma combinação com mais contraste.
                </p>
              )
            })()}
            <ActionButton
              className="secondary"
              disabled={name.trim().length < 2 || falhasDeContraste(primary, accent).length > 0}
              success="Visual atualizado."
              action={() =>
                mutate('update_team', { p_name: name, p_primary: primary, p_accent: accent })
              }
            >
              Salvar visual
            </ActionButton>
            <div className="logo-row">
              {logoUrl(team?.logoPath) ? (
                <img className="logo-preview" src={logoUrl(team?.logoPath)!} alt="Logo atual" />
              ) : (
                <span className="muted">Sem logo. O app mostra a marca Tatame.</span>
              )}
            </div>
            <label className="secondary upload-button">
              {team?.logoPath ? 'Trocar logo' : 'Enviar logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Enviar logo da equipe"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file || !team) return
                  try {
                    const blob = await compressImage(file, 512, 0.9, 'image/webp')
                    const path = demo ? URL.createObjectURL(blob) : await uploadLogo(team.id, blob)
                    const old = await call<string | null>('set_team_logo', { p_path: path })
                    if (old) await removeLogo(old).catch(() => {})
                    await mutate('today_sp')
                    setLogoError('')
                  } catch (err) {
                    setLogoError(friendlyError(err))
                  }
                }}
              />
            </label>
            {team?.logoPath && (
              <ActionButton
                className="text-button danger"
                confirm="Remover a logo da equipe?"
                action={async () => {
                  const old = await call<string | null>('set_team_logo', { p_path: null })
                  if (old) await removeLogo(old).catch(() => {})
                  await mutate('today_sp')
                }}
              >
                Remover logo
              </ActionButton>
            )}
            {logoError && (
              <p className="error-message" role="alert">
                {logoError}
              </p>
            )}
            <p className="field-help">PNG, JPG ou WEBP. A imagem é reduzida para até 512 px.</p>
          </div>
        )}
        <Notifications demo={demo} />
      </section>
      <Schedules call={call} today={today} onChanged={onChanged} />
      {/* O logout fica na sidebar (desktop) e no topbar do celular; um Sair
          aqui virava um botão solto no fim da página. */}
    </>
  )
}
export default function App() {
  const [userId, setUserId] = useState<string | null>(null),
    [userEmail, setUserEmail] = useState(''),
    [demo, setDemo] = useState<ReturnType<typeof createDemo> | null>(null),
    [demoRole, setDemoRole] = useState<'aluno' | 'professor'>('aluno'),
    [data, setData] = useState<Dashboard | null>(null),
    [authReady, setAuthReady] = useState(!supabase),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [recovery, setRecovery] = useState(new URLSearchParams(location.search).has('recovery')),
    [page, setPage] = useState('overview'),
    [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(''),
    [reviewsToday, setReviewsToday] = useState(0),
    [jump, setJump] = useState<{ id: string; nonce: number } | null>(null),
    // Sidebar do desktop: recolhida para uma barra de ícones; escolha persistida.
    [sidebarOpen, setSidebarOpen] = useState(
      () => localStorage.getItem('tatame-sidebar') !== 'recolhida',
    ),
    // Pré-visualização do editor de visual: cores aplicadas antes de salvar.
    [preview, setPreview] = useState<{ p: string; a: string } | null>(null)
  const generation = useRef(0)
  const online = useConnection()
  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setUserId(data.session?.user.id ?? null)
        setUserEmail(data.session?.user.email ?? '')
        setAuthReady(true)
        if (error) setError(friendlyError(error))
      }
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      generation.current++
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? '')
      setAuthReady(true)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (!session) {
        setData(null)
        setSelected(null)
        setPage('overview')
      }
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [])
  const refresh = useCallback(async () => {
    if (!online) return
    const token = ++generation.current
    setLoading(true)
    try {
      const next = demo ? demo.load(demoRole) : userId ? await loadDashboard(userId) : null
      if (token === generation.current) {
        setData(next)
        setError('')
      }
    } catch (e) {
      if (token === generation.current) setError(friendlyError(e))
      throw e
    } finally {
      if (token === generation.current) setLoading(false)
    }
  }, [demo, demoRole, userId, online])
  useEffect(() => {
    void refresh().catch(() => {})
    const onFocus = () => void refresh().catch(() => {})
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') onFocus()
    }, 60000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
      generation.current++
    }
  }, [refresh])
  const call: Call = useCallback(
    async <T,>(name: string, args?: Record<string, unknown>) => {
      if (!navigator.onLine) throw new Error('Você está sem conexão.')
      return demo ? demo.call<T>(name, args) : rpc<T>(name, args)
    },
    [demo],
  ) as Call
  const mutate: Mutate = async (name, args) => {
    if (!online || !navigator.onLine) throw new Error('Você está sem conexão.')
    await call(name, args)
    await refresh()
  }
  // Conta (e-mail e senha) é do Supabase Auth; na demonstração, simula sucesso.
  const account = demo
    ? { email: 'lucas@tatame.demo', changeEmail: async () => {}, changePassword: async () => {} }
    : userId && supabase
      ? (() => {
          const sb = supabase
          return {
            email: userEmail,
            changeEmail: async (v: string) => {
              const { error } = await sb.auth.updateUser({ email: v })
              if (error) throw new Error(friendlyError(error))
            },
            changePassword: async (v: string) => {
              const { error } = await sb.auth.updateUser({ password: v })
              if (error) throw new Error(friendlyError(error))
            },
          }
        })()
      : undefined
  const team = data?.team
  useEffect(() => {
    const root = document.documentElement.style
    // Enquanto o dono escolhe cores, o preview vence o visual salvo — assim um
    // refresh em segundo plano não apaga a edição no meio.
    const cores = preview ?? (team ? { p: team.primaryColor, a: team.accentColor } : null)
    if (cores) {
      aplicarVisual(root, cores.p, cores.a)
    } else {
      limparVisual(root)
    }
    if (team) {
      // Barra do navegador e título da aba acompanham o visual da equipe.
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cores?.p ?? team.primaryColor)
      document.title = `${team.name} · Tatame`
    } else {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#234c3a')
      document.title = 'Tatame · Minha equipe'
    }
  }, [team, preview])
  async function logout() {
    if (supabase && !demo) {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    }
    generation.current++
    setDemo(null)
    setUserId(null)
    setData(null)
    setPage('overview')
    setSelected(null)
    setDemoRole('aluno')
  }
  if (!online)
    return (
      <div className="offline-screen">
        <Brand team={data?.team} />
        <WifiOff size={44} />
        <h1>Você está sem conexão</h1>
        <p>Conecte-se à internet para acessar sua equipe e registrar os treinos.</p>
        <p className="muted">Nenhuma ação será registrada enquanto você estiver offline.</p>
      </div>
    )
  if (!authReady)
    return (
      <div className="loading-screen" role="status">
        Carregando sua equipe…
      </div>
    )
  if ((!userId && !demo) || recovery)
    return (
      <Auth
        recovery={recovery}
        onRecovered={() => {
          setRecovery(false)
          history.replaceState(null, '', location.pathname)
        }}
        onDemo={() => {
          setDemo(createDemo())
          setDemoRole('aluno')
          setPage('overview')
        }}
      />
    )
  if (!data)
    return (
      <div className="loading-screen">
        <Brand />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <ActionButton className="primary" action={refresh}>
              Tentar novamente
            </ActionButton>
            <ActionButton className="text-button" action={logout}>
              Sair
            </ActionButton>
          </>
        ) : (
          <p role="status">Carregando sua equipe…</p>
        )}
      </div>
    )
  if (data.status !== 'ativo')
    return (
      <div className="loading-screen">
        <Brand team={data?.team} />
        <h1>{data.status === 'pendente' ? 'Cadastro recebido!' : 'Acesso bloqueado'}</h1>
        <p role="status">
          {data.status === 'pendente'
            ? `Seu professor da ${data.team?.name ?? 'equipe'} precisa aprovar sua entrada. Volte aqui depois.`
            : 'Fale com seu professor para liberar o acesso.'}
        </p>
        <ActionButton className="primary" action={refresh}>
          Verificar de novo
        </ActionButton>
        <ActionButton className="text-button" action={logout}>
          Sair
        </ActionButton>
      </div>
    )
  const teacher = isStaff(data.profile.role),
    owner = data.profile.role === 'dono',
    active = data.students.filter((s) => s.memberStatus === 'ativo'),
    pendingMembers = data.students.filter((s) => s.memberStatus === 'pendente'),
    inativos = data.students.filter((s) => s.memberStatus === 'inativo'),
    student = teacher ? data.students.find((s) => s.id === selected) : data.students[0],
    filtered = active.filter((s) =>
      s.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')),
    )
  const resolveAvatars = demo
    ? (paths: string[]) => demo.photos.urls(paths)
    : supabaseAvatarUrls
  const uploadAvatarFile: AvatarUpload = demo
    ? (path, file) => demo.photos.upload(path, file)
    : supabaseUploadAvatar
  const badgeTotal = teacher ? pendingMembers.length + reviewsToday : 0
  const pages = teacher
    ? [
        { id: 'overview', label: 'Hoje', icon: <CalendarCheck size={20} /> },
        { id: 'students', label: 'Alunos', icon: <Users size={20} /> },
        { id: 'agenda', label: 'Agenda', icon: <CalendarClock size={20} /> },
        { id: 'settings', label: 'Gestão', icon: <Settings2 size={20} /> },
      ]
    : [
        { id: 'overview', label: 'Início', icon: <CalendarCheck size={20} /> },
        { id: 'agenda', label: 'Treinos', icon: <CalendarClock size={20} /> },
        { id: 'history', label: 'Perfil', icon: <User size={20} /> },
      ]
  function nav(next: string) {
    setPage(next)
    setSelected(null)
    // jump é um salvo one-shot ("Fotos do treino"): sem limpar, toda visita
    // futura à Agenda reabriria a última aula saltada.
    setJump(null)
  }
  function toggleSidebar() {
    setSidebarOpen((aberta) => {
      localStorage.setItem('tatame-sidebar', aberta ? 'recolhida' : 'aberta')
      return !aberta
    })
  }
  /** Vem da aba Hoje ("Fotos do treino"): abre a aula na Agenda uma vez. */
  function openSession(id: string) {
    setJump({ id, nonce: Date.now() })
    setPage('agenda')
    setSelected(null)
  }
  return (
    <ToastProvider>
    <div className="app-shell">
      {demo && (
        <div className="demo-banner">
          <span>
            <span className="demo-dot" /> <strong>Modo demonstração</strong>
            <span className="demo-extra"> · Dados fictícios, nada é salvo</span>
          </span>
          <button
            onClick={() => {
              setDemoRole(demoRole === 'aluno' ? 'professor' : 'aluno')
              setSelected(null)
              setPage('overview')
              setJump(null)
            }}
          >
            Ver como {demoRole === 'aluno' ? 'professor' : 'aluno'} <ArrowRight size={14} />
          </button>
        </div>
      )}
      <aside className={'sidebar' + (sidebarOpen ? '' : ' collapsed')}>
        <button
          type="button"
          className="icon-button sidebar-toggle"
          aria-label={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
          onClick={toggleSidebar}
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <Brand team={data?.team} />
        <span className="sidebar-label">{(data.team?.name ?? 'Minha equipe').toUpperCase()}</span>
        <nav aria-label="Navegação principal">
          {pages.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? 'active' : ''}
              title={sidebarOpen ? undefined : p.label}
              onClick={() => nav(p.id)}
            >
              {p.icon} <span className="sidebar-text">{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Install />
          <div className="profile-mini">
            <span className="avatar" aria-hidden="true">
              {data.profile.name
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div className="sidebar-text">
              <strong>{data.profile.name}</strong>
              <span>{owner ? 'Dono da equipe' : teacher ? 'Professor' : 'Aluno'}</span>
            </div>
            <ActionButton className="icon-button" label="Sair" action={logout}>
              <LogOut size={18} />
            </ActionButton>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand team={data?.team} />
          </div>
          <span className="desktop-breadcrumb">
            {data.team?.name ?? 'Minha equipe'} <ChevronRight size={14} />{' '}
            {teacher ? 'Área do professor' : 'Área do aluno'}
          </span>
          <span className="date-chip">
            <span /> {dateLabel(data.today)}
          </span>
          <div className="mobile-logout">
            <ActionButton className="icon-button" label="Sair" action={logout}>
              <LogOut size={18} />
            </ActionButton>
          </div>
        </header>
        <main className="workspace">
          {error && (
            <div className="notice error-message" role="alert">
              {error}
              <button className="text-button" onClick={() => void refresh().catch(() => {})}>
                Atualizar
              </button>
            </div>
          )}
          {selected && (
            <button className="text-button back" onClick={() => setSelected(null)}>
              <ArrowLeft size={17} /> Todos os alunos
            </button>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow" aria-hidden="true">
                {teacher ? 'ÁREA DO PROFESSOR' : 'SEU JIU-JÍTSU, EM MOVIMENTO'}
              </span>
              <h1>
                {selected
                  ? student?.name
                  : page === 'settings'
                  ? 'Ajustes da equipe.'
                  : page === 'agenda'
                      ? teacher
                        ? 'Calendário.'
                        : 'Treinos da equipe.'
                      : page === 'history'
                        ? 'Sua caminhada.'
                        : teacher
                          ? page === 'students'
                            ? 'Sua equipe.'
                            : 'Hoje.'
                          : `Olá, ${data.profile.name.split(' ')[0]}.`}
              </h1>
              <p>
                {selected
                  ? 'Cada treino conta na evolução do aluno.'
                  : page === 'settings'
                    ? 'Acesso, meta, visual e horários padrão.'
                    : page === 'agenda'
                      ? teacher
                        ? 'Aulas, fotos, descrições, check-ins e presenças.'
                        : 'Toque num dia para ver o que foi treinado e as fotos.'
                      : page === 'history'
                        ? 'Um registro de cada passo no tatame.'
                        : teacher
                          ? page === 'students'
                            ? 'Acompanhe a presença e a evolução de cada aluno.'
                            : 'Aulas, chamada e pendências do dia.'
                          : 'Continue aparecendo. O resto é consequência.'}
              </p>
            </div>
            {loading && (
              <span className="muted" role="status">
                Atualizando…
              </span>
            )}
          </div>
          {page === 'settings' && teacher ? (
            <Settings
              goal={data.goal}
              mutate={mutate}
              team={data.team}
              owner={owner}
              call={call}
              demo={!!demo}
              today={data.today}
              onChanged={refresh}
              onPreview={setPreview}
              profileId={data.profile.id}
              onDeleted={logout}
            />
          ) : page === 'agenda' ? (
            <Agenda
              call={call}
              today={data.today}
              staff={teacher}
              photos={demo ? demo.photos : supabasePhotos}
              teamId={data.team?.id ?? ''}
              roster={active.map((x) => ({ id: x.id, name: x.name }))}
              onChanged={refresh}
              jump={jump}
            />
          ) : teacher && !student ? (
            page === 'overview' ? (
              <>
                <Today
                  call={call}
                  mutate={mutate}
                  today={data.today}
                  students={data.students}
                  roster={active.map((x) => ({ id: x.id, name: x.name }))}
                  onChanged={refresh}
                  onOpenSession={openSession}
                  onCounts={setReviewsToday}
                  staff
                />
                <Avisos call={call} staff />
              </>
            ) : (
              <section className="student-list">
                <div className="section-heading">
                  <h2>Alunos</h2>
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      aria-label="Buscar aluno"
                      value={search}
                      placeholder="Buscar por nome"
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                {filtered.length ? (
                  filtered.map((s) => (
                    <button className="student-row" key={s.id} onClick={() => setSelected(s.id)}>
                      <StudentAvatar
                        path={s.avatarPath}
                        name={s.name}
                        belt={s.belt}
                        resolve={resolveAvatars}
                      />
                      <span className="student-name">
                        <strong>{s.name}</strong>
                        <span>
                          Faixa {s.belt} · {s.degrees} {s.degrees === 1 ? 'grau' : 'graus'}
                        </span>
                      </span>
                      <span className="student-count">
                        <strong>{s.total}</strong>
                        <span>aulas</span>
                      </span>
                      <span className="student-cycle">
                        <strong>{s.cycle}</strong>
                        <span>no ciclo</span>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ))
                ) : (
                  <p className="empty">
                    {active.length
                      ? 'Nenhum aluno com esse nome.'
                      : 'Seus alunos aparecerão aqui quando se cadastrarem com o código da equipe.'}
                  </p>
                )}
                {inativos.length > 0 && (
                  <>
                    <div className="section-heading inactive-heading">
                      <h3>Inativos</h3>
                      <span className="muted">Sem acesso ao app</span>
                    </div>
                    {inativos
                      .filter((s) =>
                        s.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')),
                      )
                      .map((s) => (
                        <button className="student-row cancelled" key={s.id} onClick={() => setSelected(s.id)}>
                          <StudentAvatar
                            path={s.avatarPath}
                            name={s.name}
                            belt={s.belt}
                            resolve={resolveAvatars}
                          />
                          <span className="student-name">
                            <strong>{s.name}</strong>
                            <span>
                              Faixa {s.belt} · {s.total} {s.total === 1 ? 'aula' : 'aulas'}
                            </span>
                          </span>
                          <span className="status-pill">Inativo</span>
                          <ChevronRight size={18} />
                        </button>
                      ))}
                  </>
                )}
              </section>
            )
          ) : student ? (
            teacher ? (
              <div className="student-layout">
                <div className="student-primary">
                  <StudentSummary
                    student={student}
                    goal={data.goal}
                    teacher
                    call={call}
                    mutate={mutate}
                    resolveAvatars={resolveAvatars}
                    uploadAvatarFile={uploadAvatarFile}
                    teamId={data.team?.id ?? ''}
                    onChanged={refresh}
                  />
                  <History
                    key={student.id}
                    s={student}
                    teacher
                    mutate={mutate}
                    call={call}
                    collapsed
                  />
                </div>
                <TeacherActions
                  key={student.id}
                  s={student}
                  mutate={mutate}
                  owner={data.profile.role === 'dono'}
                />
              </div>
            ) : page === 'overview' ? (
              <>
                <TrainTab
                  student={student}
                  call={call}
                  photos={demo ? demo.photos : supabasePhotos}
                  onChanged={refresh}
                  onCheckin={demo ? undefined : notifyCheckin}
                />
                <Avisos call={call} staff={false} />
              </>
            ) : (
              <div className="student-primary">
                <StudentSummary
                  student={student}
                  goal={data.goal}
                  teacher={false}
                  call={call}
                  mutate={mutate}
                  resolveAvatars={resolveAvatars}
                  uploadAvatarFile={uploadAvatarFile}
                  teamId={data.team?.id ?? ''}
                  onChanged={refresh}
                  account={account}
                />
                <History key={student.id} s={student} teacher={false} mutate={mutate} call={call} />
                <ActionButton className="secondary" action={logout}>
                  <LogOut size={17} /> Sair
                </ActionButton>
              </div>
            )
          ) : null}
          <footer className="workspace-footer" aria-hidden="true">
            <span>Feito para a sua caminhada no tatame.</span>
            <span>TATAME</span>
          </footer>
          <div className="mobile-install">
            <Install />
          </div>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegação no celular">
        {pages.map((p) => (
          <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => nav(p.id)}>
            {p.icon}
            <span>
              {p.label}
              {p.id === 'overview' && badgeTotal > 0 && (
                <span className="nav-badge">{badgeTotal}</span>
              )}
            </span>
          </button>
        ))}
      </nav>
    </div>
    </ToastProvider>
  )
}
