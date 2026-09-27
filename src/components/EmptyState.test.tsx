import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { EmptyState } from './EmptyState'

it('mostra a mensagem de vazio', () => {
  render(<EmptyState message="Nenhuma aula hoje." />)
  expect(screen.getByText('Nenhuma aula hoje.')).toBeTruthy()
})
it('dispara a ação oferecida', () => {
  const criar = vi.fn()
  render(
    <EmptyState message="Nenhuma aula hoje." action={{ label: 'Criar aula', onClick: criar }} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Criar aula' }))
  expect(criar).toHaveBeenCalledTimes(1)
})
