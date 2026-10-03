import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Camera, Check, Users } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { BottomSheet } from './BottomSheet'
import { EmptyState } from './EmptyState'
import { OverflowMenu } from './OverflowMenu'
import { presenceLabel, timeLabel, useLoad } from './Classes'
import { useToast } from './Toast'
import {
  callChanges,
  callRows,
  callUndo,
  reviewCount,
  sessionsOfToday,
  type LinhaChamada,
  type PassoChamada,
} from '../domain/today'
import {
  friendlyError,
  type Call,
  type SessionDetail,
  type SessionView,
  type StudentView,
} from '../lib/api'

type Mutate = (name: string, args?: Record<string, unknown>) => Promise<void>

/** Professor: aulas de hoje, aprovações pendentes e folha de chamada. */
export function Today({
  call,
  mutate,
  today,
  students,
  roster,
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
  roster: { id: string; name: string }[]
  onChanged: () => Promise<void> | void
  onOpenSession: (id: string) => void
  onCounts?: (reviews: number) => void
  staff?: boolean
  /** Relógio injetável para testes; em produção usa Date.now(). */
  agora?: number
}) {
  const pendencias = students.filter((s) => s.memberStatus === 'pendente')
  const { data, error, reload } = useLoad(
    () => call<SessionView[]>('list_sessions', { p_from: today, p_to: today }),
    [call, today],
  )
  const sessoes = sessionsOfToday(data ?? [], today)
  const [chamada, setChamada] = useState<string | null>(null)
  const [recusando, setRecusando] = useState<StudentView | null>(null)
  const [erroRecusa, setErroRecusa] = useState<string | null>(null)
  const dialogRecusa = useRef<HTMLDialogElement>(null)
  const toast = useToast()
  const aula = sessoes.find((s) => s.id === chamada) ?? null
  const revisar = sessoes.filter((s) => (s.pending ?? 0) > 0 && s.status !== 'cancelada')

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
      {(pendencias.length > 0 || revisar.length > 0) && (
        <section className="pendencias" aria-label="Pendências">
          <h2>Pendências</h2>
          {pendencias.length > 0 && (
            <div className="pendencia-aprovacoes">
              <h3>Aguardando aprovação</h3>
              {pendencias.map((p) => (
                <div key={p.id} className="pendencia-row">
                  <span>{p.name}</span>
                  <ActionButton
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
            </div>
          )}
          {revisar.map((s) => (
            <button
              key={s.id}
              type="button"
              className="pendencia-review"
              onClick={() => setChamada(s.id)}
            >
              {s.pending} {s.pending === 1 ? 'presença' : 'presenças'} a revisar
            </button>
          ))}
        </section>
      )}
      {data && sessoes.length === 0 && (
        <EmptyState
          icon={<CalendarDays size={28} />}
          message={
            staff
              ? 'Nenhuma aula hoje. Crie uma na Agenda para o time treinar.'
              : 'Nenhuma aula hoje. Confira a Agenda para os próximos treinos.'
          }
        />
      )}
      <ul className="today-list">
        {sessoes.map((s) => {
          const c = s.confirmed ?? 0
          const p = s.pending ?? 0
          return (
            <li key={s.id} className="today-card">
              <div className="today-card-head">
                <span className="today-time">{timeLabel(s.startsAt)}</span>
                <h3>{s.title}</h3>
              </div>
              {(s.confirmed !== null || s.pending !== null) && (
                <p className="today-counts">
                  {c} {c === 1 ? 'confirmado' : 'confirmados'} · {p} a revisar
                </p>
              )}
              {s.status === 'cancelada' && (
                <p className="today-cancelled">
                  Cancelada{s.cancelReason ? ` · ${s.cancelReason}` : ''}
                </p>
              )}
              {s.status !== 'cancelada' && (
                <button type="button" className="secondary" onClick={() => setChamada(s.id)}>
                  Fazer chamada
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {aula && (
        <CallSheet
          aula={aula}
          call={call}
          roster={roster}
          agora={agora}
          onChanged={onChanged}
          onOpenSession={onOpenSession}
          reloadToday={() => reload()}
          onClose={() => setChamada(null)}
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

/** Folha de chamada: marca presenças da aula e salva em lote. */
function CallSheet({
  aula,
  call,
  roster,
  agora,
  onChanged,
  onOpenSession,
  reloadToday,
  onClose,
}: {
  aula: SessionView
  call: Call
  roster: { id: string; name: string }[]
  agora?: number
  onChanged: () => Promise<void> | void
  onOpenSession: (id: string) => void
  reloadToday: () => Promise<void>
  onClose: () => void
}) {
  const { data, error, reload } = useLoad(
    () => call<SessionDetail>('session_detail', { p_session: aula.id }),
    [call, aula.id],
  )
  const inicial: LinhaChamada[] = callRows(data?.students ?? [], roster)
  const iniciais = new Set(
    inicial.filter((l) => l.status === 'confirmada' || l.status === 'pendente').map((l) => l.id),
  )
  const [marcados, setMarcados] = useState<Set<string> | null>(null)
  const [salvo, setSalvo] = useState(false)
  const t = agora ?? Date.now()
  const iniciada = new Date(aula.startsAt).getTime() <= t
  const mudancas = callChanges(inicial, marcados ?? iniciais)
  const semMudanca =
    mudancas.confirm.length + mudancas.remove.length + mudancas.reject.length === 0
  const ultimo = useRef<{ passos: PassoChamada[] | null } | null>(null)
  const toast = useToast()

  function alternar(id: string) {
    setSalvo(false)
    setMarcados((prev) => {
      const base = prev ?? iniciais
      const prox = new Set(base)
      if (prox.has(id)) prox.delete(id)
      else prox.add(id)
      return prox
    })
  }

  async function salvar() {
    if (semMudanca) return
    if (mudancas.confirm.length)
      await call('confirm_presences', { p_session: aula.id, p_students: mudancas.confirm })
    for (const id of mudancas.remove)
      await call('teacher_remove_presence', { p_session: aula.id, p_student: id })
    for (const id of mudancas.reject)
      await call('review_presence', { p_session: aula.id, p_student: id, p_decision: 'rejeitada' })
    // Grava só depois de todas as RPCs terem sucesso: falha nunca oferece
    // Desfazer. callUndo devolve null quando o estado inicial não é
    // restaurável (check-in pendente não tem RPC que volte).
    ultimo.current = { passos: callUndo(inicial, mudancas, aula.id) }
    setSalvo(true)
    await reload()
    await reloadToday()
    await onChanged()
  }

  async function desfazer() {
    const u = ultimo.current
    if (!u?.passos) return
    for (const passo of u.passos) await call(passo.rpc, passo.args)
    await reload()
    await reloadToday()
    await onChanged()
  }

  function fechar() {
    // O toast só existe fora da folha (que fica no top layer), então sai no
    // fechar: os 3 segundos do Desfazer contam a partir daí, não do Salvar.
    if (salvo) toast.show('Chamada salva', ultimo.current?.passos ? desfazer : undefined)
    onClose()
  }

  return (
    <BottomSheet open title="Fazer chamada" onClose={fechar}>
      <div className="call-sheet">
        {error && (
          <p className="error-message" role="alert">
            {error}{' '}
            <button type="button" onClick={() => void reload()}>
              Tentar de novo
            </button>
          </p>
        )}
        {!data && !error && <p className="muted">Carregando…</p>}
        <ul className="call-list">
          {inicial.map((l) => (
            <li key={l.id}>
              <label className="call-row">
                <input
                  type="checkbox"
                  aria-label={l.name}
                  checked={(marcados ?? iniciais).has(l.id)}
                  onChange={() => alternar(l.id)}
                />
                <span className="call-name">{l.name}</span>
                {l.status && (
                  <span className={`call-status st-${l.status}`}>{presenceLabel[l.status]}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
        {!iniciada && <p className="call-hint">A chamada abre quando a aula começar.</p>}
        <button type="button" className="ghost" onClick={() => onOpenSession(aula.id)}>
          <Camera size={18} /> Fotos do treino
        </button>
        {salvo && <p className="success-message">Chamada salva</p>}
        <ActionButton
          className="primary-dock"
          action={salvar}
          disabled={!iniciada || semMudanca}
        >
          Salvar presenças
        </ActionButton>
      </div>
    </BottomSheet>
  )
}
