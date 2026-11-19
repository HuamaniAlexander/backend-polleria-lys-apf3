import { cwd } from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { getConfigurationError } from './src/lib/insforgeConfig.js'

const publicVariables = ['VITE_INSFORGE_BASE_URL', 'VITE_INSFORGE_ANON_KEY', 'VITE_FLUJO_ATENCIONES', 'VITE_PAGO_TARJETA_HABILITADO']

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, cwd(), 'VITE_')
  if (env.VITE_INSFORGE_BASE_URL || env.VITE_INSFORGE_ANON_KEY) {
    const error = getConfigurationError(env.VITE_INSFORGE_BASE_URL, env.VITE_INSFORGE_ANON_KEY, {
      localPreview: command === 'serve' && mode === 'flujo-local',
    })
    if (error) throw new Error(error)
  }

  for (const name of ['VITE_FLUJO_ATENCIONES', 'VITE_PAGO_TARJETA_HABILITADO']) {
    env[name] = env[name] === 'true' ? 'true' : 'false'
  }
  return {
    plugins: [react()],
    envPrefix: [],
    define: Object.fromEntries(publicVariables.map(name => [
      `import.meta.env.${name}`, JSON.stringify(env[name] || ''),
    ])),
  }
})
