import type { Paise } from './money'
import type { PersonId } from './types'

/** 123450 -> "1234.50". Plain decimals so spreadsheets read them as numbers. */
export function paiseToDecimal(p: Paise): string {
  const sign = p < 0 ? '-' : ''
  const abs = Math.abs(p)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Quote a cell for CSV. Text starting with = + - @ gets a leading ' so spreadsheets do not run it as a formula. */
export function csvCell(value: string): string {
  let v = value
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(v)
  if (!isPlainNumber && /^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export interface CsvMember {
  id: PersonId
  name: string
}
export interface CsvExpense {
  date: string
  title: string
  category: string
  amount: Paise
  payers: Record<PersonId, Paise>
  owed: Record<PersonId, Paise>
}
export interface CsvSettlement {
  date: string
  from: PersonId
  to: PersonId
  amount: Paise
}

/**
 * One row per expense or payment, one column per member showing that member's net for the row
 * (paid minus owed), and a final total row. Same layout as Splitwise exports.
 */
export function groupCsv(
  members: CsvMember[],
  expenses: CsvExpense[],
  settlements: CsvSettlement[],
): string {
  const header = ['Date', 'Description', 'Category', 'Cost (INR)', ...members.map((m) => m.name)]
  const totals: Record<PersonId, Paise> = Object.fromEntries(members.map((m) => [m.id, 0]))
  const rows: { date: string; cells: string[] }[] = []

  for (const e of expenses) {
    const cells = [e.date, e.title, e.category, paiseToDecimal(e.amount)]
    for (const m of members) {
      const net = (e.payers[m.id] ?? 0) - (e.owed[m.id] ?? 0)
      totals[m.id] += net
      cells.push(paiseToDecimal(net))
    }
    rows.push({ date: e.date, cells })
  }
  for (const s of settlements) {
    const cells = [s.date, 'Payment', 'Payment', paiseToDecimal(s.amount)]
    for (const m of members) {
      const net = m.id === s.from ? s.amount : m.id === s.to ? -s.amount : 0
      totals[m.id] += net
      cells.push(paiseToDecimal(net))
    }
    rows.push({ date: s.date, cells })
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const total = ['', 'Total balance', '', '', ...members.map((m) => paiseToDecimal(totals[m.id]))]
  return toCsv([header, ...rows.map((r) => r.cells), total])
}
