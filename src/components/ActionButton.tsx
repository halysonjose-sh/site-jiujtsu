import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { friendlyError } from '../lib/api'
import { useToast } from './Toast'
export function ActionButton({
  children,
  action,
  success,
  undo,
  confirm,
  disabled,
  className = '',
  label,
}: {
  children: ReactNode
  action: () => Promise<unknown>
  success?: string
  undo?: () => Promise<unknown>
  confirm?: string
  disabled?: boolean
  className?: string
  label?: string
}) {
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [asking, setAsking] = useState(false)
  const toast = useToast()
  const locked = useRef(false),
    dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (asking) {
      dialog.current?.showModal?.()
      dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }
  }, [asking])
  async function run() {
    if (locked.current || disabled) return
    locked.current = true
    setPending(true)
    setError('')
    setMessage('')
    setAsking(false)
    try {
      await action()
      setMessage(success ?? '')
      if (success) toast.show(success, undo)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  function cancel() {
    setAsking(false)
    trigger.current?.focus()
  }
  return (
    <div className="action-wrap">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        className={className}
        disabled={disabled || pending}
        onClick={() => (confirm ? setAsking(true) : void run())}
      >
        {pending ? (
          <>
            <LoaderCircle size={18} className="spin" /> Aguarde…
          </>
        ) : (
          children
        )}
      </button>
      {message && <p className="success-message">{message}</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {asking && (
        <dialog
          ref={dialog}
          open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined}
          aria-labelledby="confirmation-title"
          onCancel={cancel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
          }}
        >
          <h2 id="confirmation-title">Confirmar alteração</h2>
          <p>{confirm}</p>
          <div className="dialog-actions">
            <button className="secondary" type="button" onClick={cancel}>
              Cancelar
            </button>
            <button
              className="primary"
              type="button"
              disabled={disabled || pending}
              onClick={() => void run()}
            >
              Confirmar
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}
