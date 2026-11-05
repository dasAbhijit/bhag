import type { Frequency } from './types'

/** Dates are 'YYYY-MM-DD' strings. All math is in UTC so time zones never shift a day. */

function parse(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`Invalid date: ${iso}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * The n-th occurrence (n = 0 is `start`). Months and years are counted from `start`, not from
 * the previous occurrence, so a monthly bill on the 31st goes Jan 31, Feb 28, Mar 31, Apr 30.
 * This matches PostgreSQL's `start + n * interval '1 month'`, which the scheduled job uses.
 */
export function occurrence(start: string, freq: Frequency, n: number): string {
  const { y, m, d } = parse(start)
  if (freq === 'weekly') {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * n))
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
  }
  if (freq === 'monthly') {
    const idx = m - 1 + n
    const ny = y + Math.floor(idx / 12)
    const nm = (idx % 12) + 1
    return format(ny, nm, Math.min(d, daysInMonth(ny, nm)))
  }
  const ny = y + n
  return format(ny, m, Math.min(d, daysInMonth(ny, m)))
}

/**
 * Occurrences that should be posted now: from occurrence number `posted` up to `today`
 * (and `end`, if set). Catches up on missed runs. Capped so a bad date cannot loop forever.
 */
export function dueOccurrences(
  start: string,
  freq: Frequency,
  posted: number,
  today: string,
  end?: string | null,
  cap = 366,
): string[] {
  const out: string[] = []
  for (let n = posted; out.length < cap; n++) {
    const date = occurrence(start, freq, n)
    if (date > today || (end && date > end)) break
    out.push(date)
  }
  return out
}
