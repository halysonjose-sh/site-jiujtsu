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
import { MAX_PHOTOS, monthGrid, sessionPhotoPath, shiftMonth } from '../domain/calendar'
import { overlapping, planNewSession } from '../domain/newSession'
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

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
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
  onCheckin,
}: {
  call: Call
  today: string
  onChanged: () => Promise<void>
  onCheckin?: (session: string) => void
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
    if (name === 'checkin') onCheckin?.(id)
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
  teamId,
  roster,
  onChanged,
  jump,
}: {
  call: Call
  today: string
  staff: boolean
  photos: PhotoStore
  teamId: string
  roster: { id: string; name: string }[]
  onChanged: () => Promise<void>
  /** Vem da aba Hoje ("Fotos do treino"): abre a aula uma vez, por nonce. */
  jump?: { id: string; nonce: number } | null
}) {
  const [month, setMonth] = useState(today.slice(0, 7)),
    [day, setDay] = useState(today),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState<string | null>(null),
    [notice, setNotice] = useState('')
  const grid = monthGrid(month)
  const from = grid[0].date,
    to = grid[grid.length - 1].date
  const { data, error, reload } = useLoad(
    () => call<SessionView[]>('list_sessions', { p_from: from, p_to: to }),
    [call, from, to],
  )
  const [covers, setCovers] = useState<Record<string, string>>({})
  const dayCovers = (data ?? [])
    .filter((s) => localDay(s.startsAt) === day && s.cover)
    .map((s) => s.cover!)
    .join('|')
  useEffect(() => {
    if (!dayCovers) return
    photos
      .urls(dayCovers.split('|'))
      .then((u) => setCovers((c) => ({ ...c, ...u })))
      .catch(() => {})
  }, [dayCovers, photos])
  useEffect(() => {
    if (jump) setSelected(jump.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce])
  if (creating)
    return (
      <NewSessionForm
        date={creating}
        today={today}
        call={call}
        photos={photos}
        teamId={teamId}
        roster={roster}
        existing={data ?? []}
        onCancel={() => setCreating(null)}
        onCreated={async (id, message) => {
          setCreating(null)
          setNotice(message)
          setSelected(id)
          await reload()
          await onChanged()
        }}
      />
    )
  if (selected)
    return (
      <SessionPanel
        id={selected}
        notice={notice}
        call={call}
        staff={staff}
        photos={photos}
        onBack={() => {
          setSelected(null)
          setNotice('')
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
  })
    .format(new Date(month + '-15T12:00:00Z'))
    .replace(/^./, (c) => c.toUpperCase())
  const calendar = (
    <Card
      title={staff ? 'Calendário de aulas' : 'Calendário de treinos'}
      aside={
        staff && pendingTotal > 0 ? (
          <span className="muted">{pendingTotal} presença(s) para revisar</span>
        ) : undefined
      }
    >
      {staff && (
        <button className="primary new-session" onClick={() => setCreating(day)}>
          <Plus size={17} /> Nova aula
        </button>
      )}
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
      {staff && (
        <button className="text-button add-day" onClick={() => setCreating(day)}>
          <Plus size={16} /> Nova aula neste dia
        </button>
      )}
      {dayList.map((s) => (
        <button
          className={'student-row' + (s.status === 'cancelada' ? ' cancelled' : '')}
          key={s.id}
          onClick={() => setSelected(s.id)}
        >
          {s.cover && covers[s.cover] ? (
            <img className="session-cover" src={covers[s.cover]} alt="" />
          ) : (
            <span className="avatar small">{timeLabel(s.startsAt)}</span>
          )}
          <span className="student-name">
            <strong>
              {s.cover && covers[s.cover] ? timeLabel(s.startsAt) + ' · ' : ''}
              {s.title}
            </strong>
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
      </div>
    </div>
  )
}

/** Descrição e fotos da aula. Professor edita; todos da equipe veem. */
type RosterEntry = NonNullable<SessionDetail['students']>[number]
/** Reduz, envia e registra fotos de uma aula. Retorna quantas foram salvas. */
async function sendPhotos(
  call: Call,
  photos: PhotoStore,
  teamId: string,
  sessionId: string,
  files: File[],
  caption: string,
  onProgress?: (done: number, total: number) => void,
) {
  let sent = 0
  const list = files.slice(0, MAX_PHOTOS)
  for (const file of list) {
    onProgress?.(sent + 1, list.length)
    const blob = await compressImage(file)
    const path = sessionPhotoPath(teamId, sessionId, crypto.randomUUID())
    await photos.upload(path, blob)
    try {
      await call('add_session_photo', {
        p_session: sessionId,
        p_path: path,
        p_caption: caption || null,
      })
    } catch (e) {
      await photos.remove(path).catch(() => {})
      throw e
    }
    sent++
  }
  return sent
}

/** Escolha de fotos com prévia: miniaturas, remover uma a uma e adicionar mais. */
function PhotoPicker({
  files,
  onChange,
  max,
  disabled,
}: {
  files: File[]
  onChange: (files: File[]) => void
  max: number
  disabled?: boolean
}) {
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])
  const left = max - files.length
  return (
    <div className="photo-picker">
      {files.length > 0 && (
        <ul className="photo-previews" aria-label="Fotos escolhidas">
          {files.map((f, i) => (
            <li key={f.name + i}>
              {previews[i] && <img src={previews[i]} alt={`Foto escolhida ${i + 1}`} />}
              <button
                type="button"
                className="icon-button remove-preview"
                aria-label={`Remover foto ${i + 1}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, k) => k !== i))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {left > 0 ? (
        <label className={'secondary upload-button' + (disabled ? ' disabled' : '')}>
          <Camera size={17} />{' '}
          {files.length
            ? `Adicionar mais fotos (${files.length} escolhida(s))`
            : 'Escolher fotos do treino'}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={disabled}
            aria-label="Escolher fotos do treino"
            onChange={(e) => {
              onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, max))
              e.target.value = ''
            }}
          />
        </label>
      ) : (
        <p className="field-help">Limite de {MAX_PHOTOS} fotos por aula atingido.</p>
      )}
    </div>
  )
}

/** Fotos grandes: a primeira em destaque e as demais deslizando para o lado. */
function PhotoGallery({
  items,
  urls,
  staff,
  onDelete,
}: {
  items: SessionJournal['photos']
  urls: Record<string, string>
  staff: boolean
  onDelete: (id: string) => Promise<void>
}) {
  const [index, setIndex] = useState(0),
    [zoom, setZoom] = useState<string | null>(null)
  if (items.length === 0) return null
  return (
    <div className="photo-gallery">
      <div
        className="photo-track"
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
        }}
      >
        {items.map((p, i) => (
          <figure key={p.id} className="photo-slide">
            {urls[p.path] ? (
              <button
                className="photo-large"
                onClick={() => setZoom(urls[p.path])}
                aria-label={'Ampliar foto ' + (i + 1) + (p.caption ? ': ' + p.caption : '')}
              >
                <img src={urls[p.path]} alt={p.caption ?? `Foto do treino ${i + 1}`} />
              </button>
            ) : (
              <div className="photo-large loading" aria-label="Carregando foto" />
            )}
            <figcaption>
              <span>{p.caption}</span>
              {staff && (
                <ActionButton
                  className="text-button danger"
                  label={`Apagar foto ${i + 1}`}
                  confirm="Apagar esta foto do treino?"
                  action={() => onDelete(p.id)}
                >
                  <Trash2 size={15} /> Apagar
                </ActionButton>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      {items.length > 1 && (
        <p className="photo-counter" aria-live="polite">
          {Math.min(index + 1, items.length)} / {items.length} · deslize para ver mais
        </p>
      )}
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

function Roster({
  entries,
  checked,
  onToggle,
}: {
  entries: { id: string; name: string; status?: RosterEntry['status'] }[]
  checked: Set<string>
  onToggle: (id: string, on: boolean) => void
}) {
  return (
    <fieldset className="roster">
      <legend>Quem estava no treino?</legend>
      {entries.length === 0 && <p className="muted">Nenhum aluno ativo na equipe.</p>}
      {entries.map((x) => (
        <label key={x.id} className={checked.has(x.id) ? 'on' : ''}>
          <input
            type="checkbox"
            checked={checked.has(x.id)}
            disabled={x.status === 'confirmada'}
            onChange={(e) => onToggle(x.id, e.target.checked)}
          />
          <span>{x.name}</span>
          {x.status !== undefined && (
            <small>
              {x.status === 'confirmada'
                ? 'já confirmado'
                : x.status === 'pendente'
                  ? 'fez check-in'
                  : x.status === 'rejeitada'
                    ? 'recusado'
                    : 'sem check-in'}
            </small>
          )}
        </label>
      ))}
    </fieldset>
  )
}

/** Tela de cadastro de aula: dados, fotos e (se já aconteceu) presentes. */
function NewSessionForm({
  date: initialDate,
  today,
  call,
  photos,
  teamId,
  roster,
  existing,
  onCancel,
  onCreated,
}: {
  date: string
  today: string
  call: Call
  photos: PhotoStore
  teamId: string
  roster: { id: string; name: string }[]
  existing: SessionView[]
  onCancel: () => void
  onCreated: (id: string, message: string) => Promise<void>
}) {
  const [title, setTitle] = useState('Treino'),
    [date, setDate] = useState(initialDate),
    [time, setTime] = useState('19:00'),
    [duration, setDuration] = useState(60),
    [description, setDescription] = useState(''),
    [caption, setCaption] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [present, setPresent] = useState<Set<string>>(new Set()),
    [saving, setSaving] = useState(''),
    [tried, setTried] = useState(false),
    [error, setError] = useState('')
  const plan = planNewSession(
    {
      title,
      date,
      time,
      durationMin: duration,
      description,
      photoCount: files.length,
      presentCount: present.size,
    },
    new Date(),
  )
  const conflicts = plan.startsAt ? overlapping(existing, plan.startsAt, duration) : []
  async function save() {
    setTried(true)
    setError('')
    if (plan.errors.length || !plan.startsAt || saving) return
    setSaving('Criando aula…')
    let id: string
    try {
      id = await call<string>('create_session', {
        p_title: title,
        p_starts_at: plan.startsAt,
        p_duration: duration,
        p_description: description.trim() || null,
      })
    } catch (e) {
      setError(friendlyError(e))
      setSaving('')
      return
    }
    // A aula já existe: qualquer falha daqui em diante é mostrada na tela da aula, sem recriá-la.
    const done: string[] = ['Aula criada']
    try {
      if (files.length) {
        const sent = await sendPhotos(call, photos, teamId, id, files, caption, (n, t) =>
          setSaving(`Enviando foto ${n} de ${t}…`),
        )
        done.push(`${sent} foto(s) enviada(s)`)
      }
      if (plan.past && present.size) {
        setSaving('Confirmando presenças…')
        await call('confirm_presences', { p_session: id, p_students: [...present] })
        done.push(`${present.size} presença(s) confirmada(s)`)
      }
      await onCreated(id, done.join(', ') + '.')
    } catch (e) {
      await onCreated(
        id,
        `${done.join(', ')}, mas houve um problema: ${friendlyError(e)} Complete o registro abaixo.`,
      )
    }
  }
  return (
    <section className="history-card new-session-form">
      <button className="text-button back" onClick={onCancel} disabled={!!saving}>
        ← Voltar para o calendário
      </button>
      <div className="section-heading">
        <h3>Nova aula</h3>
      </div>
      <label className="field">
        <span>Nome da aula</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Data</span>
          <input
            type="date"
            value={date}
            max={addDays(today, 365)}
            onChange={(e) => setDate(e.target.value)}
          />
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
          value={Number.isNaN(duration) ? '' : duration}
          onChange={(e) => setDuration(e.target.value === '' ? NaN : Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>Descrição (opcional)</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={description}
          placeholder="O que foi ou será treinado"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {conflicts.length > 0 && (
        <p className="notice" role="status">
          Atenção: já existe{' '}
          {conflicts.map((c) => `${c.title} às ${timeLabel(c.startsAt)}`).join(', ')} nesse horário.
          Você pode criar mesmo assim.
        </p>
      )}
      <h4 className="panel-subtitle">
        <Camera size={16} /> Fotos do treino
      </h4>
      <PhotoPicker files={files} onChange={setFiles} max={MAX_PHOTOS} disabled={!!saving} />
      {files.length > 0 && (
        <label className="field">
          <span>Legenda das fotos (opcional)</span>
          <input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
        </label>
      )}
      {plan.startsAt && plan.past ? (
        <Roster
          entries={roster}
          checked={present}
          onToggle={(id, on) => {
            const next = new Set(present)
            if (on) next.add(id)
            else next.delete(id)
            setPresent(next)
          }}
        />
      ) : (
        plan.startsAt && (
          <p className="field-help">
            Aula futura: os alunos poderão fazer check-in até 1 hora antes. As presenças são
            registradas depois que ela começar.
          </p>
        )
      )}
      {tried && plan.errors.length > 0 && (
        <ul className="error-message" role="alert">
          {plan.errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={!!saving} onClick={() => void save()}>
        {saving ||
          (files.length || (plan.past && present.size) ? 'Criar aula e registrar' : 'Criar aula')}
      </button>
    </section>
  )
}

function Journal({
  id,
  call,
  staff,
  photos,
  students,
  onChanged,
}: {
  id: string
  call: Call
  staff: boolean
  photos: PhotoStore
  students: RosterEntry[]
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
    [progress, setProgress] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [present, setPresent] = useState<Set<string> | null>(null),
    [saved, setSaved] = useState('')
  const checked =
    present ??
    new Set(
      students.filter((x) => x.status === 'pendente' || x.status === 'confirmada').map((x) => x.id),
    )
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
  const toConfirm = begun
    ? students.filter((x) => checked.has(x.id) && x.status !== 'confirmada').map((x) => x.id)
    : []
  /** Registra o treino: envia as fotos e confirma os alunos marcados como presentes. */
  async function register() {
    if (!j) return
    setUploadError('')
    setSaved('')
    setProgress('Salvando…')
    try {
      const sent = await sendPhotos(
        call,
        photos,
        j.teamId,
        j.id,
        files.slice(0, MAX_PHOTOS - j.photos.length),
        caption,
        (n, t) => setProgress(`Enviando foto ${n} de ${t}…`),
      )
      if (toConfirm.length) {
        setProgress('Confirmando presenças…')
        await call('confirm_presences', { p_session: j.id, p_students: toConfirm })
      }
      setFiles([])
      setCaption('')
      setPresent(null)
      setSaved(
        [
          sent ? `${sent} foto(s) enviada(s)` : '',
          toConfirm.length ? `${toConfirm.length} presença(s) confirmada(s)` : '',
        ]
          .filter(Boolean)
          .join(' e ') + '.',
      )
      await reload()
      await onChanged()
    } catch (e) {
      setUploadError(friendlyError(e))
    } finally {
      setProgress('')
    }
  }
  const pendingChanges = files.length > 0 || toConfirm.length > 0
  return (
    <div className="journal">
      <PhotoGallery
        items={j.photos}
        urls={urls}
        staff={staff}
        onDelete={async (photoId) => {
          const path = await call<string>('delete_session_photo', { p_photo: photoId })
          await photos.remove(path).catch(() => {})
          await reload()
        }}
      />
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
      {!staff && j.photos.length === 0 && <p className="empty">Nenhuma foto deste treino.</p>}
      {staff && j.status !== 'cancelada' && (
        <div className="photo-upload register-training">
          <h4 className="panel-subtitle">
            <Camera size={16} /> {begun ? 'Registrar treino' : 'Adicionar fotos'}
            {j.photos.length > 0 && (
              <small className="muted"> · {j.photos.length} foto(s) na aula</small>
            )}
          </h4>
          <PhotoPicker
            files={files}
            onChange={setFiles}
            max={MAX_PHOTOS - j.photos.length}
            disabled={!!progress}
          />
          {files.length > 0 && (
            <label className="field">
              <span>Legenda (opcional)</span>
              <input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
            </label>
          )}
          {begun ? (
            <Roster
              entries={students}
              checked={checked}
              onToggle={(sid, on) => {
                const next = new Set(checked)
                if (on) next.add(sid)
                else next.delete(sid)
                setPresent(next)
              }}
            />
          ) : (
            <p className="field-help">
              As presenças podem ser registradas depois que a aula começar.
            </p>
          )}
          <button
            className="primary"
            disabled={!!progress || !pendingChanges}
            onClick={() => void register()}
          >
            {progress || (begun ? 'Salvar fotos e presenças' : 'Salvar fotos')}
          </button>
          {saved && (
            <p className="success-message" role="status">
              {saved}
            </p>
          )}
          {uploadError && (
            <p className="error-message" role="alert">
              {uploadError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SessionPanel({
  id,
  notice,
  call,
  staff,
  photos,
  onBack,
  onChanged,
}: {
  id: string
  notice?: string
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
      {notice && (
        <p className={/problema/.test(notice) ? 'error-message' : 'success-message'} role="status">
          {notice}
        </p>
      )}
      {s.cancelReason && <p className="muted">Motivo: {s.cancelReason}</p>}
      <Journal
        id={id}
        call={call}
        staff={staff}
        photos={photos}
        students={students}
        onChanged={async () => {
          await reload()
          await onChanged()
        }}
      />
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
