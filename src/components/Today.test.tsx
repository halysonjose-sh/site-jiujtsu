import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Today } from './Today'
import { ToastProvider } from './Toast'
import type { Call, PhotoStore, SessionDetail, SessionView, StudentView } from '../lib/api'

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
  held: 0,
  avatarPath: null,
  contact: null,
  birthDate: null,
  joinedAt: HOJE,
  attendances: [],
  events: [],
  ...over,
})

const turma = (): StudentView[] => [
  aluno({ id: 'lucas', name: 'Lucas Almeida' }),
  aluno({ id: 'marina', name: 'Marina Santos' }),
  aluno({ id: 'pedro', name: 'Pedro Oliveira' }),
  aluno({ id: 'ana', name: 'Ana Costa', memberStatus: 'pendente' }),
]

const detalhe: SessionDetail = {
  id: 'aula1',
  title: 'Jiu-jítsu adulto',
  startsAt: INICIADA,
  durationMin: 90,
  status: 'prevista',
  cancelReason: null,
  description: null,
  students: [
    { id: 'lucas', name: 'Lucas Almeida', status: 'confirmada', source: 'checkin' },
    { id: 'marina', name: 'Marina Santos', status: 'pendente', source: 'checkin' },
    { id: 'pedro', name: 'Pedro Oliveira', status: null, source: null },
  ],
}

function setup(
  sessoes: SessionView[],
  opts: { detail?: SessionDetail; students?: StudentView[]; photos?: PhotoStore } = {},
) {
  const onChanged = vi.fn(async () => {})
  const onOpenSession = vi.fn()
  const onCounts = vi.fn()
  const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'list_sessions') return sessoes
    if (name === 'session_detail') return opts.detail ?? detalhe
    if (name === 'teacher_remove_presence') return null
    throw new Error(`rpc inesperado: ${name}`)
  })
  render(
    <ToastProvider>
      <Today
        call={call as unknown as Call}
        mutate={vi.fn(async () => {})}
        today={HOJE}
        students={opts.students ?? turma()}
        onChanged={onChanged}
        onOpenSession={onOpenSession}
        onCounts={onCounts}
        staff
        agora={AGORA}
        photos={opts.photos}
      />
    </ToastProvider>,
  )
  return { call, onChanged, onOpenSession, onCounts }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Today (professor)', () => {
  it('mostra o treino do dia com contagem de check-ins', async () => {
    setup([sessao({ id: 'aula1', startsAt: INICIADA, checkins: 2 })])
    expect(await screen.findByText('2 alunos fizeram check-in')).toBeTruthy()
  })

  it('mostra a foto de capa do treino de hoje', async () => {
    const photos = {
      urls: vi.fn(async () => ({ 'capa.webp': 'blob:capa' })),
    } as unknown as PhotoStore
    setup([sessao({ id: 'aula1', startsAt: INICIADA, cover: 'capa.webp' })], { photos })
    const img = (await screen.findByAltText('Foto do treino Jiu-jítsu adulto')) as HTMLImageElement
    expect(img.src).toContain('blob:capa')
  })

  it('mostra estado vazio de check-in quando ninguém fez', async () => {
    setup([sessao({ id: 'aula1', startsAt: INICIADA, checkins: 0 })])
    expect(await screen.findByText('Nenhum aluno fez check-in ainda')).toBeTruthy()
  })

  it('folha de check-ins lista quem fez e exclui o check-in', async () => {
    const { call, onChanged } = setup([sessao({ id: 'aula1', startsAt: INICIADA, checkins: 2 })])
    fireEvent.click(await screen.findByRole('button', { name: 'Ver check-ins' }))
    const folha = await screen.findByRole('dialog')
    await waitFor(() => expect(folha.textContent).toContain('Lucas Almeida'))
    expect(folha.textContent).toContain('Marina Santos')
    expect(folha.textContent).not.toContain('Pedro Oliveira')
    fireEvent.click(
      within(folha).getByRole('button', { name: 'Excluir check-in de Marina Santos' }),
    )
    // ActionButton com confirm abre diálogo de confirmação antes de executar.
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('teacher_remove_presence', {
        p_session: 'aula1',
        p_student: 'marina',
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('folha de check-ins vazia mostra a frase de estado vazio', async () => {
    setup([sessao({ id: 'aula1', startsAt: INICIADA, checkins: 0 })], {
      detail: { ...detalhe, students: [] },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Ver check-ins' }))
    const folha = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(folha.textContent).toContain('Nenhum aluno fez check-in nesta aula ainda.'),
    )
  })

  it('sem aula hoje mostra a próxima aula da turma', async () => {
    setup([sessao({ id: 'proxima', startsAt: '2026-09-28T22:00:00Z', title: 'Jiu-jítsu kids' })])
    expect(await screen.findByText('Nenhuma aula hoje')).toBeTruthy()
    expect(await screen.findByText('Jiu-jítsu kids')).toBeTruthy()
    expect(screen.getByText(/Próxima aula:/)).toBeTruthy()
  })

  it('aprovação de aluno pendente continua na tela', async () => {
    setup([sessao({ id: 'aula1', startsAt: INICIADA })])
    expect(await screen.findByText('Aguardando aprovação')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aprovar Ana Costa' })).toBeTruthy()
  })

  it('aula cancelada não oferece botões de ação', async () => {
    setup([sessao({ id: 'aula1', startsAt: INICIADA, status: 'cancelada', cancelReason: 'chuva' })])
    expect(await screen.findByText(/Cancelada · chuva/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver check-ins' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar treino e fotos/ })).toBeNull()
  })

  it('Editar treino e fotos navega para a tela da aula', async () => {
    const { onOpenSession } = setup([sessao({ id: 'aula1', startsAt: INICIADA })])
    fireEvent.click(await screen.findByRole('button', { name: /Editar treino e fotos/ }))
    expect(onOpenSession).toHaveBeenCalledWith('aula1')
  })
})
