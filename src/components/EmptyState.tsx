import type { ReactNode } from 'react'

/** Estado vazio com frase clara e, opcionalmente, um caminho de ação. */
export function EmptyState({
  icon,
  message,
  action,
}: {
  icon?: ReactNode
  message: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="empty-state">
      {icon}
      <p>{message}</p>
      {action && (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
