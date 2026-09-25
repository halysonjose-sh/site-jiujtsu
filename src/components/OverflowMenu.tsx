import { useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { BottomSheet } from './BottomSheet'

/** Gatilho "⋯" que abre as ações (inclusive destrutivas) numa folha. */
export function OverflowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-label={label} onClick={() => setOpen(true)}>
        <MoreHorizontal size={22} />
      </button>
      {open && (
        <BottomSheet open title={label} onClose={() => setOpen(false)}>
          <div className="menu-list" onClick={() => setOpen(false)}>
            {children}
          </div>
        </BottomSheet>
      )}
    </>
  )
}
