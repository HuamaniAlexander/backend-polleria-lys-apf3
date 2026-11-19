// Solo se importa desde scripts de operación. Las credenciales permanecen en el servidor.
export function getInsforgeAdminConfig() {
  const { INSFORGE_BASE_URL: value, INSFORGE_API_KEY: apiKey } = process.env
  if (!value || !apiKey) {
    throw new Error('Define INSFORGE_BASE_URL e INSFORGE_API_KEY en el entorno del servidor.')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('INSFORGE_BASE_URL debe ser un origen HTTPS válido.')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('INSFORGE_BASE_URL debe ser un origen HTTPS válido o apuntar a la máquina local.')
  }

  return {
    baseUrl: url.origin,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  }
}
