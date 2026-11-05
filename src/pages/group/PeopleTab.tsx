import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { groupCsv } from '../../core/csv'
import { addMember, deleteGroup, removeMember, renameMember, rotateInviteCode, updateGroup } from '../../data/api'
import type { GroupView } from '../../data/ledger'
import type { Member } from '../../data/types'
import { appUrl } from '../../lib/supabase'
import { useRun, useToast } from '../../ui/toast'
import { Avatar, ConfirmSheet, copyText, Field, Sheet, todayISO } from '../../ui/ui'

function downloadCsv(view: GroupView) {
  const csv = groupCsv(
    view.members.map((m) => ({ id: m.id, name: m.display_name })),
    view.expenses.map((e) => ({
      date: e.expense_date, title: e.title, category: e.category, amount: e.amount_paise,
      payers: Object.fromEntries(e.expense_payers.map((p) => [p.member_id, p.paid_paise])),
      owed: Object.fromEntries(e.expense_splits.map((s) => [s.member_id, s.owed_paise])),
    })),
    view.settlements.map((s) => ({ date: s.settled_on, from: s.from_member, to: s.to_member, amount: s.amount_paise })),
  )
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bhag-${view.group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group'}-${todayISO()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function PeopleTab({ view, userId }: { view: GroupView; userId: string }) {
  const run = useRun()
  const toast = useToast()
  const navigate = useNavigate()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<Member | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [groupName, setGroupName] = useState(view.group.name)
  const link = appUrl(`join/${view.group.invite_code}`)
  const isCreator = view.group.created_by === userId

  async function add(e: FormEvent) {
    e.preventDefault()
    if (await run(() => addMember(view.group.id, newName.trim()), 'Added')) setNewName('')
  }

  async function copy() {
    toast((await copyText(link)) ? 'Invite link copied' : 'Could not copy. Select the link and copy it by hand.', 'ok')
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <>
      <div className="section-title"><h2>People</h2></div>
      <ul className="card list">
        {view.members.map((m) => (
          <li key={m.id} className="row">
            <Avatar name={m.display_name} />
            <div className="grow title">{m.display_name}</div>
            {m.user_id === userId ? <span className="pill accent">you</span> : m.user_id ? <span className="pill">joined</span> : <span className="muted small">not joined yet</span>}
            {(m.user_id === null || m.user_id === userId) && (
              <button className="btn ghost sm" onClick={() => setEditing(m)}>Edit</button>
            )}
          </li>
        ))}
        <li>
          <form className="row" onSubmit={add}>
            <input className="input" placeholder="Add a friend by name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} aria-label="Friend's name" />
            <button className="btn sm" disabled={!newName.trim()}>Add</button>
          </form>
        </li>
      </ul>

      <div className="section-title"><h2>Invite link</h2></div>
      <div className="card card-pad stack">
        <p className="muted small">Anyone with this link can join the group after signing in. They can pick their name from friends you added, so their expenses carry over.</p>
        <div className="invite">{link}</div>
        <div className="actions">
          <button className="btn sm" onClick={copy}>Copy link</button>
          {canShare && <button className="btn sm" onClick={() => navigator.share({ title: `Join ${view.group.name} on Bhag`, url: link }).catch(() => {})}>Share</button>}
          <button className="btn ghost sm" onClick={() => run(() => rotateInviteCode(view.group.id), 'New link created. The old one no longer works.')}>Make a new link</button>
        </div>
      </div>

      <div className="section-title"><h2>Group settings</h2></div>
      <form
        className="card card-pad stack"
        onSubmit={(e) => { e.preventDefault(); void run(() => updateGroup(view.group.id, groupName.trim(), view.group.simplify_debts), 'Saved') }}
      >
        <Field label="Group name"><input className="input" value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={80} required /></Field>
        <label className="check">
          <input type="checkbox" checked={view.group.simplify_debts} onChange={(e) => run(() => updateGroup(view.group.id, groupName.trim() || view.group.name, e.target.checked))} />
          <span><strong>Simplify debts</strong><br /><span className="muted small">Combine IOUs so the group settles with the fewest payments. For example, if A owes B and B owes C, A pays C directly.</span></span>
        </label>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!groupName.trim() || groupName.trim() === view.group.name}>Save name</button>
      </form>

      <ul className="card list">
        <li><Link className="row" to={`/groups/${view.group.id}/recurring`}><div className="grow title">Repeating expenses</div><span className="muted">›</span></Link></li>
        <li><button className="row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => downloadCsv(view)}><div className="grow title">Export to spreadsheet (CSV)</div><span className="muted">›</span></button></li>
      </ul>

      {isCreator && (
        <button className="btn danger" onClick={() => setConfirmDelete(true)}>Delete group</button>
      )}

      {editing && <EditMember member={editing} view={view} onClose={() => setEditing(null)} />}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this group?" confirmLabel="Delete everything" danger onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if ((await run(() => deleteGroup(view.group.id), 'Group deleted')) !== undefined) navigate('/')
          }}
        >
          This permanently deletes “{view.group.name}”, every expense, payment, comment and receipt record in it, for everyone. This cannot be undone. You can export a CSV first.
        </ConfirmSheet>
      )}
    </>
  )
}

function EditMember({ member, view, onClose }: { member: Member; view: GroupView; onClose: () => void }) {
  const run = useRun()
  const [name, setName] = useState(member.display_name)
  const [confirm, setConfirm] = useState(false)
  const isMe = member.id === view.me?.id

  if (confirm) {
    return (
      <ConfirmSheet
        title={isMe ? 'Leave this group?' : `Remove ${member.display_name}?`} confirmLabel={isMe ? 'Leave group' : 'Remove'} danger onClose={onClose}
        onConfirm={async () => {
          if ((await run(() => removeMember(member.id), isMe ? 'You left the group' : 'Removed')) !== undefined) onClose()
        }}
      >
        {isMe ? 'You will no longer see this group. ' : ''}People with expenses or payments in the group cannot be removed until those are settled and deleted.
      </ConfirmSheet>
    )
  }
  return (
    <Sheet title="Edit person" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          if ((await run(() => renameMember(member.id, name.trim()), 'Saved')) !== undefined) onClose()
        }}
      >
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus /></Field>
        <div className="actions">
          <button className="btn primary" disabled={!name.trim()}>Save</button>
          <button type="button" className="btn danger" onClick={() => setConfirm(true)}>{isMe ? 'Leave group' : 'Remove'}</button>
        </div>
      </form>
    </Sheet>
  )
}
