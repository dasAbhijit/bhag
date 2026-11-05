// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGroupView } from '../data/ledger'
import type { AllData, ExpensePayload } from '../data/types'

const ME = 'user-me'
const m = (id: string, name: string, user: string | null) => ({ id, group_id: 'g1', user_id: user, display_name: name, created_at: `2026-01-0${id.length}` })
const members = [m('a', 'Asha', 'user-asha'), m('me', 'Meera', ME), m('dev', 'Dev', null)]
const data: AllData = {
  groups: [{ id: 'g1', name: 'Goa trip', currency: 'INR', is_direct: false, simplify_debts: true, invite_code: 'x', created_by: ME, created_at: '', group_members: members }],
  expenses: [], settlements: [], recurring: [],
}
const view = buildGroupView(data.groups[0], data, ME)

const api = vi.hoisted(() => ({
  saveExpense: vi.fn(async (_p: unknown) => 'new-expense-id'),
  saveRecurring: vi.fn(async (_p: unknown) => 'new-recurring-id'),
  uploadReceipt: vi.fn(async () => {}),
}))
const scan = vi.hoisted(() => ({
  loadScanSettings: vi.fn((): { apiKey: string; model: string } | null => ({ apiKey: 'k', model: 'm' })),
  scanReceipt: vi.fn(),
}))
vi.mock('../data/api', () => api)
vi.mock('../lib/scan', () => scan)
vi.mock('../lib/image', () => ({ prepareReceipt: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), ext: 'jpg' })) }))
vi.mock('../data/hooks', () => ({ useLedger: () => ({ views: [view], isLoading: false, error: null, userId: ME, friends: [], data }) }))

import ExpenseForm from './ExpenseForm'

function renderForm() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/groups/g1/expense/new']}>
        <Routes>
          <Route path="/groups/:id/expense/new" element={<ExpenseForm />} />
          <Route path="/groups/:id" element={<div>group page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const lastPayload = () => api.saveExpense.mock.calls.at(-1)![0] as ExpensePayload
const save = () => screen.getByRole('button', { name: /^Save/ })

beforeEach(() => {
  vi.clearAllMocks()
  scan.loadScanSettings.mockReturnValue({ apiKey: 'k', model: 'm' })
})
afterEach(cleanup)

async function fillBasics(user: ReturnType<typeof userEvent.setup>, title = 'Dinner', amount = '300') {
  await user.type(screen.getByLabelText('Description'), title)
  await user.type(screen.getByLabelText('Amount (₹)'), amount)
}

describe('Add expense form', () => {
  it('starts disabled and saves an equal split paid by me', async () => {
    const user = userEvent.setup()
    renderForm()
    expect(save()).toBeDisabled()
    await fillBasics(user)
    expect(save()).toBeEnabled()
    await user.click(save())
    await waitFor(() => expect(api.saveExpense).toHaveBeenCalled())
    const p = lastPayload()
    expect(p.amount_paise).toBe(30000)
    expect(p.payers).toEqual([{ member_id: 'me', paid_paise: 30000 }]) // defaults to the signed-in person
    expect(p.splits).toEqual(expect.arrayContaining([
      { member_id: 'a', owed_paise: 10000 }, { member_id: 'me', owed_paise: 10000 }, { member_id: 'dev', owed_paise: 10000 },
    ]))
    expect(p.split_method).toBe('equal')
    await screen.findByText('group page')
  })

  it('equal split gives odd paise to the first person and excludes unchecked people', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillBasics(user, 'Taxi', '100')
    await user.click(screen.getByRole('checkbox', { name: 'Dev' }))
    await user.click(save())
    await waitFor(() => expect(api.saveExpense).toHaveBeenCalled())
    expect(lastPayload().splits).toEqual([{ member_id: 'a', owed_paise: 5000 }, { member_id: 'me', owed_paise: 5000 }])
  })

  it('percent split shows what is left and saves exact paise', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillBasics(user)
    await user.click(screen.getByRole('button', { name: '%' }))
    const a = screen.getByLabelText('Asha percent')
    const me = screen.getByLabelText('Meera percent')
    const dev = screen.getByLabelText('Dev percent')
    await user.clear(a); await user.type(a, '50')
    await user.clear(me); await user.type(me, '30')
    await user.clear(dev); await user.type(dev, '10')
    expect(screen.getByText('10% left to assign')).toBeInTheDocument()
    expect(save()).toBeDisabled()
    await user.clear(dev); await user.type(dev, '20')
    expect(screen.getByText('100% assigned ✓')).toBeInTheDocument()
    await user.click(save())
    await waitFor(() => expect(api.saveExpense).toHaveBeenCalled())
    const p = lastPayload()
    expect(p.split_method).toBe('percent')
    expect(p.splits).toEqual(expect.arrayContaining([
      { member_id: 'a', owed_paise: 15000 }, { member_id: 'me', owed_paise: 9000 }, { member_id: 'dev', owed_paise: 6000 },
    ]))
    expect(p.split_input).toEqual({ percents: { a: 50, me: 30, dev: 20 } })
  })

  it('exact split must add up to the total', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillBasics(user)
    await user.click(screen.getByRole('button', { name: 'Exact' }))
    const a = screen.getByLabelText('Asha amount')
    await user.clear(a); await user.type(a, '200')
    expect(screen.getByText(/left to assign|too much/)).toBeInTheDocument()
    expect(save()).toBeDisabled()
    expect(screen.getAllByText('Amounts must add up to the total').length).toBeGreaterThan(0)
  })

  it('shares split 2:1:1', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillBasics(user, 'Groceries', '400')
    await user.click(screen.getByRole('button', { name: 'Shares' }))
    const a = screen.getByLabelText('Asha shares')
    await user.clear(a); await user.type(a, '2')
    await user.click(save())
    await waitFor(() => expect(api.saveExpense).toHaveBeenCalled())
    expect(lastPayload().splits).toEqual(expect.arrayContaining([
      { member_id: 'a', owed_paise: 20000 }, { member_id: 'me', owed_paise: 10000 }, { member_id: 'dev', owed_paise: 10000 },
    ]))
  })

  it('several people paid: must add up, then saves both payers', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillBasics(user)
    await user.click(screen.getByRole('checkbox', { name: 'Several people paid' }))
    // Turning this on pre-fills the current payer (me) with the whole amount.
    const mine = screen.getByLabelText('Meera paid') as HTMLInputElement
    expect(mine.value).toBe('300.00')
    await user.clear(mine)
    await user.type(mine, '100')
    expect(screen.getByText(/₹200.00 still to assign/)).toBeInTheDocument()
    expect(save()).toBeDisabled()
    await user.type(screen.getByLabelText('Asha paid'), '200')
    expect(screen.getByText('Fully covered ✓')).toBeInTheDocument()
    await user.click(save())
    await waitFor(() => expect(api.saveExpense).toHaveBeenCalled())
    expect(lastPayload().payers).toEqual(expect.arrayContaining([{ member_id: 'a', paid_paise: 20000 }, { member_id: 'me', paid_paise: 10000 }]))
    expect(lastPayload().payers).toHaveLength(2)
  })

  it('repeat creates a schedule instead of a single expense', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillBasics(user, 'Rent', '36000')
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly')
    await user.click(save())
    await waitFor(() => expect(api.saveRecurring).toHaveBeenCalled())
    expect(api.saveExpense).not.toHaveBeenCalled()
    const p = api.saveRecurring.mock.calls[0][0] as { frequency: string; amount_paise: number; end_date: string | null; id?: string }
    expect(p.frequency).toBe('monthly')
    expect(p.amount_paise).toBe(3600000)
    expect(p.end_date).toBeNull()
    expect(p.id).toBeUndefined()
  })

  it('rejects bad amounts', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Description'), 'x')
    await user.type(screen.getByLabelText('Amount (₹)'), '12.345')
    expect(save()).toBeDisabled()
    expect(within(document.body).getByText('Enter the amount in rupees')).toBeInTheDocument()
  })
})

describe('Itemised split and invoice scanning', () => {
  const scanned = {
    merchant: 'Cafe Mocha', date: '2026-11-02', category: 'food', currency: 'INR',
    items: [{ name: 'Masala Dosa', amount_paise: 24000 }, { name: 'Lassi', amount_paise: 9000 }],
    total_paise: 36300, extra_paise: 3300, warnings: [] as string[],
  }
  const scanInput = () => document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement
  const photo = () => new File(['img'], 'bill.jpg', { type: 'image/jpeg' })

  it('splits items among the people who had them, with charges in proportion', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Description'), 'Cafe')
    await user.click(screen.getByRole('button', { name: 'Items' }))
    await user.type(screen.getByLabelText('Item 1 name'), 'Dosa')
    await user.type(screen.getByLabelText('Item 1 amount'), '240')
    const who = within(screen.getByRole('group', { name: 'Who had item 1' }))
    await user.click(who.getByRole('button', { name: 'Asha' }))  // everyone starts selected
    await user.click(who.getByRole('button', { name: 'Dev' }))
    await user.click(screen.getByRole('button', { name: '+ Add item' }))
    await user.type(screen.getByLabelText('Item 2 name'), 'Lassi')
    await user.type(screen.getByLabelText('Item 2 amount'), '90')
    await user.type(screen.getByLabelText(/^Tax, service charge and tip/), '33')
    expect((screen.getByLabelText(/^Amount \(₹\)/) as HTMLInputElement).value).toBe('363.00')
    await user.click(save())
    await waitFor(() => expect(api.saveExpense).toHaveBeenCalled())
    const p = lastPayload()
    expect(p.split_method).toBe('items')
    expect(p.amount_paise).toBe(36300)
    // Meera: 240 + 30 of items, 27 of the 33 charge. Asha and Dev: 30 + 3 each.
    expect(p.splits).toEqual(expect.arrayContaining([
      { member_id: 'me', owed_paise: 29700 }, { member_id: 'a', owed_paise: 3300 }, { member_id: 'dev', owed_paise: 3300 },
    ]))
    expect(p.payers).toEqual([{ member_id: 'me', paid_paise: 36300 }])
    const saved = p.split_input as { items: { name: string; members: string[] }[]; extra_paise: number }
    expect(saved.extra_paise).toBe(3300)
    expect(saved.items[0]).toMatchObject({ name: 'Dosa', members: ['me'] })
  })

  it('needs someone on every item', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Description'), 'Cafe')
    await user.click(screen.getByRole('button', { name: 'Items' }))
    await user.type(screen.getByLabelText('Item 1 name'), 'Tea')
    await user.type(screen.getByLabelText('Item 1 amount'), '50')
    await user.click(within(screen.getByRole('group', { name: 'Who had item 1' })).getByRole('button', { name: 'None' }))
    expect(save()).toBeDisabled()
    expect(screen.getAllByText('Choose who had “Tea”').length).toBeGreaterThan(0)
  })

  it('scanning fills the whole form, keeps it editable, and attaches the photo', async () => {
    scan.scanReceipt.mockResolvedValue(scanned)
    const user = userEvent.setup()
    renderForm()
    await user.upload(scanInput(), photo())
    expect(await screen.findByText(/Read from your invoice/)).toBeInTheDocument()
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Cafe Mocha')
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-11-02')
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('food')
    expect((screen.getByLabelText('Item 1 name') as HTMLInputElement).value).toBe('Masala Dosa')
    expect((screen.getByLabelText('Item 2 amount') as HTMLInputElement).value).toBe('90.00')
    expect((screen.getByLabelText(/^Amount \(₹\)/) as HTMLInputElement).value).toBe('363.00')
    // Fix a misread price: the total follows.
    const dosa = screen.getByLabelText('Item 1 amount')
    await user.clear(dosa)
    await user.type(dosa, '200')
    expect((screen.getByLabelText(/^Amount \(₹\)/) as HTMLInputElement).value).toBe('323.00')
    await user.click(save())
    await waitFor(() => expect(api.saveExpense).toHaveBeenCalled())
    expect(lastPayload()).toMatchObject({ title: 'Cafe Mocha', amount_paise: 32300, expense_date: '2026-11-02', category: 'food', split_method: 'items' })
    await waitFor(() => expect(api.uploadReceipt).toHaveBeenCalledTimes(1))
    expect(scan.scanReceipt).toHaveBeenCalledTimes(1)
  })

  it('shows what went wrong when the scan fails, and leaves the form alone', async () => {
    scan.scanReceipt.mockRejectedValue(new Error('Google did not accept that API key. Check it in Account.'))
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Description'), 'Keep me')
    await user.upload(scanInput(), photo())
    expect(await screen.findByText(/did not accept that API key/)).toBeInTheDocument()
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Keep me')
  })

  it('passes along warnings from the invoice', async () => {
    scan.scanReceipt.mockResolvedValue({ ...scanned, warnings: ['The invoice says USD.'] })
    const user = userEvent.setup()
    renderForm()
    await user.upload(scanInput(), photo())
    expect(await screen.findByText('The invoice says USD.')).toBeInTheDocument()
  })

  it('asks for a key when none is saved', async () => {
    scan.loadScanSettings.mockReturnValue(null)
    renderForm()
    expect(document.querySelector('input[type=file][accept="image/*"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument()
  })
})

