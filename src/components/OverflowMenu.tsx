import { useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { BottomSheet } from './BottomSheet'

/** Gatilho "⋯" que abre as ações (inclusive destrutivas) numa folha. */
export function OverflowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="icon-button" aria-label={label} onClick={() => setOpen(true)}>
        <MoreHorizontal size={22} />
      </button>
      {open && (
        <BottomSheet open title={label} onClose={() => setOpen(false)}>
          <div
            className="menu-list"
            onClick={(e) => {
              // Itens marcados com data-stay (ex.: confirmação de ação destrutiva)
              // mantêm a folha aberta para o diálogo continuar existindo.
              if (!(e.target as HTMLElement).closest('[data-stay]')) setOpen(false)
            }}
          >
            {children}
          </div>
        </BottomSheet>
      )}
    </>
  )
}
