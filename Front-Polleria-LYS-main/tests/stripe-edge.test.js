import { afterAll, beforeAll, expect, test } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { createPaymentHandler } from '../../insforge/functions/pago-tarjeta.mjs'
import { createLocalDatabase } from '../scripts/local-db.mjs'
import { asPaymentServer, customer } from './fixtures/card-checkout.js'

const app = 'https://polleria.test'
const backend = 'https://insforge.test'
const webhookSecret = 'whsec_mock'
const config = {
  INSFORGE_BASE_URL: backend, INSFORGE_API_KEY: 'fake-server-credential',
  STRIPE_CHECKOUT_APP_URL: app, STRIPE_MODE: 'test',
  STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_WEBHOOK_SECRET: webhookSecret,
}
const rpcs = {
  preparar_pago_tarjeta: ['p_id', 'p_usuario', 'p_solicitud'],
  vincular_sesion_tarjeta: ['p_id', 'p_usuario', 'p_sesion'],
  leer_pago_tarjeta: ['p_id', 'p_usuario', 'p_sesion'],
  confirmar_pago_tarjeta: ['p_sesion', 'p_intento_stripe', 'p_centimos'],
  registrar_reembolso_tarjeta: ['p_sesion'],
}
let db
beforeAll(async () => { db = await createLocalDatabase() }, 60000)
afterAll(async () => { await db?.close() })

function createFixture() {
  const attemptId = randomUUID()
  const sessionId = `cs_test_${attemptId.replaceAll('-', '')}`
  const intent = `pi_${attemptId.replaceAll('-', '')}`
  const wrongUser = randomUUID()
  const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`
  const calls = []
  const refundRows = []
  const session = {
    id: sessionId, livemode: false, mode: 'payment', client_reference_id: attemptId, currency: 'pen',
    status: 'open', payment_status: 'unpaid', payment_intent: null, url: checkoutUrl,
  }
  const start = {
    action: 'start', id: attemptId, amount: 1, tipo: 'delivery',
    articulos: [{ id: 1, qty: 1, price: 0 }],
    entrega: { name: 'Cliente de prueba', phone: '999999999', address: 'Av. Prueba 123' },
  }

  const handler = createPaymentHandler({ env: key => config[key], request: async (input, options) => {
    const url = new URL(input)
    const path = url.pathname
    calls.push({ path, options })
    if (url.origin === backend && path === '/api/auth/sessions/current') {
      const token = options.headers.Authorization
      if (token === 'Bearer customer-stub') return Response.json({ user: { id: customer.id } })
      if (token === 'Bearer other-stub') return Response.json({ user: { id: wrongUser } })
      return Response.json({}, { status: 401 })
    }
    if (url.origin === backend && path.startsWith('/api/database/rpc/')) {
      expect(options.headers.Authorization).toBe('Bearer fake-server-credential')
      const name = path.split('/').at(-1)
      const params = JSON.parse(options.body)
      const keys = rpcs[name]
      try {
        const { rows } = await asPaymentServer(db, `SELECT public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')}) AS value`,
          keys.map(key => params[key]))
        return Response.json(rows[0].value ?? null)
      } catch (error) {
        return Response.json({ code: error.code }, { status: error.code === '42501' ? 403 : 400 })
      }
    }
    if (url.origin !== 'https://api.stripe.com') throw new Error('Proveedor inesperado')
    expect(options.headers.Authorization).toBe('Bearer sk_test_mock')
    if (path === '/v1/checkout/sessions') {
      session.amount_total = Number(options.body.get('line_items[0][price_data][unit_amount]'))
      return Response.json(session)
    }
    if (path === '/v1/refunds') {
      if (options.method === 'GET') return Response.json({ data: refundRows })
      expect(options.headers['Idempotency-Key']).toBe(`lys-refund-${attemptId}`)
      const refund = { status: 'succeeded', amount: session.amount_total, metadata: { pedido: attemptId } }
      refundRows.push(refund)
      return Response.json(refund)
    }
    if (path === `/v1/checkout/sessions/${sessionId}`) return Response.json(session)
    throw new Error('Ruta inesperada')
  } })

  const send = (body, token = 'customer-stub') => handler(new Request(backend + '/functions/pago-tarjeta', {
    method: 'POST', headers: { Origin: app, Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  }))
  function webhook({ valid = true, secondsAgo = 0 } = {}) {
    const raw = JSON.stringify({ type: 'checkout.session.completed', livemode: false, data: { object: { id: sessionId } } })
    const timestamp = Math.floor(Date.now() / 1000) - secondsAgo
    const digest = createHmac('sha256', valid ? webhookSecret : 'invalid').update(`${timestamp}.${raw}`).digest('hex')
    return handler(new Request(backend + '/functions/pago-tarjeta', {
      method: 'POST', headers: { 'Stripe-Signature': `t=${timestamp},v1=${digest}` }, body: raw,
    }))
  }
  const status = { action: 'status', id: attemptId }
  return { start, send, status, webhook, session, calls, refundRows, attemptId, intent, checkoutUrl }
}

test('crea Stripe Checkout con el importe de InsForge y confirma una sola vez al retornar o por webhook', async () => {
  const f = createFixture()
  const response = await f.send(f.start)
  expect(response.status).toBe(200)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(app)
  expect(await response.json()).toEqual({ status: 'open', url: f.checkoutUrl })
  const creation = f.calls.find(call => call.path === '/v1/checkout/sessions')
  expect(creation.options.headers['Idempotency-Key']).toBe(`lys-checkout-${f.attemptId}`)
  expect(creation.options.body.get('success_url')).toBe(`${app}/checkout/resumen?pago_tarjeta=${f.attemptId}`)
  expect(f.session.amount_total).toBeGreaterThan(600)
  expect(creation.options.body.toString()).not.toContain('999999999')
  expect(await (await f.send(f.start)).json()).toEqual({ status: 'open', url: f.checkoutUrl })
  expect(f.calls.filter(call => call.path === '/v1/checkout/sessions')).toHaveLength(1)

  expect((await f.send(f.status, 'other-stub')).status).toBe(404)
  expect(await (await f.send(f.status)).json()).toEqual({ status: 'open' })
  f.session.status = 'complete'
  expect(await (await f.send(f.status)).json()).toEqual({ status: 'processing' })
  Object.assign(f.session, { payment_status: 'paid', payment_intent: f.intent })
  expect((await f.webhook({ valid: false })).status).toBe(400)
  expect((await f.webhook({ secondsAgo: 360 })).status).toBe(400)
  expect((await db.query('SELECT id FROM public.pedidos WHERE id=$1', [f.attemptId])).rows).toHaveLength(0)

  const results = await Promise.all([f.webhook(), f.send(f.status)])
  expect(results.map(result => result.status)).toEqual([200, 200])
  expect(await results[1].json()).toEqual({ status: 'confirmed', orderId: f.attemptId })
  expect((await db.query('SELECT id FROM public.pagos WHERE pedido_id=$1', [f.attemptId])).rows).toHaveLength(1)
})

test('rechaza la sesión anónima y el importe alterado antes de guardar pagos', async () => {
  const f = createFixture()
  expect((await f.send(f.start, 'invalid')).status).toBe(401)
  expect(f.calls).toHaveLength(1)
  expect((await f.send(f.start)).status).toBe(200)
  Object.assign(f.session, { status: 'complete', payment_status: 'paid', payment_intent: f.intent, amount_total: 1 })
  expect((await f.webhook()).status).toBe(502)
  expect((await db.query('SELECT id FROM public.pagos WHERE pedido_id=$1', [f.attemptId])).rows).toHaveLength(0)
})

test('reembolsa una vez si el pedido ya no puede confirmarse', async () => {
  const f = createFixture()
  expect((await f.send(f.start)).status).toBe(200)
  Object.assign(f.session, { status: 'complete', payment_status: 'paid', payment_intent: f.intent })
  await db.exec('UPDATE public.productos SET precio=precio+1 WHERE id=1')
  try {
    expect((await f.webhook()).status).toBe(200)
    expect((await f.webhook()).status).toBe(200)
    expect(await (await f.send(f.status)).json()).toEqual({ status: 'refunded', orderId: null })
    expect(f.refundRows).toHaveLength(1)
    expect((await db.query('SELECT id FROM public.pedidos WHERE id=$1', [f.attemptId])).rows).toHaveLength(0)
  } finally {
    await db.exec('UPDATE public.productos SET precio=precio-1 WHERE id=1')
  }
})
