import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Today } from './Today'
import { ToastProvider } from './Toast'
import type { Call, SessionView, StudentView } from '../lib/api'

const HOJE = '2026-09-25'
// Relógio fixo (09:00 em SP) para o teste não depender da hora real.
const AGORA = Date.parse('2026-09-25T12:00:00Z')
const INICIADA = '2026-09-25T10:00:00Z' // 07:00 em SP, antes de AGORA
const FUTURA = '2026-09-25T22:30:00Z' // 19:30 em SP, depois de AGORA

const sessao = (over: Partial<SessionView> & { id: string; startsAt: string }): SessionView => ({
  title: 'Jiu-jítsu adulto',
  durationMin: 90,
  status: 'prevista',
  cancelReason: null,
  description: null,
  scheduleId: 'sch-1',
  photos: 0,
  cover: null,
  checkins: 0,
  pending: null,
  confirmed: null,
  mine: null,
  ...over,
})

const aluno = (over: Partial<StudentView>): StudentView => ({
  id: 'x',
  name: 'Xavier Xavier',
  role: 'aluno',
  memberStatus: 'ativo',
  revision: 0,
  belt: 'branca',
  degrees: 0,
  total: 0,
  cycle: 0,
  today: HOJE,
  initialSet: false,
  attendances: [],
  events: [],
  ...over,
})

const turma = (): StudentView[] => [
  aluno({ id: 'lucas', name: 'Lucas Almeida' }),
  aluno({ id: 'marina', name: 'Marina Santos' }),
  aluno({ id: 'pedro', name: 'Pedro Oliveira' }),
  aluno({ id: 'duda', name: 'Duda Ferreira' }),
  aluno({ id: 'ana', name: 'Ana Costa', memberStatus: 'pendente' }),
]

const detalhe = {
  id: 'aula1',
  title: 'Jiu-jítsu adulto',
  startsAt: INICIADA,
  durationMin: 90,
  status: 'prevista' as const,
  cancelReason: null,
  description: null,
  students: [
    { id: 'lucas', name: 'Lucas Almeida', status: 'confirmada' as const, source: 'checkin' },
    { id: 'marina', name: 'Marina Santos', status: 'pendente' as const, source: 'checkin' },
    { id: 'pedro', name: 'Pedro Oliveira', status: null, source: null },
    { id: 'duda', name: 'Duda Ferreira', status: 'rejeitada' as const, source: null },
  ],
}

function setup(
  sessoes: SessionView[],
  opts?: { detail?: unknown; alunos?: StudentView[]; mutate?: () => Promise<void> },
) {
  const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'list_sessions') return sessoes
    if (name === 'session_detail') return opts?.detail ?? detalhe
    return null
  })
  const mutate = opts?.mutate ?? vi.fn(async () => undefined)
  const onChanged = vi.fn(async () => undefined)
  const onOpenSession = vi.fn()
  render(
    <ToastProvider>
      <Today
        call={call as unknown as Call}
        mutate={mutate}
        today={HOJE}
        students={opts?.alunos ?? turma()}
        roster={turma().map((s) => ({ id: s.id, name: s.name }))}
        onChanged={onChanged}
        onOpenSession={onOpenSession}
        agora={AGORA}
      />
    </ToastProvider>,
  )
  return { call, mutate, onChanged, onOpenSession }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('Today', () => {
  it('mostra as aulas do dia em cartões com contagens e chamada', async () => {
    setup([
      sessao({ id: 'aula1', startsAt: INICIADA, confirmed: 3, pending: 2 }),
      sessao({
        id: 'aula2',
        title: 'Treino de competição',
        startsAt: FUTURA,
        status: 'cancelada',
        cancelReason: 'Chuva',
      }),
    ])
    expect(await screen.findByText('Jiu-jítsu adulto')).toBeTruthy()
    expect(screen.getByText('3 confirmados · 2 a revisar')).toBeTruthy()
    // A aula cancelada não oferece chamada
    expect(screen.getAllByRole('button', { name: 'Fazer chamada' })).toHaveLength(1)
    expect(screen.getByText(/Cancelada/)).toBeTruthy()
  })

  it('mostra aprovações pendentes e presenças a revisar', async () => {
    const { mutate } = setup([sessao({ id: 'aula1', startsAt: INICIADA, pending: 2 })])
    expect(await screen.findByText('Aguardando aprovação')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar Ana Costa' }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith('approve_member', { p_user: 'ana', p_approve: true }),
    )
    fireEvent.click(screen.getByText('2 presenças a revisar'))
    await screen.findByRole('dialog')
  })

  it('recusar fica no menu de ações e pede confirmação', async () => {
    const { mutate } = setup([sessao({ id: 'aula1', startsAt: INICIADA })])
    await screen.findByText('Aguardando aprovação')
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Ana Costa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith('approve_member', { p_user: 'ana', p_approve: false }),
    )
  })

  it('folha marca confirmada e pendente, deixa resto desmarcado', async () => {
    setup([sessao({ id: 'aula1', startsAt: INICIADA, confirmed: 1, pending: 1 })])
    fireEvent.click(await screen.findByRole('button', { name: 'Fazer chamada' }))
    const folha = await screen.findByRole('dialog')
    await screen.findByRole('checkbox', { name: 'Lucas Almeida' })
    expect(screen.getByRole('checkbox', { name: 'Lucas Almeida' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Marina Santos' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Pedro Oliveira' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Duda Ferreira' })).not.toBeChecked()
    // tocar a linha alterna
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pedro Oliveira' }))
    expect(screen.getByRole('checkbox', { name: 'Pedro Oliveira' })).toBeChecked()
    expect(folha.querySelector('.primary-dock')).toBeTruthy()
  })

  it('desmarcar pendente salva review_presence rejeitada sem confirm_presences', async () => {
    const { call, onChanged } = setup([sessao({ id: 'aula1', startsAt: INICIADA, pending: 1 })])
    fireEvent.click(await screen.findByRole('button', { name: 'Fazer chamada' }))
    await screen.findByRole('dialog')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Marina Santos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar presenças' }))
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('review_presence', {
        p_session: 'aula1',
        p_student: 'marina',
        p_decision: 'rejeitada',
      }),
    )
    expect(
      call.mock.calls.some(([nome]) => nome === 'confirm_presences'),
    ).toBe(false)
    // Mensagem inline na folha; o toast só sai quando ela fecha.
    expect(screen.getByText('Chamada salva')).toBeTruthy()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Recusa envolve check-in pendente: produção não tem RPC que volte a
    // 'pendente', então o toast pós-fechar não oferece Desfazer.
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await screen.findByText('Chamada salva')
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull()
  })

  it('Desfazer restaura o aluno que não tinha registro', async () => {
    // Sem check-in pendente no detalhe: só esse estado é restaurável.
    const { call } = setup([sessao({ id: 'aula1', startsAt: INICIADA })], {
      detail: {
        ...detalhe,
        students: [
          { id: 'lucas', name: 'Lucas Almeida', status: 'confirmada' as const, source: 'checkin' },
          { id: 'pedro', name: 'Pedro Oliveira', status: null, source: null },
        ],
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Fazer chamada' }))
    await screen.findByRole('dialog')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Pedro Oliveira' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar presenças' }))
    await screen.findByText('Chamada salva')
    expect(call).toHaveBeenCalledWith('confirm_presences', {
      p_session: 'aula1',
      p_students: ['pedro'],
    })
    // O toast com Desfazer só existe fora do top layer da folha: fecha primeiro.
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('teacher_remove_presence', {
        p_session: 'aula1',
        p_student: 'pedro',
      }),
    )
  })

  it('recusar com falha mantém o diálogo aberto e mostra o erro', async () => {
    const { mutate } = setup([sessao({ id: 'aula1', startsAt: INICIADA })], {
      mutate: vi.fn(async () => {
        throw new Error('Sem conexão.')
      }),
    })
    await screen.findByText('Aguardando aprovação')
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Ana Costa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith('approve_member', { p_user: 'ana', p_approve: false }),
    )
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy()
  })

  it('desabilita salvar antes do início e mostra a dica', async () => {
    setup([
      sessao({ id: 'aula1', startsAt: FUTURA }),
    ], { detail: { ...detalhe, startsAt: FUTURA } })
    fireEvent.click(await screen.findByRole('button', { name: 'Fazer chamada' }))
    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: 'Salvar presenças' })).toBeDisabled()
    expect(screen.getByText('A chamada abre quando a aula começar.')).toBeTruthy()
  })

  it('estado vazio quando não há aula hoje', async () => {
    setup([])
    expect(await screen.findByText('Nenhuma aula hoje.')).toBeTruthy()
  })

  it('Fotos do treino navega para a tela da aula', async () => {
    const { onOpenSession } = setup([sessao({ id: 'aula1', startsAt: INICIADA })])
    fireEvent.click(await screen.findByRole('button', { name: 'Fazer chamada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fotos do treino' }))
    expect(onOpenSession).toHaveBeenCalledWith('aula1')
  })
})
