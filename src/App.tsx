import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Award,
  CalendarDays,
  Check,
  ChevronRight,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  WifiOff,
  X,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { ActionButton } from './components/ActionButton'
import { belts, progress, type Belt } from './domain/rules'
import {
  friendlyError,
  loadDashboard,
  rpc,
  supabase,
  type Dashboard,
  type StudentView,
} from './lib/api'
import { createDemo } from './lib/demo'
import { useConnection } from './lib/useConnection'

const dateLabel = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
    new Date(day + 'T12:00:00Z'),
  )
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
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
    <div className={'belt-visual belt-' + belt} aria-label={`Faixa ${belt}, ${degrees} graus`}>
      <span className="belt-stitch" />
      <span className="belt-tip">
        {Array.from({ length: degrees }, (_, i) => (
          <i key={i} />
        ))}
      </span>
    </div>
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
function Auth({
  onDemo,
  recovery,
  onRecovered,
}: {
  onDemo: () => void
  recovery: boolean
  onRecovered: () => void
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login'),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
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
      setError('A turma ainda não foi conectada. Enquanto isso, conheça a demonstração abaixo.')
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
              class_code: String(data.get('code')).trim(),
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
    setError('')
    setMessage('')
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">UM TREINO DE CADA VEZ</span>
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
        <span className="story-footer">PRESENÇA. CONSTÂNCIA. EVOLUÇÃO.</span>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow">MINHA TURMA</span>
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
                ? 'Use o código recebido do seu professor.'
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
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete={mode === 'signup' || recovery ? 'new-password' : 'current-password'}
                  required
                />
              </Field>
            )}
            {!recovery && mode === 'signup' && (
              <Field label="Código da turma">
                <input name="code" minLength={8} maxLength={128} autoComplete="off" required />
              </Field>
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
              <span>A turma está em preparação. O acesso real será liberado após a conexão.</span>
            </div>
          )}
          {!recovery && (
            <button className="demo-entry" onClick={onDemo}>
              Conhecer a demonstração <ArrowRight size={16} />
            </button>
          )}
          <Install />
        </div>
      </section>
    </main>
  )
}
type Mutate = (name: string, args?: Record<string, unknown>) => Promise<void>
function StudentSummary({
  student: s,
  goal,
  teacher,
  mutate,
}: {
  student: StudentView
  goal: number | null
  teacher: boolean
  mutate: Mutate
}) {
  const p = progress(s.cycle, goal),
    attended = s.attendances.includes(s.today)
  return (
    <>
      <section className="rank-card">
        <div className="rank-heading">
          <span className="eyebrow">{teacher ? 'GRADUAÇÃO ATUAL' : 'SUA GRADUAÇÃO'}</span>
          <Award size={20} />
        </div>
        <div className="rank-name">
          <h2>Faixa {s.belt}</h2>
          <span data-testid="current-degrees">
            {s.degrees} {s.degrees === 1 ? 'grau' : 'graus'}
          </span>
        </div>
        <BeltVisual belt={s.belt} degrees={s.degrees} />
        <div className="rank-footer">
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
      </div>
      {!teacher && (
        <section className="checkin-card">
          <div className="checkin-icon">
            <CalendarDays size={24} />
          </div>
          <div className="checkin-copy">
            <h3>{attended ? 'Mais um treino na conta.' : 'Hoje é dia de evoluir.'}</h3>
            <p>{dateLabel(s.today)} · Uma presença por dia</p>
          </div>
          <ActionButton
            className="primary"
            disabled={attended}
            action={() => mutate('mark_attendance')}
          >
            {attended ? (
              <>
                <Check size={19} /> Presença registrada hoje
              </>
            ) : (
              <>
                <Plus size={19} /> Registrar presença
              </>
            )}
          </ActionButton>
        </section>
      )}
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
function History({ s, teacher, mutate }: { s: StudentView; teacher: boolean; mutate: Mutate }) {
  const [tab, setTab] = useState<'presencas' | 'graduacoes'>('presencas'),
    [limit, setLimit] = useState(12),
    [correction, setCorrection] = useState(s.today)
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
              <ActionButton
                className="secondary"
                disabled={!correction || correction > s.today}
                action={() =>
                  mutate('correct_attendance', {
                    p_student: s.id,
                    p_date: correction,
                    p_action: 'add',
                  })
                }
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
            s.attendances.slice(0, limit).map((date) => (
              <div className="history-row" key={date}>
                <span className="history-icon">
                  <Check size={17} />
                </span>
                <div>
                  <strong>Treino de jiu-jítsu</strong>
                  <span>
                    {dateLabel(date)} de {date.slice(0, 4)}
                  </span>
                </div>
                {teacher ? (
                  <ActionButton
                    label={`Remover presença de ${dateLabel(date)}`}
                    className="icon-button danger"
                    confirm={`Remover a presença de ${dateLabel(date)}? A contagem de aulas será atualizada.`}
                    action={() =>
                      mutate('correct_attendance', {
                        p_student: s.id,
                        p_date: date,
                        p_action: 'remove',
                      })
                    }
                  >
                    <Trash2 size={17} />
                  </ActionButton>
                ) : (
                  <span className="status-pill">Presente</span>
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
function TeacherActions({ s, mutate }: { s: StudentView; mutate: Mutate }) {
  const [belt, setBelt] = useState<Belt>('branca'),
    [degrees, setDegrees] = useState(0)
  // A failed/uncertain retry keeps its request key until the server revision changes.
  const keys = useRef<Record<string, string>>({})
  const keyFor = (kind: string) =>
    keys.current[s.revision + kind] ?? (keys.current[s.revision + kind] = crypto.randomUUID())
  const last = s.events.find((e) => e.kind !== 'initial' && !e.cancelled),
    next = belts[belts.indexOf(s.belt) + 1]
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
              })
            }
          >
            Salvar situação inicial
          </ActionButton>
        </div>
      )}
      <div className="graduation-buttons">
        <ActionButton
          className="primary"
          disabled={s.belt === 'preta' || s.degrees >= 4}
          confirm={`Conceder mais um grau a ${s.name}? As aulas do próximo ciclo começam amanhã.`}
          action={() =>
            mutate('graduate_student', {
              p_student: s.id,
              p_kind: 'grau',
              p_key: keyFor('grau'),
              p_revision: s.revision,
            })
          }
        >
          <Award size={18} /> Conceder grau
        </ActionButton>
        {next && (
          <ActionButton
            className="secondary"
            confirm={`Promover ${s.name} para a faixa ${next}? Os graus voltam a zero e o próximo ciclo começa amanhã.`}
            action={() =>
              mutate('graduate_student', {
                p_student: s.id,
                p_kind: 'faixa',
                p_key: keyFor('faixa'),
                p_revision: s.revision,
              })
            }
          >
            Promover para {next}
          </ActionButton>
        )}
      </div>
      {s.belt === 'preta' && (
        <p className="muted">Graus da faixa preta não são acompanhados nesta versão.</p>
      )}
      {last && (
        <ActionButton
          className="text-button danger"
          confirm="Desfazer a última graduação? A faixa, os graus e a contagem do ciclo serão restaurados; as presenças serão mantidas."
          action={() =>
            mutate('undo_graduation', { p_student: s.id, p_event: last.id, p_revision: s.revision })
          }
        >
          Desfazer última graduação
        </ActionButton>
      )}
    </section>
  )
}
function Settings({ goal, mutate }: { goal: number | null; mutate: Mutate }) {
  const [value, setValue] = useState(goal?.toString() ?? ''),
    [code, setCode] = useState('')
  const valid =
    value === '' ||
    (Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647)
  return (
    <section className="settings-card">
      <h2>Do jeito da sua turma.</h2>
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
      <p className="field-help">Deixe vazio para não usar meta. Ela nunca impede uma graduação.</p>
      <Field label="Novo código da turma">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          minLength={8}
          maxLength={128}
          autoComplete="off"
          placeholder="Deixe vazio para manter o atual"
        />
      </Field>
      <p className="field-help">
        De 8 a 128 caracteres. Compartilhe somente com seus alunos. Alterar o código não afeta quem
        já está cadastrado.
      </p>
      <ActionButton
        className="primary"
        disabled={!valid || (code !== '' && code.trim().length < 8)}
        success="Configurações salvas."
        action={async () => {
          await mutate('update_settings', {
            p_goal: value === '' ? null : Number(value),
            p_code: code.trim() || null,
          })
          setCode('')
        }}
      >
        Salvar configurações
      </ActionButton>
    </section>
  )
}
export default function App() {
  const [userId, setUserId] = useState<string | null>(null),
    [demo, setDemo] = useState<ReturnType<typeof createDemo> | null>(null),
    [demoRole, setDemoRole] = useState<'aluno' | 'professor'>('aluno'),
    [data, setData] = useState<Dashboard | null>(null),
    [authReady, setAuthReady] = useState(!supabase),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [recovery, setRecovery] = useState(new URLSearchParams(location.search).has('recovery')),
    [page, setPage] = useState('overview'),
    [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState('')
  const generation = useRef(0)
  const online = useConnection()
  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setUserId(data.session?.user.id ?? null)
        setAuthReady(true)
        if (error) setError(friendlyError(error))
      }
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      generation.current++
      setUserId(session?.user.id ?? null)
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
  const mutate: Mutate = async (name, args) => {
    if (!online || !navigator.onLine) throw new Error('Você está sem conexão.')
    if (demo) await demo.mutate(name, args)
    else await rpc(name, args)
    await refresh()
  }
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
        <Brand />
        <WifiOff size={44} />
        <h1>Você está sem conexão</h1>
        <p>Conecte-se à internet para acessar sua turma e registrar os treinos.</p>
        <p className="muted">Nenhuma ação será registrada enquanto você estiver offline.</p>
      </div>
    )
  if (!authReady)
    return (
      <div className="loading-screen" role="status">
        Carregando sua turma…
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
          <p role="status">Carregando sua turma…</p>
        )}
      </div>
    )
  const teacher = data.profile.role === 'professor',
    student = teacher ? data.students.find((s) => s.id === selected) : data.students[0],
    filtered = data.students.filter((s) =>
      s.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')),
    )
  function nav(next: string) {
    setPage(next)
    setSelected(null)
  }
  return (
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
            }}
          >
            Ver como {demoRole === 'aluno' ? 'professor' : 'aluno'} <ArrowRight size={14} />
          </button>
        </div>
      )}
      <aside className="sidebar">
        <Brand />
        <span className="sidebar-label">MINHA TURMA</span>
        <nav aria-label="Navegação principal">
          <button className={page === 'overview' ? 'active' : ''} onClick={() => nav('overview')}>
            {teacher ? <Users size={20} /> : <LayoutDashboard size={20} />}{' '}
            {teacher ? 'Alunos' : 'Meu progresso'}
          </button>
          <button
            className={page === (teacher ? 'settings' : 'history') ? 'active' : ''}
            onClick={() => nav(teacher ? 'settings' : 'history')}
          >
            {teacher ? <Settings2 size={20} /> : <CalendarDays size={20} />}{' '}
            {teacher ? 'Configurações' : 'Histórico'}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <Install />
          <div className="profile-mini">
            <span className="avatar">
              {data.profile.name
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <strong>{data.profile.name}</strong>
              <span>{teacher ? 'Professor' : 'Aluno'}</span>
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
            <Brand />
          </div>
          <span className="desktop-breadcrumb">
            Minha turma <ChevronRight size={14} /> {teacher ? 'Área do professor' : 'Área do aluno'}
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
              <span className="eyebrow">
                {teacher ? 'ÁREA DO PROFESSOR' : 'SEU JIU-JÍTSU, EM MOVIMENTO'}
              </span>
              <h1>
                {selected
                  ? student?.name
                  : page === 'settings'
                    ? 'Configurações'
                    : page === 'history'
                      ? 'Sua caminhada.'
                      : teacher
                        ? 'Sua turma.'
                        : `Olá, ${data.profile.name.split(' ')[0]}.`}
              </h1>
              <p>
                {selected
                  ? 'Cada treino conta na evolução do aluno.'
                  : page === 'settings'
                    ? 'Organize as referências e o acesso da turma.'
                    : page === 'history'
                      ? 'Um registro de cada passo no tatame.'
                      : teacher
                        ? 'Acompanhe a presença e a evolução de cada aluno.'
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
            <Settings goal={data.goal} mutate={mutate} />
          ) : teacher && !student ? (
            <>
              <div className="teacher-overview">
                <div>
                  <Users size={21} />
                  <strong>{data.students.length}</strong>
                  <span>alunos na turma</span>
                </div>
                <div>
                  <Check size={21} />
                  <strong>
                    {data.students.filter((s) => s.attendances.includes(data.today)).length}
                  </strong>
                  <span>presentes hoje</span>
                </div>
              </div>
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
                      <span className={'avatar small belt-' + s.belt}>
                        {s.name
                          .split(' ')
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
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
                    {data.students.length
                      ? 'Nenhum aluno com esse nome.'
                      : 'Seus alunos aparecerão aqui quando se cadastrarem com o código da turma.'}
                  </p>
                )}
              </section>
            </>
          ) : student ? (
            <div className="student-layout">
              <div className="student-primary">
                {page !== 'history' && (
                  <StudentSummary
                    student={student}
                    goal={data.goal}
                    teacher={teacher}
                    mutate={mutate}
                  />
                )}
                <History key={student.id} s={student} teacher={teacher} mutate={mutate} />
              </div>
              {teacher && <TeacherActions key={student.id} s={student} mutate={mutate} />}
            </div>
          ) : null}
          <footer className="workspace-footer">
            <span>Feito para a sua caminhada no tatame.</span>
            <span>TATAME</span>
          </footer>
          <div className="mobile-install">
            <Install />
          </div>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegação no celular">
        <button className={page === 'overview' ? 'active' : ''} onClick={() => nav('overview')}>
          {teacher ? <Users size={21} /> : <LayoutDashboard size={21} />}
          <span>{teacher ? 'Alunos' : 'Meu progresso'}</span>
        </button>
        <button
          className={page === (teacher ? 'settings' : 'history') ? 'active' : ''}
          onClick={() => nav(teacher ? 'settings' : 'history')}
        >
          {teacher ? <Settings2 size={21} /> : <CalendarDays size={21} />}
          <span>{teacher ? 'Configurações' : 'Histórico'}</span>
        </button>
      </nav>
    </div>
  )
}
