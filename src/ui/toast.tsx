import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

type Kind = 'ok' | 'error'
interface ToastItem {
  id: number
  text: string
  kind: Kind
}
type Notify = (text: string, kind?: Kind) => void

const ToastCtx = createContext<Notify>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const notify = useCallback<Notify>((text, kind = 'ok') => {
    const id = next.current++
    setItems((xs) => [...xs, { id, text, kind }])
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2800)
  }, [])
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/** Run an action: refresh data afterwards, show a toast, never throw. Returns undefined on failure. */
export function useRun() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMemo(
    () =>
      async function run<T>(fn: () => Promise<T>, okMessage?: string): Promise<T | undefined> {
        try {
          const result = await fn()
          await qc.invalidateQueries()
          if (okMessage) toast(okMessage)
          return result
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Something went wrong', 'error')
          return undefined
        }
      },
    [qc, toast],
  )
}
