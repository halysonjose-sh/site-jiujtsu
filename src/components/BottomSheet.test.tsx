import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { useState } from 'react'
import { BottomSheet } from './BottomSheet'

function Folha({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir folha</button>
      <BottomSheet open={open} title="Fazer chamada" onClose={onClose}>
        <p>Conteúdo da folha</p>
      </BottomSheet>
    </>
  )
}

it('mostra título e conteúdo e fecha pelo botão Fechar', () => {
  const onClose = vi.fn()
  render(<Folha onClose={onClose} />)
  expect(screen.getByText('Fazer chamada')).toBeTruthy()
  expect(screen.getByText('Conteúdo da folha')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
it('fecha pelo Esc e pelo clique no backdrop', () => {
  const onClose = vi.fn()
  const { container } = render(<Folha onClose={onClose} />)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
  const backdrop = container.querySelector('.sheet-backdrop') as HTMLElement
  fireEvent.click(backdrop)
  expect(onClose).toHaveBeenCalledTimes(2)
})
it('devolve o foco ao gatilho ao fechar', () => {
  function Gatilho() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Abrir folha</button>
        <BottomSheet open={open} title="Folha" onClose={() => setOpen(false)}>
          <p>Conteúdo</p>
        </BottomSheet>
      </>
    )
  }
  render(<Gatilho />)
  const gatilho = screen.getByRole('button', { name: 'Abrir folha' })
  gatilho.focus()
  fireEvent.click(gatilho)
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
  expect(document.activeElement).toBe(gatilho)
})
