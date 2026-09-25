import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  CalendarClock,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  NotebookPen,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { ActionButton } from './ActionButton'
import { CHECKIN_DEADLINE_MIN } from '../domain/attendance'
import { zonedToUtc } from '../domain/schedule'
import { MAX_PHOTOS, monthGrid, sessionPhotoPath, shiftMonth } from '../domain/calendar'
import { compressImage } from '../lib/image'
import {
  friendlyError,
  type Call,
  type PresenceStatus,
  type PhotoStore,
  type ScheduleView,
  type SessionDetail,
  type SessionJournal,
  type SessionView,
} from '../lib/api'

const TZ = 'America/Sao_Paulo'
export const weekdayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(
    new Date(iso),
  )
export const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: TZ,
  }).format(new Date(iso))
const localDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const started = (s: { startsAt: string }) => new Date(s.startsAt).getTime() <= Date.now()
const checkinOpen = (s: SessionView) =>
  s.status === 'prevista' &&
  Date.now() <= new Date(s.startsAt).getTime() - CHECKIN_DEADLINE_MIN * 60000

export const presenceLabel: Record<PresenceStatus, string> = {
  pendente: 'Aguardando professor',
  confirmada: 'Presença confirmada',
  rejeitada: 'Presença recusada',
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      setData(await load())
      setError('')
    } catch (e) {
      setError(friendlyError(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, error, reload }
}
function Card({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="history-card">
      <div className="section-heading">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Aluno: próximas aulas com check-in até 1 hora antes. */
export function UpcomingClasses({
  call,
  today,
  onChanged,
}: {
  call: Call
  today: string
  onChanged: () => Promise<void>
}) {
  const { data, error, reload } = useLoad(
    () => call<SessionView[]>('list_sessions', { p_from: today, p_to: addDays(today, 7) }),
    [call, today],
  )
  const upcoming = (data ?? []).filter(
    (s) => new Date(s.startsAt).getTime() + s.durationMin * 60000 > Date.now(),
  )
  const act = async (name: string, id: string) => {
    await call(name, { p_session: id })
    await reload()
    await onChanged()
  }
  return (
    <Card title="Próximas aulas" aside={<CalendarClock size={19} />}>
      {error && <p className="error-message">{error}</p>}
      {!data && !error && <p className="muted">Carregando aulas…</p>}
      {data && upcoming.length === 0 && (
        <p className="empty">Nenhuma aula marcada para os próximos dias.</p>
      )}
      {upcoming.slice(0, 6).map((s) => (
        <div className="history-row" key={s.id} data-testid="upcoming-class">
          <span className="history-icon">
            <Clock size={16} />
          </span>
          <div>
            <strong>
              {s.title} · {timeLabel(s.startsAt)}
            </strong>
            <span>
              {dayLabel(s.startsAt)} ·{' '}
              {s.status === 'cancelada'
                ? `Cancelada${s.cancelReason ? ': ' + s.cancelReason : ''}`
                : s.mine
                  ? presenceLabel[s.mine]
                  : checkinOpen(s)
                    ? `Check-in até ${timeLabel(new Date(new Date(s.startsAt).getTime() - CHECKIN_DEADLINE_MIN * 60000).toISOString())}`
                    : 'Check-in encerrado'}
            </span>
          </div>
          {s.status !== 'cancelada' && checkinOpen(s) && (
            <ActionButton
              className={s.mine ? 'secondary' : 'primary'}
              action={() => act(s.mine ? 'cancel_checkin' : 'checkin', s.id)}
            >
              {s.mine ? (
                <>
                  <X size={16} /> Desistir
                </>
              ) : (
                <>
                  <Check size={16} /> Vou treinar
                </>
              )}
            </ActionButton>
          )}
          {s.mine && !checkinOpen(s) && <span className="status-pill">Check-in feito</span>}
        </div>
      ))}
      <p className="field-help">
        O check-in fecha 1 hora antes do treino. Se esquecer, o professor pode lançar sua presença.
      </p>
    </Card>
  )
}

/** Calendário mensal. Professor gerencia; aluno consulta o diário de cada aula. */
export function Agenda({
  call,
  today,
  staff,
  photos,
  onChanged,
}: {
  call: Call
  today: string
  staff: boolean
  photos: PhotoStore
  onChanged: () => Promise<void>
}) {
  const [month, setMonth] = useState(today.slice(0, 7)),
    [day, setDay] = useState(today),
    [selected, setSelected] = useState<string | null>(null)
  const grid = monthGrid(month)
  const from = grid[0].date,
    to = grid[grid.length - 1].date
  const { data, error, reload } = useLoad(
    () => call<SessionView[]>('list_sessions', { p_from: from, p_to: to }),
    [call, from, to],
  )
  if (selected)
    return (
      <SessionPanel
        id={selected}
        call={call}
        staff={staff}
        photos={photos}
        onBack={() => {
          setSelected(null)
          void reload()
        }}
        onChanged={onChanged}
      />
    )
  const byDay = new Map<string, SessionView[]>()
  for (const s of data ?? [])
    byDay.set(localDay(s.startsAt), [...(byDay.get(localDay(s.startsAt)) ?? []), s])
  const pendingTotal = (data ?? []).reduce((n, s) => n + (s.pending ?? 0), 0)
  const dayList = byDay.get(day) ?? []
  const monthName = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(month + '-15T12:00:00Z'))
  const calendar = (
    <Card
      title={staff ? 'Calendário de aulas' : 'Calendário de treinos'}
      aside={
        staff && pendingTotal > 0 ? (
          <span className="muted">{pendingTotal} presença(s) para revisar</span>
        ) : undefined
      }
    >
      <div className="month-nav">
        <button
          className="icon-button"
          aria-label="Mês anterior"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <strong className="month-title">{monthName}</strong>
        <button
          className="icon-button"
          aria-label="Próximo mês"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={18} />
        </button>
        {month !== today.slice(0, 7) && (
          <button
            className="text-button"
            onClick={() => {
              setMonth(today.slice(0, 7))
              setDay(today)
            }}
          >
            Hoje
          </button>
        )}
      </div>
      {error && <p className="error-message">{error}</p>}
      <div className="month-grid" role="grid" aria-label={'Aulas de ' + monthName}>
        {weekdayNames.map((n) => (
          <span className="month-head" key={n} role="columnheader">
            {n}
          </span>
        ))}
        {grid.map((d) => {
          const list = byDay.get(d.date) ?? []
          const label = `${d.date.split('-').reverse().join('/')}: ${
            list.length ? list.length + ' aula(s)' : 'sem aulas'
          }`
          return (
            <button
              key={d.date}
              role="gridcell"
              aria-label={label}
              aria-selected={d.date === day}
              className={
                'month-cell' +
                (d.inMonth ? '' : ' out') +
                (d.date === today ? ' today' : '') +
                (d.date === day ? ' selected' : '')
              }
              onClick={() => {
                setDay(d.date)
                if (!d.inMonth) setMonth(d.date.slice(0, 7))
              }}
            >
              <span className="month-day">{Number(d.date.slice(8))}</span>
              <span className="month-dots">
                {list.slice(0, 3).map((s) => (
                  <i
                    key={s.id}
                    className={
                      'dot ' +
                      s.status +
                      (s.mine === 'confirmada' ? ' mine' : '') +
                      ((s.pending ?? 0) > 0 ? ' pending' : '')
                    }
                  />
                ))}
                {list.some((s) => s.photos > 0) && <Camera size={10} aria-hidden="true" />}
              </span>
            </button>
          )
        })}
      </div>
      <p className="calendar-legend">
        <i className="dot realizada" /> realizada <i className="dot prevista" /> prevista{' '}
        <i className="dot cancelada" /> cancelada
        {staff ? (
          <>
            {' '}
            <i className="dot pending" /> a revisar
          </>
        ) : (
          <>
            {' '}
            <i className="dot mine" /> você treinou
          </>
        )}
      </p>
      <h4 className="panel-subtitle">
        {day === today ? 'Hoje · ' : ''}
        {dayLabel(day + 'T15:00:00Z')}
      </h4>
      {data && dayList.length === 0 && <p className="empty">Nenhuma aula neste dia.</p>}
      {dayList.map((s) => (
        <button
          className={'student-row' + (s.status === 'cancelada' ? ' cancelled' : '')}
          key={s.id}
          onClick={() => setSelected(s.id)}
        >
          <span className="avatar small">{timeLabel(s.startsAt)}</span>
          <span className="student-name">
            <strong>{s.title}</strong>
            <span>
              {s.status === 'cancelada'
                ? 'Cancelada'
                : s.status === 'realizada'
                  ? 'Realizada'
                  : 'Prevista'}{' '}
              · {s.durationMin} min
              {s.photos ? ` · ${s.photos} foto(s)` : ''}
              {!staff && s.mine ? ` · ${presenceLabel[s.mine]}` : ''}
            </span>
          </span>
          {staff && (
            <>
              <span className="student-count">
                <strong>{s.checkins}</strong>
                <span>check-ins</span>
              </span>
              <span className="student-cycle">
                <strong>{s.pending ?? 0}</strong>
                <span>a revisar</span>
              </span>
            </>
          )}
          <ChevronRight size={18} />
        </button>
      ))}
    </Card>
  )
  if (!staff) return calendar
  return (
    <div className="student-layout">
      <div className="student-primary">{calendar}</div>
      <div>
        <Schedules call={call} today={today} onChanged={reload} />
        <ExtraSession call={call} today={day <= today ? day : today} onChanged={reload} />
      </div>
    </div>
  )
}

/** Descrição e fotos da aula. Professor edita; todos da equipe veem. */
function Journal({
  id,
  call,
  staff,
  photos,
  onChanged,
}: {
  id: string
  call: Call
  staff: boolean
  photos: PhotoStore
  onChanged: () => Promise<void>
}) {
  const {
    data: j,
    error,
    reload,
  } = useLoad(() => call<SessionJournal>('session_journal', { p_session: id }), [call, id])
  const [urls, setUrls] = useState<Record<string, string>>({}),
    [text, setText] = useState<string | null>(null),
    [caption, setCaption] = useState(''),
    [uploadError, setUploadError] = useState(''),
    [uploading, setUploading] = useState(false),
    [zoom, setZoom] = useState<string | null>(null)
  const paths = (j?.photos ?? []).map((p) => p.path).join('|')
  useEffect(() => {
    if (!paths) return setUrls({})
    photos
      .urls(paths.split('|'))
      .then(setUrls)
      .catch(() => setUrls({}))
  }, [paths, photos])
  if (!j)
    return error ? <p className="error-message">{error}</p> : <p className="muted">Carregando…</p>
  const begun = started(j)
  async function upload(files: FileList | null) {
    if (!files?.length || !j) return
    setUploadError('')
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, MAX_PHOTOS - j.photos.length)) {
        const blob = await compressImage(file)
        const path = sessionPhotoPath(j.teamId, j.id, crypto.randomUUID())
        await photos.upload(path, blob)
        try {
          await call('add_session_photo', {
            p_session: j.id,
            p_path: path,
            p_caption: caption || null,
          })
        } catch (e) {
          await photos.remove(path).catch(() => {})
          throw e
        }
      }
      setCaption('')
      await reload()
      await onChanged()
    } catch (e) {
      setUploadError(friendlyError(e))
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="journal">
      <h4 className="panel-subtitle">
        <NotebookPen size={16} /> Sobre o treino
      </h4>
      {staff ? (
        <>
          <label className="field">
            <span>Descrição da aula</span>
            <textarea
              rows={4}
              maxLength={2000}
              value={text ?? j.description ?? ''}
              placeholder="O que foi treinado: técnicas, posições, observações…"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <ActionButton
            className="secondary"
            disabled={text === null || text === (j.description ?? '')}
            success="Descrição salva."
            action={async () => {
              await call('update_session_description', {
                p_session: j.id,
                p_description: text ?? '',
              })
              setText(null)
              await reload()
            }}
          >
            Salvar descrição
          </ActionButton>
        </>
      ) : (
        <p className={j.description ? 'journal-text' : 'empty'}>
          {j.description ?? 'O professor ainda não descreveu este treino.'}
        </p>
      )}
      <h4 className="panel-subtitle">
        <Camera size={16} /> Fotos ({j.photos.length})
      </h4>
      {j.photos.length === 0 && <p className="empty">Nenhuma foto deste treino.</p>}
      <div className="photo-grid">
        {j.photos.map((p) => (
          <figure key={p.id}>
            {urls[p.path] ? (
              <button
                className="photo-thumb"
                onClick={() => setZoom(urls[p.path])}
                aria-label={'Ampliar foto' + (p.caption ? ': ' + p.caption : '')}
              >
                <img src={urls[p.path]} alt={p.caption ?? 'Foto do treino'} loading="lazy" />
              </button>
            ) : (
              <div className="photo-thumb loading" aria-label="Carregando foto" />
            )}
            {p.caption && <figcaption>{p.caption}</figcaption>}
            {staff && (
              <ActionButton
                className="text-button danger"
                label="Apagar foto"
                confirm="Apagar esta foto do treino?"
                action={async () => {
                  const path = await call<string>('delete_session_photo', { p_photo: p.id })
                  await photos.remove(path).catch(() => {})
                  await reload()
                }}
              >
                <Trash2 size={15} />
              </ActionButton>
            )}
          </figure>
        ))}
      </div>
      {staff &&
        j.status !== 'cancelada' &&
        (begun ? (
          j.photos.length < MAX_PHOTOS && (
            <div className="photo-upload">
              <label className="field">
                <span>Legenda (opcional)</span>
                <input
                  value={caption}
                  maxLength={200}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </label>
              <label className={'secondary upload-button' + (uploading ? ' disabled' : '')}>
                <Camera size={17} /> {uploading ? 'Enviando…' : 'Adicionar fotos'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={(e) => {
                    void upload(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              {uploadError && (
                <p className="error-message" role="alert">
                  {uploadError}
                </p>
              )}
            </div>
          )
        ) : (
          <p className="field-help">As fotos podem ser adicionadas depois que a aula começar.</p>
        ))}
      {zoom && (
        <div
          className="photo-zoom"
          role="dialog"
          aria-label="Foto ampliada"
          onClick={() => setZoom(null)}
        >
          <img src={zoom} alt="Foto do treino ampliada" />
          <button className="icon-button" aria-label="Fechar" onClick={() => setZoom(null)}>
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  )
}

function SessionPanel({
  id,
  call,
  staff,
  photos,
  onBack,
  onChanged,
}: {
  id: string
  call: Call
  staff: boolean
  photos: PhotoStore
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const {
    data: s,
    error,
    reload,
  } = useLoad(
    () =>
      staff
        ? call<SessionDetail>('session_detail', { p_session: id })
        : call<SessionDetail>('session_journal', { p_session: id }),
    [call, id, staff],
  )
  const [reason, setReason] = useState('')
  const act = async (name: string, args: Record<string, unknown>) => {
    await call(name, { p_session: id, ...args })
    await reload()
    await onChanged()
  }
  if (!s)
    return (
      <section className="history-card">
        <button className="text-button back" onClick={onBack}>
          ← Voltar para o calendário
        </button>
        {error ? <p className="error-message">{error}</p> : <p className="muted">Carregando…</p>}
      </section>
    )
  const begun = started(s)
  const students = s.students ?? []
  const withStatus = students.filter((x) => x.status)
  const without = students.filter((x) => !x.status)
  return (
    <section className="history-card">
      <button className="text-button back" onClick={onBack}>
        ← Voltar para o calendário
      </button>
      <div className="section-heading">
        <h3>
          {s.title} · {dayLabel(s.startsAt)} · {timeLabel(s.startsAt)}
        </h3>
        <span className="status-pill">{s.status}</span>
      </div>
      {s.cancelReason && <p className="muted">Motivo: {s.cancelReason}</p>}
      <Journal id={id} call={call} staff={staff} photos={photos} onChanged={onChanged} />
      {staff && (
        <>
          {!begun && s.status === 'prevista' && (
            <p className="field-help">
              A aprovação das presenças abre quando a aula começar. Até lá, você vê quem confirmou.
            </p>
          )}
          <h4 className="panel-subtitle">
            <Users size={16} /> Fizeram check-in ({withStatus.length})
          </h4>
          {withStatus.length === 0 && <p className="empty">Ninguém fez check-in nesta aula.</p>}
          {withStatus.map((x) => (
            <div className="history-row" key={x.id}>
              <div>
                <strong>{x.name}</strong>
                <span>
                  {presenceLabel[x.status!]}
                  {x.source === 'professor' ? ' · lançada pelo professor' : ''}
                </span>
              </div>
              {begun && x.status !== 'confirmada' && (
                <ActionButton
                  className="primary"
                  label={`Confirmar presença de ${x.name}`}
                  action={() =>
                    act('review_presence', { p_student: x.id, p_decision: 'confirmada' })
                  }
                >
                  <Check size={16} /> Confirmar
                </ActionButton>
              )}
              {begun && x.status === 'pendente' && (
                <ActionButton
                  className="secondary"
                  label={`Recusar presença de ${x.name}`}
                  action={() =>
                    act('review_presence', { p_student: x.id, p_decision: 'rejeitada' })
                  }
                >
                  <X size={16} /> Recusar
                </ActionButton>
              )}
              {x.status === 'confirmada' && (
                <ActionButton
                  className="text-button danger"
                  label={`Remover presença de ${x.name}`}
                  confirm={`Remover a presença de ${x.name} nesta aula? A contagem será atualizada.`}
                  action={() => act('teacher_remove_presence', { p_student: x.id })}
                >
                  Remover
                </ActionButton>
              )}
            </div>
          ))}
          {begun && s.status !== 'cancelada' && without.length > 0 && (
            <>
              <h4 className="panel-subtitle">
                <Plus size={16} /> Esqueceram o check-in? Lance a presença
              </h4>
              {without.map((x) => (
                <div className="history-row" key={x.id}>
                  <div>
                    <strong>{x.name}</strong>
                    <span>Sem check-in</span>
                  </div>
                  <ActionButton
                    className="secondary"
                    label={`Lançar presença de ${x.name}`}
                    action={() => act('teacher_add_presence', { p_student: x.id })}
                  >
                    <Plus size={16} /> Presente
                  </ActionButton>
                </div>
              ))}
            </>
          )}
          {!begun && s.status === 'prevista' && (
            <div className="correction-row">
              <label className="field">
                <span>Motivo do cancelamento</span>
                <input
                  value={reason}
                  maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: feriado"
                />
              </label>
              <ActionButton
                className="secondary danger"
                confirm="Cancelar esta aula? Os check-ins feitos serão removidos."
                action={() => act('cancel_session', { p_reason: reason })}
              >
                Cancelar aula
              </ActionButton>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ScheduleForm({
  initial,
  today,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ScheduleView
  today: string
  submitLabel: string
  onSubmit: (v: {
    title: string
    weekdays: number[]
    start: string
    duration: number
    date: string
  }) => Promise<void>
  onCancel?: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? 'Jiu-jítsu'),
    [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? [1, 3, 5]),
    [start, setStart] = useState(initial?.startTime ?? '19:00'),
    [duration, setDuration] = useState(initial?.durationMin ?? 60),
    [date, setDate] = useState(initial ? addDays(today, 1) : today)
  const valid =
    title.trim().length >= 2 &&
    weekdays.length > 0 &&
    /^\d\d:\d\d$/.test(start) &&
    duration >= 15 &&
    duration <= 300
  return (
    <div className="initial-form">
      <label className="field">
        <span>Nome da aula</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset className="weekday-picker">
        <legend>Dias da semana</legend>
        {weekdayNames.map((n, i) => (
          <label key={n} className={weekdays.includes(i) ? 'on' : ''}>
            <input
              type="checkbox"
              checked={weekdays.includes(i)}
              onChange={(e) =>
                setWeekdays(
                  e.target.checked ? [...weekdays, i].sort() : weekdays.filter((d) => d !== i),
                )
              }
            />
            {n}
          </label>
        ))}
      </fieldset>
      <div className="form-grid">
        <label className="field">
          <span>Horário</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>Duração (min)</span>
          <input
            type="number"
            min={15}
            max={300}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="field">
        <span>{initial ? 'Mudança vale a partir de' : 'Começa em'}</span>
        <input
          type="date"
          min={initial ? addDays(today, 1) : today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <div className="graduation-buttons">
        <ActionButton
          className="primary"
          disabled={!valid}
          success="Horário salvo."
          action={() => onSubmit({ title, weekdays, start, duration, date })}
        >
          {submitLabel}
        </ActionButton>
        {onCancel && (
          <button className="text-button" onClick={onCancel}>
            Fechar
          </button>
        )}
      </div>
    </div>
  )
}

function Schedules({
  call,
  today,
  onChanged,
}: {
  call: Call
  today: string
  onChanged: () => Promise<void>
}) {
  const { data, error, reload } = useLoad(() => call<ScheduleView[]>('list_schedules'), [call])
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const done = async () => {
    setEditing(null)
    await reload()
    await onChanged()
  }
  return (
    <section className="teacher-actions">
      <div className="section-heading">
        <h3>Horários padrão</h3>
        <CalendarClock size={19} />
      </div>
      {error && <p className="error-message">{error}</p>}
      {data?.length === 0 && <p className="muted">Nenhum horário. Ex.: seg, qua e sex às 7h.</p>}
      {data?.map((s) =>
        editing === s.id ? (
          <ScheduleForm
            key={s.id}
            initial={s}
            today={today}
            submitLabel="Salvar mudança"
            onCancel={() => setEditing(null)}
            onSubmit={async (v) => {
              await call('update_schedule', {
                p_id: s.id,
                p_title: v.title,
                p_weekdays: v.weekdays,
                p_start: v.start,
                p_duration: v.duration,
                p_effective: v.date,
              })
              await done()
            }}
          />
        ) : (
          <div className="history-row" key={s.id}>
            <div>
              <strong>{s.title}</strong>
              <span>
                {s.weekdays.map((d) => weekdayNames[d]).join(', ')} · {s.startTime} ·{' '}
                {s.durationMin} min
                {s.validUntil ? ` · até ${s.validUntil.split('-').reverse().join('/')}` : ''}
                {s.validFrom > today
                  ? ` · a partir de ${s.validFrom.split('-').reverse().join('/')}`
                  : ''}
              </span>
            </div>
            <button className="text-button" onClick={() => setEditing(s.id)}>
              Editar
            </button>
            <ActionButton
              className="text-button danger"
              confirm="Encerrar este horário hoje? As próximas aulas sem check-in serão removidas; o histórico fica."
              action={async () => {
                await call('end_schedule', { p_id: s.id, p_last_day: today })
                await done()
              }}
            >
              Encerrar
            </ActionButton>
          </div>
        ),
      )}
      {editing === 'new' ? (
        <ScheduleForm
          today={today}
          submitLabel="Criar horário"
          onCancel={() => setEditing(null)}
          onSubmit={async (v) => {
            await call('create_schedule', {
              p_title: v.title,
              p_weekdays: v.weekdays,
              p_start: v.start,
              p_duration: v.duration,
              p_valid_from: v.date,
            })
            await done()
          }}
        />
      ) : (
        <button className="secondary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Novo horário
        </button>
      )}
    </section>
  )
}

function ExtraSession({
  call,
  today,
  onChanged,
}: {
  call: Call
  today: string
  onChanged: () => Promise<void>
}) {
  const [title, setTitle] = useState('Treino'),
    [date, setDate] = useState(today),
    [time, setTime] = useState('19:00'),
    [duration, setDuration] = useState(60),
    [description, setDescription] = useState('')
  return (
    <section className="teacher-actions">
      <div className="section-heading">
        <h3>Aula avulsa</h3>
        <Plus size={19} />
      </div>
      <p className="muted">Para um treino extra, ou para registrar um treino que já aconteceu.</p>
      <label className="field">
        <span>Nome</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Data</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Horário</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Duração (min)</span>
        <input
          type="number"
          min={15}
          max={300}
          step={5}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>Descrição (opcional)</span>
        <input
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="O que foi treinado"
        />
      </label>
      <ActionButton
        className="secondary"
        disabled={!date || !time || title.trim().length < 2}
        success="Aula criada."
        action={async () => {
          await call('create_session', {
            p_title: title,
            p_starts_at: zonedToUtc(date, time),
            p_duration: duration,
            p_description: description || null,
          })
          setDescription('')
          await onChanged()
        }}
      >
        Criar aula
      </ActionButton>
    </section>
  )
}
