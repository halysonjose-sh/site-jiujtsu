import { useEffect, useState } from 'react'
export function useConnection() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    let alive = true,
      checking = false
    let active: AbortController | null = null
    const check = async () => {
      if (checking) return
      if (!navigator.onLine) {
        setOnline(false)
        return
      }
      checking = true
      active = new AbortController()
      const timer = window.setTimeout(() => active?.abort(), 5000)
      try {
        const response = await fetch('/online.txt', { cache: 'no-store', signal: active.signal })
        const valid = response.ok && (await response.text()).trim() === 'tatame-online'
        if (alive) setOnline(valid)
      } catch {
        if (alive) setOnline(false)
      } finally {
        clearTimeout(timer)
        checking = false
      }
    }
    const off = () => {
      active?.abort()
      setOnline(false)
    }
    const on = () => void check()
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    window.addEventListener('focus', on)
    const timer = window.setInterval(on, 15000)
    void check()
    return () => {
      alive = false
      active?.abort()
      clearInterval(timer)
      window.removeEventListener('offline', off)
      window.removeEventListener('online', on)
      window.removeEventListener('focus', on)
    }
  }, [])
  return online
}
