const CHECKOUT = '/checkout/resumen'
const KEY = 'lys-checkout-return'

export function checkoutReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith(`${CHECKOUT}?`)) return '/'
  const id = new URLSearchParams(value.slice(CHECKOUT.length)).get('pago_tarjeta')
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) return '/'
  return `${CHECKOUT}?pago_tarjeta=${id}`
}

export function rememberCheckoutReturn(value) {
  try { sessionStorage.setItem(KEY, checkoutReturnPath(value)) } catch { /* El inicio de sesión sigue disponible. */ }
}

export function takeCheckoutReturn() {
  try {
    const path = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return checkoutReturnPath(path)
  } catch { return '/' }
}
