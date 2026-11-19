import { requireInsforge } from '../lib/insforge'

async function invoke(body) {
  const { data, error } = await requireInsforge().functions.invoke('pago-tarjeta', { body })
  if (error) throw new Error(error.message || 'El pago con tarjeta no está disponible.')
  if (!data?.status) throw new Error('No se pudo verificar el pago con tarjeta.')
  return data
}

export function startCardCheckout({ id, items, deliveryType, form }) {
  return invoke({
    action: 'start',
    id,
    tipo: deliveryType,
    articulos: items.map(({ product, qty }) => ({ id: product.id, qty })),
    entrega: form,
  })
}

export function getCardCheckoutStatus(id) {
  return invoke({ action: 'status', id })
}

export function redirectToCardCheckout(value) {
  const url = new URL(value)
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password || !url.pathname.startsWith('/c/pay/')) {
    throw new Error('No se pudo abrir Stripe Checkout.')
  }
  window.location.assign(url.href)
}
