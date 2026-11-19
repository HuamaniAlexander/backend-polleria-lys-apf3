import { expect, test } from 'vitest'
import { getConfigurationError, INSFORGE_PROJECT, isPublicInsforgeKey } from '../src/lib/insforgeConfig'

const publicKey = `anon_${'a'.repeat(64)}`
const fakeJwt = role => `header.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.signature`

test('acepta la URL del proyecto FIX-DB-LYS-NOV con su clave pública', () => {
  expect(getConfigurationError(INSFORGE_PROJECT.baseUrl, publicKey)).toBeNull()
  expect(getConfigurationError(`${INSFORGE_PROJECT.baseUrl}/`, publicKey)).toBeNull()
})

test('rechaza la configuración anterior y otras URLs', () => {
  for (const url of ['https://mpy5z5dn.us-east.insforge.app', 'https://b9zz47j5.us-east.insforge.app', 'https://otro.us-east.insforge.app', 'no-es-url', `${INSFORGE_PROJECT.baseUrl}/api`]) {
    expect(getConfigurationError(url, publicKey)).toContain(INSFORGE_PROJECT.name)
  }
})

test('no permite claves administrativas, placeholders ni variables ausentes', () => {
  for (const key of ['', undefined, 'ik_example-private-key', 'replace_with_public_anon_key']) {
    expect(getConfigurationError(INSFORGE_PROJECT.baseUrl, key)).toContain('clave pública')
  }
  expect(getConfigurationError(undefined, publicKey)).not.toBeNull()
})
test('el backend local solo se admite con habilitación explícita y clave pública ficticia', () => {
  expect(getConfigurationError('http://127.0.0.1:5191', 'local-public-anon')).not.toBeNull()
  expect(getConfigurationError('http://127.0.0.1:5191', 'local-public-anon', { localPreview: true })).toBeNull()
  expect(getConfigurationError('http://127.0.0.1:5191', 'ik_private', { localPreview: true })).not.toBeNull()
  expect(getConfigurationError('http://127.0.0.1:5192', 'local-public-anon', { localPreview: true })).not.toBeNull()
})

test('acepta claves públicas opacas y JWT anónimos, y rechaza JWT de usuarios o administradores', () => {
  expect(isPublicInsforgeKey(publicKey)).toBe(true)
  expect(isPublicInsforgeKey(fakeJwt('anon'))).toBe(true)
  expect(isPublicInsforgeKey(fakeJwt('authenticated'))).toBe(false)
  expect(isPublicInsforgeKey(fakeJwt('project_admin'))).toBe(false)
  expect(isPublicInsforgeKey('header.invalid.signature')).toBe(false)
})
