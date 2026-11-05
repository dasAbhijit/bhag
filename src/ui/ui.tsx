import { useEffect, useId, useRef, type ReactNode } from 'react'
import { formatINR, type Paise } from '../core/money'

/** A signed amount: green when you are owed, amber when you owe, grey at zero. */
export function Money({ paise, signed = false, className = '' }: { paise: Paise; signed?: boolean; className?: string }) {
  const tone = paise > 0 ? 'pos' : paise < 0 ? 'neg' : 'zero'
  return (
    <span className={`money ${signed ? tone : ''} ${className}`}>
      {signed && paise > 0 ? '+' : ''}
      {formatINR(paise)}
    </span>
  )
}

const HUES = [172, 24, 210, 280, 340, 48, 140, 8]
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const hue = HUES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length]
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 45% 88%)`, color: `hsl(${hue} 55% 22%)` }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="center muted" role="status">
      {label}…
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
    </div>
  )
}

/** A bottom sheet on phones and a dialog on wide screens. Closes on Escape and on backdrop click. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          <h2 id={id}>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function ErrorNote({ error }: { error: Error | string | null }) {
  if (!error) return null
  return (
    <div className="note error" role="alert">
      {typeof error === 'string' ? error : error.message}
    </div>
  )
}

export { CATEGORIES, categoryLabel } from '../core/categories'

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
export const todayISO = (): string => {
  // India date, because amounts are in rupees and the server schedules on India time.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

export function ConfirmSheet({
  title, children, confirmLabel, danger = false, onConfirm, onClose,
}: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div>{children}</div>
      <div className="actions">
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  )
}

/** Copy text; falls back to selecting it when the clipboard is blocked. Returns whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
