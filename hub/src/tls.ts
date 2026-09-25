import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type TlsPair = { key: string; cert: string }

/**
 * Creates a long-lived self-signed certificate in `dir` on first use and reuses it afterwards.
 * The console is LAN-only; the certificate exists so browsers treat the origin as secure and allow the microphone.
 */
export function ensureSelfSignedCert(dir: string, hosts: string[]): TlsPair {
  const certPath = join(dir, 'cert.pem')
  const keyPath = join(dir, 'key.pem')
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    const names = new Set(['localhost', 'kitt', ...hosts])
    const san = [...names].map((h) => (/^[\d.]+$|:/.test(h) ? `IP:${h}` : `DNS:${h}`)).concat('IP:127.0.0.1').join(',')
    const result = Bun.spawnSync([
      'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
      '-keyout', keyPath, '-out', certPath, '-subj', '/CN=KITT console', '-addext', `subjectAltName=${san}`,
    ])
    if (result.exitCode !== 0) throw new Error(`openssl failed: ${result.stderr.toString()}`)
  }
  return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') }
}
