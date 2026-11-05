import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { keyProblem, parseLine, readUsers, tempPassword } from '../../scripts/bulk-add-users.mjs'

const SCRIPT = new URL('../../scripts/bulk-add-users.mjs', import.meta.url).pathname
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role })}.signature`
const SECRET = 'sb_secret_abcdefghijklmnop'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bhag-bulk-'))
})

const csv = (text: string) => {
  const f = join(dir, 'users.csv')
  writeFileSync(f, text)
  return f
}

describe('reading the file', () => {
  it('splits quoted values and keeps commas inside them', () => {
    expect(parseLine('a@x.com,"Ben, Jr",pw')).toEqual(['a@x.com', 'Ben, Jr', 'pw'])
    expect(parseLine('a@x.com,"Say ""hi""",')).toEqual(['a@x.com', 'Say "hi"', ''])
  })

  it('checks every row and says what is wrong with it', () => {
    const rows = readUsers(csv('﻿Email,Name,Password\nAsha@Example.com,Asha,\nbad-email,Bad,\nben@x.com,Ben,short\nasha@example.com,Again,\n,Blank,\n'))
    expect(rows.map((r) => [r.row, r.email, r.problem])).toEqual([
      [2, 'asha@example.com', null],
      [3, 'bad-email', 'not a valid email address'],
      [4, 'ben@x.com', 'password needs at least 8 characters'],
      [5, 'asha@example.com', 'listed more than once in the file'],
      [6, '', 'not a valid email address'],
    ])
  })

  it('works without a name or password column, using the part before @ as the name', () => {
    expect(readUsers(csv('email\nasha.rao@example.com\n'))[0]).toMatchObject({ email: 'asha.rao@example.com', name: 'asha.rao', password: '', problem: null })
  })

  it('generates readable passwords that are different every time', () => {
    const all = Array.from({ length: 200 }, tempPassword)
    for (const p of all) expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}$/)
    expect(new Set(all).size).toBe(200)
  })
})

describe('refusing the wrong key', () => {
  it('accepts the two admin key kinds', () => {
    expect(keyProblem(SECRET)).toBeNull()
    expect(keyProblem(jwt('service_role'))).toBeNull()
  })
  it('refuses publishable, anon and nonsense keys', () => {
    expect(keyProblem('sb_publishable_FDYFafZ1nE0um71w')).toMatch(/not an admin key/)
    expect(keyProblem(jwt('anon'))).toMatch(/not an admin key/)
    expect(keyProblem('hello')).toMatch(/not an admin key/)
    expect(keyProblem('a.b.c')).toMatch(/not an admin key/)
  })
})

describe('running the command', () => {
  const run = (args: string[], env: Record<string, string>, input = '') =>
    spawnSync('node', [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, input, encoding: 'utf8' })

  it('a dry run checks the file and sends nothing', () => {
    const r = run([csv('email,name\na@x.com,A\nbad,B\n'), '--dry-run'], { SUPABASE_URL: 'http://127.0.0.1:1' })
    expect(r.stdout).toContain('1 ready, 1 with a problem')
    expect(r.stdout).toContain('Dry run: nothing was sent')
    expect(r.status).toBe(1) // there was a problem to fix
  })

  it('stops before sending anything when given a public key', () => {
    const r = run([csv('email\na@x.com\n'), '--yes'], { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ADMIN_KEY: 'sb_publishable_xyz' })
    expect(r.stderr).toContain('not an admin key')
    expect(r.status).toBe(1)
  })

  it('does nothing unless you type yes', () => {
    const r = run([csv('email\na@x.com\n')], { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ADMIN_KEY: SECRET }, 'no\n')
    expect(r.stderr).toContain('Nothing was created')
    expect(r.status).toBe(1)
  })

  describe('against a stand-in for Supabase', () => {
    let server: Server
    let url: string
    let calls: { url?: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[]
    const known = new Set<string>(['taken@example.com'])

    beforeEach(async () => {
      calls = []
      server = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          const body = JSON.parse(raw || '{}')
          calls.push({ url: req.url, headers: req.headers, body })
          res.setHeader('content-type', 'application/json')
          if (known.has(body.email)) {
            res.statusCode = 422
            return res.end('{"msg":"A user with this email address has already been registered"}')
          }
          res.end(JSON.stringify({ id: 'u1', email: body.email }))
        })
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })
    afterEach(() => new Promise<void>((r) => server.close(() => r())))

    const exec = (file: string, key: string) =>
      new Promise<{ code: number; stdout: string }>((resolve) => {
        execFile('node', [SCRIPT, file, '--yes'], { env: { PATH: process.env.PATH ?? '', SUPABASE_URL: url, SUPABASE_ADMIN_KEY: key } }, (err, stdout) =>
          resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout }),
        )
      })

    it('creates confirmed accounts, saves private results, and reports failures', async () => {
      const file = csv('email,name,password\nasha@example.com,Asha Rao,\nben@example.com,"Ben, Jr",My-Own-Pass-77\ntaken@example.com,Taken,\nbad,Bad,\n')
      const { code, stdout } = await exec(file, SECRET)

      expect(stdout).toContain('created  asha@example.com')
      expect(stdout).toContain('FAILED   taken@example.com')
      expect(stdout).toContain('Done: 2 created, 2 not created.')
      expect(code).toBe(1) // something was not created

      // What was sent
      expect(calls.map((c) => c.url)).toEqual(['/auth/v1/admin/users', '/auth/v1/admin/users', '/auth/v1/admin/users'])
      const asha = calls[0]
      expect(asha.body).toMatchObject({ email: 'asha@example.com', email_confirm: true, user_metadata: { full_name: 'Asha Rao' } })
      expect(String(asha.body.password)).toMatch(/^.{4}-.{4}-.{4}$/) // generated
      expect(calls[1].body).toMatchObject({ email: 'ben@example.com', password: 'My-Own-Pass-77', user_metadata: { full_name: 'Ben, Jr' } })
      // New-style secret keys go only in the apikey header
      expect(asha.headers.apikey).toBe(SECRET)
      expect(asha.headers.authorization).toBeUndefined()

      // What was saved
      const results = join(dir, 'users-results.csv')
      expect(statSync(results).mode & 0o777).toBe(0o600)
      const lines = readFileSync(results, 'utf8').trim().split('\n')
      expect(lines[0]).toBe('email,name,status,temporary_password')
      expect(lines.find((l) => l.startsWith('asha@'))).toContain(String(asha.body.password))
      expect(lines.find((l) => l.startsWith('ben@'))).toContain('My-Own-Pass-77')
      expect(lines.find((l) => l.startsWith('taken@'))).toMatch(/FAILED.*already been registered,$/) // no password for a failure
      expect(lines.find((l) => l.startsWith('bad,'))).toContain('skipped: not a valid email address')
      // The key is never written anywhere
      expect(readFileSync(results, 'utf8')).not.toContain(SECRET)
      expect(stdout).not.toContain(SECRET)
    })

    it('legacy service_role keys go in both headers', async () => {
      const key = jwt('service_role')
      const { code } = await exec(csv('email\nlegacy@example.com\n'), key)
      expect(code).toBe(0)
      expect(calls[0].headers.apikey).toBe(key)
      expect(calls[0].headers.authorization).toBe(`Bearer ${key}`)
    })
  })
})
