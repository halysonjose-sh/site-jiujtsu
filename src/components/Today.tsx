import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, Pencil, Trash2, Users } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { BottomSheet } from './BottomSheet'
import { EmptyState } from './EmptyState'
import { OverflowMenu } from './OverflowMenu'
import { dayLabel, presenceLabel, timeLabel, useLoad } from './Classes'
import { useToast } from './Toast'
import { nextSession, reviewCount, sessionsOfToday, type StatusPresenca } from '../domain/today'
import {
  friendlyError,
  type Call,
  type SessionDetail,
  type SessionView,
  type StudentView,
} from '../lib/api'

type Mutate = (name: string, args?: Record<string, unknown>) => Promise<void>

/** Professor: treino do dia, check-ins (ver e excluir) e aprovações de alunos. */
export function Today({
  call,
  mutate,
  today,
  students,
  onChanged,
  onOpenSession,
  onCounts,
  staff,
  agora,
}: {
  call: Call
  mutate: Mutate
  today: string
  students: StudentView[]
  onChanged: () => Promise<void> | void
  onOpenSession: (id: string) => void
  onCounts?: (reviews: number) => void
  staff?: boolean
  /** Relógio injetável para testes; em produção usa Date.now(). */
  agora?: number
}) {
  const pendencias = students.filter((s) => s.memberStatus === 'pendente')
  // Uma busca só: hoje + 62 dias. A próxima aula só aparece quando hoje está vazio.
  const { data, error, reload } = useLoad(
    () => call<SessionView[]>('list_sessions', { p_from: today, p_to: addDays(today, 56) }),
    // 56 dias: é o limite em que o backend gera sessões recorrentes.
    [call, today],
  )
  const sessoes = sessionsOfToday(data ?? [], today)
  const [checkins, setCheckins] = useState<string | null>(null)
  const [recusando, setRecusando] = useState<StudentView | null>(null)
  const [erroRecusa, setErroRecusa] = useState<string | null>(null)
  const dialogRecusa = useRef<HTMLDialogElement>(null)
  const toast = useToast()
  const aula = sessoes.find((s) => s.id === checkins) ?? null
  const proxima = data && sessoes.length === 0 ? nextSession(data, agora ?? Date.now()) : null

  useEffect(() => {
    if (data) onCounts?.(reviewCount(sessoes))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    if (recusando) dialogRecusa.current?.showModal?.()
  }, [recusando])

  function abrirRecusa(p: StudentView) {
    setErroRecusa(null)
    setRecusando(p)
  }

  async function recusar() {
    const alvo = recusando
    if (!alvo) return
    try {
      await mutate('approve_member', { p_user: alvo.id, p_approve: false })
    } catch (e) {
      // O diálogo fica aberto com o erro, como o ActionButton faz inline.
      setErroRecusa(friendlyError(e))
      return
    }
    setRecusando(null)
    toast.show('Recusa registrada')
    await onChanged()
  }

  return (
    <div className="today">
      <div className="teacher-overview">
        <div>
          <Users size={21} />
          <strong>{students.filter((s) => s.memberStatus === 'ativo').length}</strong>
          <span>alunos na equipe</span>
        </div>
        <div>
          <Check size={21} />
          <strong>
            {
              students.filter((s) =>
                s.attendances.some((a) => a.date === today && a.status === 'confirmada'),
              ).length
            }
          </strong>
          <span>presentes hoje</span>
        </div>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void reload()}>
            Tentar de novo
          </button>
        </p>
      )}
      {pendencias.length > 0 && (
        <section className="pendencias" aria-label="Pendências">
          <h2>Aguardando aprovação</h2>
          {pendencias.map((p) => (
            <div key={p.id} className="pendencia-row">
              <span>{p.name}</span>
              <ActionButton
                className="secondary"
                label={`Aprovar ${p.name}`}
                action={async () => {
                  await mutate('approve_member', { p_user: p.id, p_approve: true })
                  await onChanged()
                }}
                success="Aprovado"
              >
                Aprovar
              </ActionButton>
              <OverflowMenu label={`Ações de ${p.name}`}>
                <button type="button" onClick={() => abrirRecusa(p)}>
                  Recusar
                </button>
              </OverflowMenu>
            </div>
          ))}
        </section>
      )}
      {!data && !error && <p className="muted">Carregando…</p>}
      {data && sessoes.length === 0 && !proxima && (
        <EmptyState
          icon={<CalendarDays size={28} />}
          message={
            staff
              ? 'Nenhuma aula hoje. Crie uma na Agenda para o time treinar.'
              : 'Nenhuma aula hoje. Confira a Agenda para os próximos treinos.'
          }
        />
      )}
      {proxima && (
        <section className="next-class" aria-label="Próxima aula">
          <h2>Nenhuma aula hoje</h2>
          <div className="today-card">
            <div className="today-card-head">
              <span className="today-time">{timeLabel(proxima.startsAt)}</span>
              <h3>{proxima.title}</h3>
            </div>
            <p className="today-counts">Próxima aula: {dayLabel(proxima.startsAt)}</p>
          </div>
        </section>
      )}
      <ul className="today-list">
        {sessoes.map((s) => {
          const checkinsCount = staff ? (s.checkins ?? 0) : null
          return (
            <li key={s.id} className="today-card">
              <div className="today-card-head">
                <span className="today-time">{timeLabel(s.startsAt)}</span>
                <h3>{s.title}</h3>
              </div>
              {s.status === 'cancelada' ? (
                <p className="today-cancelled">
                  Cancelada{s.cancelReason ? ` · ${s.cancelReason}` : ''}
                </p>
              ) : (
                <>
                  {checkinsCount !== null && (
                    <p className="today-counts">
                      {checkinsCount === 0
                        ? 'Nenhum aluno fez check-in ainda'
                        : `${checkinsCount} ${checkinsCount === 1 ? 'aluno fez' : 'alunos fizeram'} check-in`}
                    </p>
                  )}
                  <div className="today-actions">
                    <button type="button" className="secondary" onClick={() => setCheckins(s.id)}>
                      Ver check-ins
                    </button>
                    <button type="button" className="secondary" onClick={() => onOpenSession(s.id)}>
                      <Pencil size={16} /> Editar treino e fotos
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {aula && (
        <CheckinSheet
          aula={aula}
          call={call}
          onChanged={async () => {
            await reload()
            await onChanged()
          }}
          onClose={() => setCheckins(null)}
        />
      )}
      {recusando && (
        <dialog
          ref={dialogRecusa}
          open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined}
          aria-labelledby="recusar-title"
          onCancel={() => setRecusando(null)}
        >
          <h2 id="recusar-title">Confirmar alteração</h2>
          <p>Recusar {recusando.name}?</p>
          {erroRecusa && (
            <p className="error-message" role="alert">
              {erroRecusa}
            </p>
          )}
          <div className="dialog-actions">
            <button className="secondary" type="button" onClick={() => setRecusando(null)}>
              Cancelar
            </button>
            <button className="primary" type="button" onClick={() => void recusar()}>
              Confirmar
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}

/** Folha de check-ins: quem fez check-in na aula, com opção de excluir. */
function CheckinSheet({
  aula,
  call,
  onChanged,
  onClose,
}: {
  aula: SessionView
  call: Call
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  const { data, error, reload } = useLoad(
    () => call<SessionDetail>('session_detail', { p_session: aula.id }),
    [call, aula.id],
  )
  const toast = useToast()
  // Só o que veio de check-in do aluno; presença lançada pelo professor
  // (source 'professor') aparece na tela da aula, não aqui.
  const checkins = (data?.students ?? []).filter(
    (x) => x.source === 'checkin' && (x.status === 'pendente' || x.status === 'confirmada'),
  )
  const rotulo: Record<StatusPresenca, string> = {
    pendente: 'Fez check-in',
    confirmada: 'Presença confirmada',
    rejeitada: 'Presença recusada',
  }
  return (
    <BottomSheet open title={`Check-ins · ${aula.title}`} onClose={onClose}>
      <div className="checkin-sheet">
        {error && (
          <p className="error-message" role="alert">
            {error}{' '}
            <button type="button" onClick={() => void reload()}>
              Tentar de novo
            </button>
          </p>
        )}
        {!data && !error && <p className="muted">Carregando…</p>}
        {data && checkins.length === 0 && (
          <p className="empty">Nenhum aluno fez check-in nesta aula ainda.</p>
        )}
        <ul className="checkin-list">
          {checkins.map((x) => (
            <li key={x.id} className="checkin-row">
              <div>
                <strong>{x.name}</strong>
                <span className={`call-status st-${x.status}`}>{rotulo[x.status!]}</span>
              </div>
              <ActionButton
                className="secondary danger"
                label={`Excluir check-in de ${x.name}`}
                confirm={`Excluir o check-in de ${x.name}? Use se ele não apareceu no treino.`}
                action={async () => {
                  await call('teacher_remove_presence', { p_session: aula.id, p_student: x.id })
                  toast.show('Check-in excluído')
                  await reload()
                  await onChanged()
                }}
              >
                <Trash2 size={16} /> Excluir
              </ActionButton>
            </li>
          ))}
        </ul>
        <p className="field-help">
          Para confirmar presenças e lançar quem chegou sem check-in, abra o treino.
        </p>
      </div>
    </BottomSheet>
  )
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
