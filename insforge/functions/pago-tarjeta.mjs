const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION = /^cs_(test|live)_[a-zA-Z0-9]+$/
const PAYMENT_INTENT = /^pi_[a-zA-Z0-9]+$/
const CHECKOUT_PATH = '/checkout/resumen'
const STRIPE_URL = 'https://api.stripe.com/v1/'
const STRIPE_API_VERSION = '2025-04-30.basil'
const MAX_BODY = 64 * 1024

class PaymentError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function paymentOrigin(value, allowLoopbackTest) {
  const url = new URL(value)
  const isLoopback = allowLoopbackTest && url.protocol === 'http:' && url.hostname === '127.0.0.1'
  if ((!isLoopback && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Origen de pagos inválido.')
  }
  return url.origin
}

async function readBody(request) {
  const reader = request.body?.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  if (!reader) return text
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    size += value.byteLength
    if (size > MAX_BODY) {
      await reader.cancel()
      throw new PaymentError(413, 'La solicitud es demasiado grande.')
    }
    text += decoder.decode(value, { stream: true })
  }
}

function parseBody(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    throw new PaymentError(400, 'La solicitud de pago no es válida.')
  }
}

function normalizeOrder(input) {
  const { tipo, articulos, entrega } = input
  if (!['delivery', 'recojo'].includes(tipo) || !Array.isArray(articulos) ||
      articulos.length < 1 || articulos.length > 100 || !entrega || typeof entrega !== 'object') {
    throw new PaymentError(400, 'Revisa los datos de tu pedido.')
  }
  const items = articulos.map((item) => {
    const id = String(item?.id)
    const qty = item?.qty
    if (!/^[1-9][0-9]{0,17}$/.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 100) {
      throw new PaymentError(400, 'Revisa los productos y cantidades de tu pedido.')
    }
    return { id, qty }
  }).sort((a, b) => a.id.localeCompare(b.id))

  const { name, phone, address = '', reference = '' } = entrega
  if ([name, phone, address, reference].some(value => typeof value !== 'string')) {
    throw new PaymentError(400, 'Revisa los datos de entrega.')
  }
  return {
    tipo,
    articulos: items,
    entrega: { name: name.trim(), phone, address: tipo === 'delivery' ? address.trim() : '', reference: reference.trim() },
  }
}

async function verifyWebhook(raw, header, secret) {
  const fields = header.split(',').map(part => part.trim().split('='))
  const timestamp = fields.find(([name]) => name === 't')?.[1]
  if (!/^\d{1,12}$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return false
  }
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const signed = encoder.encode(`${timestamp}.${raw}`)
  for (const [name, signature] of fields) {
    if (name === 'v1' && /^[a-f0-9]{64}$/.test(signature)) {
      const bytes = Uint8Array.from(signature.match(/../g), hex => parseInt(hex, 16))
      if (await crypto.subtle.verify('HMAC', key, bytes, signed)) return true
    }
  }
  return false
}

export function createPaymentHandler({ env, request = fetch, allowLoopbackTest = false }) {
  const send = (url, options, timeout = 8000) => request(url, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(timeout),
  })

  return async function handlePayment(req) {
    let cors = {}
    const respond = (data, status = 200) => Response.json(data, {
      status, headers: { ...cors, 'Cache-Control': 'no-store' },
    })

    try {
      const app = paymentOrigin(env('STRIPE_CHECKOUT_APP_URL'), allowLoopbackTest)
      const origin = req.headers.get('Origin')
      if (origin === app) {
        cors = {
          'Access-Control-Allow-Origin': app,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, X-Insforge-Version, X-Api-Key',
          Vary: 'Origin',
        }
      } else if (origin) {
        throw new PaymentError(403, 'Origen no autorizado.')
      }
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      if (req.method !== 'POST') throw new PaymentError(405, 'Método no permitido.')

      const base = paymentOrigin(env('INSFORGE_BASE_URL'), allowLoopbackTest)
      const adminKey = env('INSFORGE_API_KEY')
      const mode = env('STRIPE_MODE')
      const stripeKey = env('STRIPE_SECRET_KEY')
      const secret = env('STRIPE_WEBHOOK_SECRET')
      const allowedModes = allowLoopbackTest ? ['test'] : ['test', 'live']
      const webhookConfigured = secret?.startsWith('whsec_')
      if (!adminKey || !allowedModes.includes(mode) ||
          !new RegExp(`^(sk|rk)_${mode}_`).test(stripeKey || '') || (!allowLoopbackTest && !webhookConfigured)) {
        throw new PaymentError(503, 'El servidor de pagos aún no está configurado.')
      }

      async function rpc(name, body) {
        const result = await send(`${base}/api/database/rpc/${name}`, {
          method: 'POST', headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!result.ok) {
          const error = await result.json().catch(() => ({}))
          if (name === 'preparar_pago_tarjeta' && error.code === '22023') {
            throw new PaymentError(409, 'Revisa la disponibilidad de los productos y los datos de entrega.')
          }
          if (name === 'preparar_pago_tarjeta' && error.code === '42501') {
            throw new PaymentError(403, 'La cuenta o el intento de pago no están autorizados.')
          }
          console.warn('RPC de pagos rechazada.', name, result.status, diagnosticCode(error.code))
          throw new Error('Error de la base de datos de pagos.')
        }
        if (name === 'vincular_sesion_tarjeta' || name === 'registrar_reembolso_tarjeta') return
        return result.json()
      }

      async function stripe(path, params, idempotencyKey) {
        const headers = { Authorization: `Bearer ${stripeKey}`, 'Stripe-Version': STRIPE_API_VERSION }
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
        if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded'
        const result = await send(STRIPE_URL + path, {
          method: params ? 'POST' : 'GET', headers, body: params,
        }, 20000)
        if (!result.ok) {
          const payload = await result.json().catch(() => null)
          const details = payload?.error
          console.warn('Operación rechazada por Stripe.', result.status, diagnosticCode(details?.code || details?.type), diagnosticCode(details?.param))
          throw new Error('Stripe no confirmó la operación.')
        }
        return result.json()
      }

      async function resolvePayment(attempt) {
        if (attempt.estado === 'confirmed' || attempt.estado === 'refunded') {
          return { status: attempt.estado, orderId: attempt.estado === 'confirmed' ? attempt.id : null }
        }
        if (!attempt.sesion) {
          const expired = Date.now() - Date.parse(attempt.creado_en) >= 23 * 60 * 60 * 1000
          return { status: expired ? 'expired' : 'open' }
        }
        if (!SESSION.test(attempt.sesion)) throw new Error('Identificador de sesión inválido.')
        const session = await stripe(`checkout/sessions/${attempt.sesion}`)
        if (session.id !== attempt.sesion || session.mode !== 'payment' || session.client_reference_id !== attempt.id ||
            session.amount_total !== attempt.centimos || session.currency !== 'pen' || session.livemode !== (mode === 'live')) {
          throw new Error('La sesión no corresponde a la cotización.')
        }
        if (session.status === 'expired') return { status: 'expired' }
        if (session.status === 'open') return { status: 'open', url: checkoutUrl(session.url, session.id) }
        if (session.status !== 'complete' || session.payment_status !== 'paid') return { status: 'processing' }
        if (!PAYMENT_INTENT.test(session.payment_intent)) throw new Error('El pago carece de referencia.')

        const status = await rpc('confirmar_pago_tarjeta', {
          p_sesion: session.id, p_intento_stripe: session.payment_intent, p_centimos: session.amount_total,
        })
        if (status === 'confirmed') return { status, orderId: attempt.id }
        if (status === 'refunded') return { status }
        if (status !== 'refund_required') throw new Error('Estado de conciliación desconocido.')

        // Consulta también los reembolsos existentes por si se perdió una respuesta anterior de Stripe.
        const refunds = await stripe(`refunds?payment_intent=${session.payment_intent}`)
        const existing = refunds.data.find(item => item.amount === attempt.centimos &&
          item.metadata?.pedido === attempt.id && !['failed', 'canceled'].includes(item.status))
        const refund = existing || await stripe('refunds', new URLSearchParams({
          payment_intent: session.payment_intent, 'metadata[pedido]': attempt.id,
        }), `lys-refund-${attempt.id}`)
        if (refund.status !== 'succeeded') {
          throw new PaymentError(503, 'El reembolso está pendiente de confirmación.')
        }
        await rpc('registrar_reembolso_tarjeta', { p_sesion: session.id })
        return { status: 'refunded' }
      }

      const signature = req.headers.get('Stripe-Signature')
      if (signature !== null) {
        if (!webhookConfigured) throw new PaymentError(503, 'El webhook de pagos todavía no está configurado.')
        const raw = await readBody(req)
        if (!await verifyWebhook(raw, signature, secret)) throw new PaymentError(400, 'Firma de Stripe inválida.')
        const event = parseBody(raw)
        if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type)) {
          return respond({ received: true })
        }
        const sessionId = event.data?.object?.id
        if (!SESSION.test(sessionId) || event.livemode !== (mode === 'live')) {
          throw new PaymentError(400, 'Evento de Stripe inválido.')
        }
        const attempt = await rpc('leer_pago_tarjeta', { p_id: null, p_usuario: null, p_sesion: sessionId })
        if (attempt) await resolvePayment(attempt)
        return respond({ received: true })
      }

      const authorization = req.headers.get('Authorization')
      if (!authorization?.startsWith('Bearer ')) throw new PaymentError(401, 'Inicia sesión para continuar.')
      const identity = await send(`${base}/api/auth/sessions/current`, { headers: { Authorization: authorization } })
      if (!identity.ok) {
        if (identity.status === 401 || identity.status === 403) throw new PaymentError(401, 'Inicia sesión para continuar.')
        throw new Error('InsForge no confirmó la sesión.')
      }
      const { user } = await identity.json()
      if (!UUID.test(user?.id)) throw new PaymentError(401, 'Inicia sesión para continuar.')

      const body = parseBody(await readBody(req))
      if (!UUID.test(body?.id) || !['start', 'status'].includes(body.action)) {
        throw new PaymentError(400, 'El intento de pago no es válido.')
      }
      const args = { p_id: body.id, p_usuario: user.id }
      if (body.action === 'status') {
        const attempt = await rpc('leer_pago_tarjeta', { ...args, p_sesion: null })
        if (!attempt) throw new PaymentError(404, 'El intento de pago no está disponible para esta cuenta.')
        const result = await resolvePayment(attempt)
        return respond({ status: result.status, orderId: result.orderId })
      }

      const attempt = await rpc('preparar_pago_tarjeta', { ...args, p_solicitud: normalizeOrder(body) })
      const existing = await resolvePayment(attempt)
      if (existing.status !== 'open' || attempt.sesion) return respond(existing)

      const returnUrl = new URL(CHECKOUT_PATH, app)
      returnUrl.searchParams.set('pago_tarjeta', attempt.id)
      const params = new URLSearchParams({
        mode: 'payment',
        'payment_method_types[0]': 'card',
        client_reference_id: attempt.id,
        success_url: returnUrl.href,
        cancel_url: new URL(CHECKOUT_PATH, app).href,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'pen',
        'line_items[0][price_data][unit_amount]': String(attempt.centimos),
        'line_items[0][price_data][product_data][name]': 'Pedido Pollería LYS',
      })
      const session = await stripe('checkout/sessions', params, `lys-checkout-${attempt.id}`)
      if (!SESSION.test(session.id) || session.livemode !== (mode === 'live')) {
        throw new Error('Stripe no devolvió una sesión válida.')
      }
      const url = checkoutUrl(session.url, session.id)
      await rpc('vincular_sesion_tarjeta', { ...args, p_sesion: session.id })
      return respond({ status: 'open', url })
    } catch (error) {
      if (error instanceof PaymentError) return respond({ error: 'PAYMENT_REQUEST_FAILED', message: error.message }, error.status)
      if (allowLoopbackTest) console.warn('Pago local no disponible.', error.name, diagnosticCode(error.cause?.code))
      return respond({ error: 'PAYMENT_UNAVAILABLE', message: 'No se pudo confirmar la operación de pago. Intenta nuevamente.' }, 502)
    }
  }
}

function diagnosticCode(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_]{0,47}$/.test(value)) return 'desconocido'
  return value
}

function checkoutUrl(value, sessionId) {
  const url = new URL(value)
  const validPath = url.pathname === `/c/pay/${sessionId}` || url.pathname === `/g/pay/${sessionId}`
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password || !validPath) {
    throw new Error('URL de Checkout inválida.')
  }
  return url.href
}

export default createPaymentHandler({ env: name => Deno.env.get(name) })
