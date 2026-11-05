/** All money is integer paise (INR minor units). Never use floats for amounts. */
export type Paise = number

export const CURRENCY_SYMBOL = '₹'

export function formatINR(paise: Paise): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const rupees = Math.trunc(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  // en-IN grouping: 12,34,567
  const grouped = new Intl.NumberFormat('en-IN').format(rupees)
  return `${sign}${CURRENCY_SYMBOL}${grouped}.${frac}`
}

/** Parse "1,234.5" -> 123450. Returns null if invalid. */
export function parseINR(input: string): Paise | null {
  const s = input.replace(/[₹,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [r, f = ''] = s.split('.')
  return Number(r) * 100 + Number(f.padEnd(2, '0'))
}

/** Like parseINR but allows a leading minus, for discounts. "-50" -> -5000. */
export function parseSignedINR(input: string): Paise | null {
  const t = input.trim()
  const neg = t.startsWith('-') || t.startsWith('−')
  const p = parseINR(neg ? t.slice(1) : t)
  return p === null ? null : neg ? -p : p
}
