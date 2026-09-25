import { test, expect } from 'bun:test'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureSelfSignedCert } from '../src/tls'

test('generates a self-signed certificate once, with the given hosts as subject alt names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kitt-tls-'))
  const first = ensureSelfSignedCert(dir, ['192.168.23.20', 'kitt.local'])
  expect(existsSync(join(dir, 'cert.pem'))).toBe(true)
  expect(existsSync(join(dir, 'key.pem'))).toBe(true)
  expect(first.cert).toContain('BEGIN CERTIFICATE')
  expect(first.key).toMatch(/BEGIN (RSA |EC )?PRIVATE KEY/)
  const dump = Bun.spawnSync(['openssl', 'x509', '-in', join(dir, 'cert.pem'), '-noout', '-text']).stdout.toString()
  expect(dump).toContain('IP Address:192.168.23.20')
  expect(dump).toContain('DNS:kitt.local')
  expect(dump).toContain('DNS:localhost')
  const second = ensureSelfSignedCert(dir, ['10.0.0.1'])
  expect(second.cert).toBe(readFileSync(join(dir, 'cert.pem'), 'utf8'))
  expect(second.cert).toBe(first.cert)
})
