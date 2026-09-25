import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type Aviso = { msg: string; undo?: () => Promise<unknown> }
const Ctx = createContext<{ show: (msg: string, undo?: () => Promise<unknown>) => void }>({
  show: () => {},
})

/** Mensagem rápida acima da barra inferior; useToast() sem provedor não faz nada. */
export function useToast() {
  return useContext(Ctx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((msg: string, undo?: () => Promise<unknown>) => {
    setAviso({ msg, undo })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAviso(null), 3000)
  }, [])
  async function desfazer() {
    const atual = aviso
    if (timer.current) clearTimeout(timer.current)
    setAviso(null)
    await atual?.undo?.()
  }
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {aviso && (
        <div className="toast" aria-live="polite">
          <span>{aviso.msg}</span>
          {aviso.undo && (
            <button type="button" onClick={() => void desfazer()}>
              Desfazer
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  )
}
