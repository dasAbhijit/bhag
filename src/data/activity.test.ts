import { describe, expect, it } from 'vitest'
import { describeActivity, diffExpense } from './activity'
import type { ActivityEntry, ExpenseSnapshot } from './types'

const names: Record<string, string> = { a: 'Asha', d: 'Dev' }
const nameOf = (id: string) => names[id] ?? 'Someone'
const snap = (over: Partial<ExpenseSnapshot> = {}): ExpenseSnapshot => ({
  title: 'Dinner', amount_paise: 100000, date: '2026-11-01', category: 'food', split_method: 'equal', note: null,
  payers: [{ member_id: 'a', paid_paise: 100000 }],
  splits: [{ member_id: 'a', owed_paise: 50000 }, { member_id: 'd', owed_paise: 50000 }], ...over,
})
const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1, group_id: 'g', actor_name: 'Dev', action: 'x', entity_type: 'expense', entity_id: 'e', summary: 'Dinner',
  before_json: null, after_json: null, created_at: '2026-11-01T00:00:00Z', ...over,
})

describe('activity', () => {
  it('lists only what changed', () => {
    expect(diffExpense(snap(), snap(), nameOf)).toEqual([])
    expect(diffExpense(snap(), snap({ title: 'Lunch', amount_paise: 120000, splits: [{ member_id: 'a', owed_paise: 120000 }] }), nameOf)).toEqual([
      'Name: Dinner → Lunch',
      'Amount: ₹1,000.00 → ₹1,200.00',
      'Split: Asha ₹500.00, Dev ₹500.00 → Asha ₹1,200.00',
    ])
  })
  it('describes edits, deletes and payments in plain words', () => {
    const edit = describeActivity(entry({ action: 'expense_edited', before_json: snap(), after_json: snap({ amount_paise: 90000 }) }), nameOf)
    expect(edit.text).toBe('edited “Dinner”')
    expect(edit.details[0]).toContain('₹1,000.00 → ₹900.00')
    expect(describeActivity(entry({ action: 'expense_deleted', before_json: snap() }), nameOf).details).toEqual(['₹1,000.00'])
    const pay = describeActivity(entry({ action: 'payment_added', summary: null, after_json: { from_member: 'd', to_member: 'a', amount_paise: 50000 } as never }), nameOf)
    expect(pay.text).toBe('recorded a payment: Dev paid Asha ₹500.00')
  })
  it('never crashes on unknown actions or missing data', () => {
    expect(describeActivity(entry({ action: 'something_new' }), nameOf).text).toBe('something new')
    expect(describeActivity(entry({ action: 'expense_edited' }), nameOf).details).toEqual(['No visible changes'])
  })
})
