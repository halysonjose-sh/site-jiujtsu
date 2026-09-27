import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { OverflowMenu } from './OverflowMenu'

it('abre pelo gatilho com aria-label e fecha ao acionar uma ação', () => {
  const recusar = vi.fn()
  render(
    <OverflowMenu label="Ações da pendência">
      <button onClick={recusar}>Recusar</button>
    </OverflowMenu>,
  )
  const gatilho = screen.getByRole('button', { name: 'Ações da pendência' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(gatilho)
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
  expect(recusar).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('fecha pelo Esc e pelo clique no backdrop sem acionar ações', () => {
  const recusar = vi.fn()
  const { container } = render(
    <OverflowMenu label="Ações">
      <button onClick={recusar}>Recusar</button>
    </OverflowMenu>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ações' }))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ações' }))
  const backdrop = container.querySelector('.sheet-backdrop') as HTMLElement
  fireEvent.click(backdrop)
  expect(recusar).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})
