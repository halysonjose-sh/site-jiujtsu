import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { ActionButton } from './ActionButton'
it('impede envios repetidos e só confirma após resposta', async () => {
  let finish!: () => void
  const action = vi.fn(
    () =>
      new Promise<void>((r) => {
        finish = r
      }),
  )
  render(
    <ActionButton action={action} success="Presença registrada">
      Registrar presença
    </ActionButton>,
  )
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('button'))
  expect(action).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button')).toBeDisabled()
  expect(screen.queryByText('Presença registrada')).toBeNull()
  finish()
  await screen.findByText('Presença registrada')
})
it('mostra erro sem confirmar e permite tentar novamente', async () => {
  const action = vi
    .fn()
    .mockRejectedValueOnce(new Error('Sem conexão'))
    .mockResolvedValueOnce(undefined)
  render(
    <ActionButton action={action} success="Salvo">
      Salvar
    </ActionButton>,
  )
  fireEvent.click(screen.getByRole('button'))
  await screen.findByRole('alert')
  expect(screen.queryByText('Salvo')).toBeNull()
  fireEvent.click(screen.getByRole('button'))
  await screen.findByText('Salvo')
  expect(action).toHaveBeenCalledTimes(2)
})
it('pede confirmação antes de executar e respeita cancelamento', async () => {
  const action = vi.fn()
  render(
    <ActionButton action={action} confirm="Conceder um grau?">
      Conceder
    </ActionButton>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Conceder' }))
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Conceder' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
})
it('bloqueia ações offline', () => {
  render(
    <ActionButton action={vi.fn()} disabled>
      Salvar
    </ActionButton>,
  )
  expect(screen.getByRole('button')).toBeDisabled()
})
