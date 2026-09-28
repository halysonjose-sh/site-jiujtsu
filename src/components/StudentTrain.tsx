import { useEffect, useState } from 'react'
import { Camera, Check, X } from 'lucide-react'
import { addDays } from './Classes'
import { friendlyError, type Call, type PhotoStore, type SessionView, type StudentView } from '../lib/api'
import { ActionButton } from './ActionButton'
import { UpcomingClasses, checkinOpen, dayLabel, timeLabel } from './Classes'
import { useToast } from './Toast'

/**
 * Aba Treinar do aluno: a próxima aula em cartão grande com o check-in em um
 * toque, as demais aulas da semana e o último treino com foto.
 */
export function TrainTab({
  student,
  call,
  photos,
  onChanged,
  onCheckin,
}: {
  student: StudentView
  call: Call
  photos: PhotoStore
  onChanged: () => Promise<void>
  onCheckin?: (session: string) => void
}) {
  const { show } = useToast()
  const [sessions, setSessions] = useState<SessionView[] | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  // Muda a cada ação para remontar a lista de próximas aulas (ela tem estado próprio).
  const [verso, setVerso] = useState(0)
  const reload = () =>
    call<SessionView[]>('list_sessions', {
      p_from: addDays(student.today, -31),
      p_to: addDays(student.today, 7),
    })
      .then((s) => {
        setSessions(s)
        setErro('')
      })
      .catch((e) => {
        setSessions([])
        setErro(friendlyError(e))
      })
  useEffect(() => {
    void reload()
    // student muda de identidade a cada refresh do dashboard: recarrega para os
    // dados do hero não ficarem stale quando a lista muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, student])
  const upcoming = (sessions ?? []).filter(
    (s) => s.status !== 'cancelada' && new Date(s.startsAt).getTime() + s.durationMin * 60000 > Date.now(),
  )
  // Destaque: a primeira aula com check-in aberto que o aluno ainda não marcou.
  // Depois do check-in, heroId prende o destaque na aula marcada (mostra
  // "Desistir") em vez de pular para a seguinte.
  const [heroId, setHeroId] = useState<string | null>(null)
  // O pin ignora aula cancelada: se o professor cancelar a aula marcada, o
  // destaque volta a seguir a próxima aula real.
  const pinada = heroId
    ? (sessions ?? []).find((s) => s.id === heroId && s.status !== 'cancelada')
    : undefined
  const proxima =
    pinada ??
    upcoming.find((s) => checkinOpen(s) && !s.mine) ??
    upcoming.find((s) => checkinOpen(s) && s.mine) ??
    upcoming[0]
  const ultimo = (sessions ?? [])
    .filter((s) => s.status === 'realizada' && s.cover)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0]
  useEffect(() => {
    if (!ultimo?.cover) {
      setCover(null)
      return
    }
    let vivo = true
    photos.urls([ultimo.cover]).then((m) => {
      if (vivo) setCover(m[ultimo.cover!] ?? null)
    }).catch(() => {})
    return () => {
      vivo = false
    }
  }, [ultimo?.cover, photos])
  const agir = (nome: string, id: string) =>
    call(nome, { p_session: id })
      .then(() => reload())
      .then(() => {
        setVerso((v) => v + 1)
        return onChanged()
      })
  const checkin = (s: SessionView) =>
    agir(s.mine ? 'cancel_checkin' : 'checkin', s.id).then(() => {
      // Pina só depois do sucesso: falha não prende o destaque numa aula sem marcação.
      if (!s.mine) {
        setHeroId(s.id)
        show('Check-in feito. Aguardando o professor.')
        onCheckin?.(s.id)
      }
    })
  return (
    <>
      {erro && (
        <p className="error-message" role="alert">
          {erro}
        </p>
      )}
      {proxima && (
        <section className="train-hero" aria-label="Próxima aula">
          <span className="eyebrow" aria-hidden="true">
            PRÓXIMA AULA
          </span>
          <h2>{proxima.title}</h2>
          <p>
            {dayLabel(proxima.startsAt)} · {timeLabel(proxima.startsAt)}
          </p>
          {proxima.status !== 'cancelada' && checkinOpen(proxima) && (
            <ActionButton className="primary" action={() => checkin(proxima)}>
              {proxima.mine ? (
                <>
                  <X size={18} /> Desistir
                </>
              ) : (
                <>
                  <Check size={18} /> Vou treinar
                </>
              )}
            </ActionButton>
          )}
          {proxima.mine && !checkinOpen(proxima) && (
            <span className="status-pill">Check-in feito</span>
          )}
        </section>
      )}
      <UpcomingClasses
        key={verso}
        call={call}
        today={student.today}
        onChanged={onChanged}
        onCheckin={onCheckin}
      />
      {ultimo && (
        <section className="last-training">
          <div className="section-heading">
            <h3>Último treino</h3>
            <Camera size={18} />
          </div>
          {cover && <img src={cover} alt={`Foto do treino ${ultimo.title}`} />}
          <p>
            <strong>{ultimo.title}</strong> · {dayLabel(ultimo.startsAt)}
          </p>
          {ultimo.description && <p className="muted">{ultimo.description}</p>}
        </section>
      )}
    </>
  )
}
