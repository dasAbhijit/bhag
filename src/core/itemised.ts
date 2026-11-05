import type { Paise } from './money'
import { allocate, SplitError } from './splits'
import type { PersonId } from './types'

/** One line on an invoice and the people who share it. */
export interface BillItem {
  name: string
  amount: Paise
  members: PersonId[]
}

export function itemsSubtotal(items: BillItem[]): Paise {
  return items.reduce((s, i) => s + i.amount, 0)
}

/**
 * Split an itemised bill. Each item is divided equally among the people who had it. `extra` is
 * everything on the bill that is not an item (tax, service charge, tip, minus any discount). It is
 * shared in proportion to what each person's items came to. The result always sums to
 * `itemsSubtotal + extra`.
 */
export function itemisedSplit(items: BillItem[], extra: Paise = 0): { owed: Record<PersonId, Paise>; total: Paise } {
  if (items.length === 0) throw new SplitError('Add at least one item')
  if (!Number.isSafeInteger(extra)) throw new SplitError('Tax and charges must be a whole number of paise')

  const subtotals: Record<PersonId, Paise> = {}
  for (const item of items) {
    if (!Number.isSafeInteger(item.amount) || item.amount < 0) throw new SplitError(`“${item.name || 'Item'}” needs an amount of zero or more`)
    const who = [...new Set(item.members)]
    if (who.length === 0) throw new SplitError(`Choose who had “${item.name || 'an item'}”`)
    const parts = allocate(item.amount, Object.fromEntries(who.map((m) => [m, 1])))
    for (const [m, v] of Object.entries(parts)) subtotals[m] = (subtotals[m] ?? 0) + v
  }

  const itemsTotal = itemsSubtotal(items)
  const total = itemsTotal + extra
  if (total <= 0) throw new SplitError('The total must be more than zero')

  const owed: Record<PersonId, Paise> = { ...subtotals }
  if (extra !== 0) {
    if (itemsTotal === 0) throw new SplitError('Charges need at least one item with an amount')
    const weights = Object.fromEntries(Object.entries(subtotals).filter(([, v]) => v > 0))
    const shares = allocate(Math.abs(extra), weights)
    for (const [m, v] of Object.entries(shares)) owed[m] += extra > 0 ? v : -v
  }
  for (const [m, v] of Object.entries(owed)) if (v < 0) throw new SplitError(`The discount is more than ${m}'s items`)
  return { owed, total }
}
