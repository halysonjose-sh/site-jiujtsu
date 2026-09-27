import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Folha de ações que sobe do pé da tela; fecha por Esc, backdrop ou botão. */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const origem = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) {
      origem.current = document.activeElement as HTMLElement | null
      dialog.current?.showModal?.()
      dialog.current?.querySelector<HTMLElement>('button')?.focus()
    } else if (origem.current) {
      origem.current.focus?.()
      origem.current = null
    }
  }, [open])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <dialog
        ref={dialog}
        open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onCancel={(e) => {
          e.preventDefault()
          onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        {children}
      </dialog>
    </div>
  )
}
