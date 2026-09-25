import { render, screen, fireEvent, act } from '@testing-library/react'
import { it, expect, vi, afterEach } from 'vitest'
import { useToast, ToastProvider } from './Toast'

function Aviso({
  msg,
  undo,
}: {
  msg: string
  undo?: () => Promise<unknown>
}) {
  const toast = useToast()
  return <button onClick={() => toast.show(msg, undo)}>Avisar</button>
}

afterEach(() => {
  vi.useRealTimers()
})

it('anuncia a mensagem numa região aria-live polite', () => {
  render(
    <ToastProvider>
      <Aviso msg="Chamada salva" />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Avisar' }))
  const regiao = screen.getByText('Chamada salva').closest('[aria-live]')
  expect(regiao?.getAttribute('aria-live')).toBe('polite')
})
it('some sozinho após 3 segundos', () => {
  vi.useFakeTimers()
  render(
    <ToastProvider>
      <Aviso msg="Chamada salva" />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Avisar' }))
  expect(screen.getByText('Chamada salva')).toBeTruthy()
  act(() => {
    vi.advanceTimersByTime(3100)
  })
  expect(screen.queryByText('Chamada salva')).toBeNull()
})
it('Desfazer executa a ação inversa e cancela o timer', () => {
  vi.useFakeTimers()
  const undo = vi.fn().mockResolvedValue(undefined)
  render(
    <ToastProvider>
      <Aviso msg="Chamada salva" undo={undo} />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Avisar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
  expect(undo).toHaveBeenCalledTimes(1)
  act(() => {
    vi.advanceTimersByTime(3100)
  })
  expect(undo).toHaveBeenCalledTimes(1)
})
