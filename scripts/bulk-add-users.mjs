#!/usr/bin/env node
/**
 * Create many Bhag accounts at once. They are created already confirmed, so people can sign in
 * straight away on the Password tab. No emails are sent.
 *
 *   node scripts/bulk-add-users.mjs users.csv            (asks for your admin key, hidden)
 *   node scripts/bulk-add-users.mjs users.csv --dry-run  (checks the file, changes nothing)
 *
 * users.csv needs a header row. The password column is optional: leave it blank and a strong
 * temporary password is generated. Values with commas can be put in "double quotes".
 *
 *   email,name,password
 *   asha@example.com,Asha Rao,
 *   ben@example.com,"Ben, Jr",My-Own-Pass-77
 *
 * Results (including any generated passwords) are saved next to the input as <name>-results.csv,
 * readable only by you. Hand those passwords out privately and ask people to change them in
 * Account -> Password. Do not commit that file.
 *
 * The admin key is a full-access secret. It is read from the SUPABASE_ADMIN_KEY environment
 * variable or typed at a hidden prompt, never stored, and sent only to your Supabase project.
 * Set SUPABASE_URL to use a different project.
 */
import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const DEFAULT_URL = 'https://jnefiazbuhavmfvknked.supabase.co'
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const file = args.find((a) => !a.startsWith('--'))
const dryRun = flags.has('--dry-run')
const assumeYes = flags.has('--yes')

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// ---------- reading the CSV ----------

/** Split one CSV line, honouring "quoted, values" and "" as an escaped quote. */
export function parseLine(line) {
  const cells = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { cells.push(cur.trim()); cur = '' }
    else cur += c
  }
  cells.push(cur.trim())
  return cells
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0 O 1 l I
export function tempPassword() {
  const chunk = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `${chunk()}-${chunk()}-${chunk()}`
}

export function readUsers(path) {
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) fail('The file needs a header row (email,name,password) and at least one person.')
  const header = parseLine(lines[0]).map((h) => h.toLowerCase())
  const col = (name) => header.indexOf(name)
  if (col('email') < 0) fail('The first row must have an "email" column, for example: email,name,password')
  const seen = new Set()
  return lines.slice(1).map((line, i) => {
    const cells = parseLine(line)
    const email = (cells[col('email')] ?? '').toLowerCase()
    const name = col('name') >= 0 ? cells[col('name')] ?? '' : ''
    const password = col('password') >= 0 ? cells[col('password')] ?? '' : ''
    let problem = null
    if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email)) problem = 'not a valid email address'
    else if (seen.has(email)) problem = 'listed more than once in the file'
    else if (password && password.length < 8) problem = 'password needs at least 8 characters'
    seen.add(email)
    return { row: i + 2, email, name: name || email.split('@')[0], password, problem }
  })
}

/** Why this is not an admin key, or null if it looks right. Never prints the key. */
export function keyProblem(key) {
  const wrong = 'That is not an admin key. Use the "secret" key (sb_secret_…) or the legacy "service_role" key from Project Settings -> API Keys. The publishable and anon keys cannot create users.'
  if (key.startsWith('sb_secret_')) return null
  if (key.startsWith('sb_publishable_')) return wrong
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role
      return role === 'service_role' ? null : wrong
    } catch {
      return wrong
    }
  }
  return wrong
}

// ---------- asking for the key without showing it ----------

function askHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      createInterface({ input: process.stdin }).once('line', (l) => resolve(l.trim()))
      return
    }
    process.stdout.write(question)
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = () => {} // hide what is typed
    rl.question('', (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

function askLine(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (a) => { rl.close(); resolve(a.trim()) })
  })
}

// ---------- main ----------

async function main() {
  if (!file) fail('Usage: node scripts/bulk-add-users.mjs users.csv [--dry-run]')
  const url = (process.env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, '')
  const users = readUsers(file)
  const bad = users.filter((u) => u.problem)
  const good = users.filter((u) => !u.problem)

  console.log(`\nProject: ${url}`)
  console.log(`${users.length} row(s): ${good.length} ready, ${bad.length} with a problem`)
  for (const u of bad) console.log(`  row ${u.row}  ${u.email || '(blank)'}: ${u.problem}`)
  if (dryRun) {
    console.log('\nDry run: nothing was sent. Fix any problems above, then run again without --dry-run.\n')
    process.exit(bad.length ? 1 : 0)
  }
  if (good.length === 0) fail('There is nobody to create.')

  const key = process.env.SUPABASE_ADMIN_KEY || (await askHidden('Paste your Supabase secret key (typing is hidden), then press Enter: '))
  if (!key) fail('No key given.')
  const keyIssue = keyProblem(key)
  if (keyIssue) fail(keyIssue)
  // New sb_secret_ keys go only in the apikey header. Older service_role keys are JWTs and go in both.
  const headers = { apikey: key, 'Content-Type': 'application/json' }
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`

  if (!assumeYes) {
    const answer = await askLine(`\nCreate ${good.length} account(s) on ${url}? Type yes to continue: `)
    if (answer.toLowerCase() !== 'yes') fail('Stopped. Nothing was created.')
  }

  const results = []
  for (const u of bad) results.push({ email: u.email, name: u.name, status: `skipped: ${u.problem}`, password: '' })
  for (const u of good) {
    const password = u.password || tempPassword()
    let status
    try {
      const res = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.name } }),
      })
      const body = await res.json().catch(() => ({}))
      status = res.ok ? 'created' : `FAILED: ${body.msg || body.message || body.error_description || `HTTP ${res.status}`}`
    } catch (e) {
      status = `FAILED: could not reach Supabase (${e instanceof Error ? e.message : e})`
    }
    console.log(`${status === 'created' ? 'created ' : 'FAILED  '} ${u.email}${status === 'created' ? '' : `  ${status}`}`)
    results.push({ email: u.email, name: u.name, status, password: status === 'created' ? password : '' })
  }

  const out = join(dirname(file), `${basename(file, extname(file))}-results.csv`)
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  writeFileSync(out, ['email,name,status,temporary_password', ...results.map((r) => [r.email, r.name, r.status, r.password].map(q).join(','))].join('\n') + '\n', { mode: 0o600 })

  const made = results.filter((r) => r.status === 'created').length
  console.log(`\nDone: ${made} created, ${results.length - made} not created.`)
  console.log(`Results and temporary passwords: ${out}  (private to you, keep it out of git)`)
  console.log('People sign in on the Password tab, then change the password in Account -> Password.\n')
  process.exit(made === results.length ? 0 : 1)
}

// Only run when called from the command line, so the tests can import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
