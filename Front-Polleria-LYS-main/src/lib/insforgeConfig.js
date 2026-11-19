export const INSFORGE_PROJECT = {
  id: 'f3fe5475-d922-49e4-8d30-c0c61c118cfe',
  name: 'FIX-DB-LYS-NOV',
  baseUrl: 'https://8bwzqx2s.us-east.insforge.app',
}

export function isPublicInsforgeKey(key) {
  if (typeof key !== 'string') return false
  if (/^anon_[0-9a-f]{64}$/.test(key)) return true
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return false
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload))?.role === 'anon'
  } catch {
    return false
  }
}

export function getConfigurationError(baseUrl, anonKey, { localPreview = false } = {}) {
  if (localPreview && baseUrl === 'http://127.0.0.1:5191' && anonKey === 'local-public-anon') return null
  if (!baseUrl || !isPublicInsforgeKey(anonKey)) {
    return 'Configura VITE_INSFORGE_BASE_URL y VITE_INSFORGE_ANON_KEY en .env.local. Usa la clave pública, nunca la API key privada.'
  }
  if (baseUrl.replace(/\/$/, '') !== INSFORGE_PROJECT.baseUrl) {
    return `La URL de InsForge debe corresponder a ${INSFORGE_PROJECT.name}: ${INSFORGE_PROJECT.baseUrl}. Obtén también la clave pública de ese proyecto.`
  }
  return null
}
