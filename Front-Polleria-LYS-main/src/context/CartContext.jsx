import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { DELIVERY_COST } from '../data/products'
import { stockLimit } from '../utils/stock'
import { getCartProducts } from '../services/productService'
import { watchCatalog } from '../services/orderUpdates'
import { cardCheckoutEnabled } from '../services/paymentGatewayService'
import orderService from '../services/orderService'
import { getCurrentUser } from '../services/authService'
import { orderSignature, readPendingOrder, savePendingOrder, clearPendingOrder } from '../utils/pendingOrder'
import { formatCodigoPedido } from '../utils/orderNumber'

const CartContext = createContext(null)
const CART_STORAGE_KEY = 'lys-cart'
const DELIVERY_STORAGE_KEY = 'lys-checkout-delivery'
const PAYMENT_STORAGE_KEY = 'lys-checkout-payment'
const ORDER_STORAGE_KEY = 'lys-order-number'

const EMPTY_FORM = { name: '', address: '', reference: '', phone: '' }
function readStoredCart() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    const stored = raw ? JSON.parse(raw) : null
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(
      ([id, qty]) => /^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(qty) && qty > 0,
    ))
  } catch {
    return {}
  }
}

function readStoredDelivery() {
  if (typeof window === 'undefined') return { deliveryType: 'delivery', form: EMPTY_FORM }
  try {
    const raw = window.localStorage.getItem(DELIVERY_STORAGE_KEY)
    if (!raw) return { deliveryType: 'delivery', form: EMPTY_FORM }
    const parsed = JSON.parse(raw)
    const normalizedType = parsed.deliveryType === 'pickup' ? 'recojo' : (parsed.deliveryType || 'delivery')
    const rawForm = parsed.form || EMPTY_FORM
    const sanitizedForm = {
      ...rawForm,
      name: typeof rawForm.name === 'string' ? rawForm.name.replace(/[0-9]/g, '') : (rawForm.name || '')
    }
    return { deliveryType: normalizedType, form: sanitizedForm }
  } catch {
    return { deliveryType: 'delivery', form: EMPTY_FORM }
  }
}

function readStoredPayment() {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(PAYMENT_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function readStoredOrderNumber() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ORDER_STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState(readStoredCart)
  const [products, setProducts] = useState({})
  const [catalogState, setCatalogState] = useState({ ids: null, error: '' })
  const cartIds = Object.keys(cart).sort().join(',')
  const cartLoading = Boolean(cartIds) && catalogState.ids !== cartIds
  const cartError = catalogState.ids === cartIds ? catalogState.error : ''
  const missingCartIds = !cartLoading && cartError ? Object.keys(cart).filter(id => !products[id]) : []
  const [cartOpen, setCartOpen] = useState(false)
  const [deliveryType, setDeliveryTypeRaw] = useState(() => readStoredDelivery().deliveryType)
  const setDeliveryType = (type) => setDeliveryTypeRaw(type === 'pickup' ? 'recojo' : type)
  const [form, setForm] = useState(() => readStoredDelivery().form)
  const [payment, setPayment] = useState(readStoredPayment)
  const [orderNumber, setOrderNumber] = useState(readStoredOrderNumber)
  const [stockAlert, setStockAlert] = useState(null)
  const clearStockAlert = () => setStockAlert(null)

  useEffect(() => {
    if (!cartIds) return
    const ids = cartIds.split(',')
    let active = true, running = false, pending = false, rows = []
    async function refresh(changes) {
      if (changes && changes.every(change =>
        change.recurso === 'categorias' ||
        (change.recurso === 'productos' && change.productoId && !ids.includes(String(change.productoId))) ||
        (change.recurso === 'stock' && change.inventarioId && rows.length === ids.length &&
          rows.every(product => product.inventoryId !== change.inventarioId)),
      )) return
      pending = true
      if (running) return
      running = true
      do {
        pending = false
        try {
          rows = await getCartProducts(ids)
          if (active) {
            setProducts(Object.fromEntries(rows.map(product => [product.id, product])))
            setCatalogState({ ids: cartIds, error: rows.length < ids.length ? 'Un producto del carrito ya no está en el catálogo.' : '' })
          }
        } catch (error) {
          if (active) setCatalogState({ ids: cartIds, error: error.message })
        }
      } while (active && pending)
      running = false
    }
    const stop = watchCatalog(refresh)
    const refreshLocal = () => { void refresh() }
    window.addEventListener('catalog-stock-changed', refreshLocal)
    return () => {
      active = false
      stop()
      window.removeEventListener('catalog-stock-changed', refreshLocal)
    }
  }, [cartIds])

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))
    } catch {
      // localStorage no disponible (modo privado, cuotas, etc.)
    }
  }, [cart])

  useEffect(() => {
    try {
      window.localStorage.setItem(DELIVERY_STORAGE_KEY, JSON.stringify({ deliveryType, form }))
    } catch {
      // localStorage no disponible (modo privado, cuotas, etc.)
    }
  }, [deliveryType, form])

  useEffect(() => {
    try {
      window.localStorage.setItem(PAYMENT_STORAGE_KEY, payment)
    } catch {
      // localStorage no disponible (modo privado, cuotas, etc.)
    }
  }, [payment])

  useEffect(() => {
    try {
      if (orderNumber) window.localStorage.setItem(ORDER_STORAGE_KEY, orderNumber)
      else window.localStorage.removeItem(ORDER_STORAGE_KEY)
    } catch {
      // localStorage no disponible (modo privado, cuotas, etc.)
    }
  }, [orderNumber])

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: products[id], qty }))
        .filter((item) => item.product && item.qty > 0),
    [cart, products]
  )
  const cartCount = cartItems.reduce((total, item) => total + item.qty, 0)
  const subtotal = cartItems.reduce((total, item) => total + item.qty * item.product.price, 0)
  const shipping = deliveryType === 'delivery' && subtotal > 0 ? DELIVERY_COST : 0
  const total = subtotal + shipping

  function openCart() {
    setCartOpen(true)
  }

  function closeCart() {
    setCartOpen(false)
  }

  function addToCart(product, qty = 1) {
    const id = typeof product === 'object' ? product.id : product
    const itemProduct = typeof product === 'object' ? product : (products[id] || { id })
    const maxStock = stockLimit(itemProduct, cart, [...Object.values(products), itemProduct])
    const currentQty = cart[id] || 0
    const targetQty = currentQty + qty

    if (typeof product === 'object') {
      if (!product.available) return false
      setProducts(current => ({ ...current, [id]: product }))
    }

    if (targetQty > maxStock) {
      const productName = itemProduct.name || `Producto #${id}`
      setStockAlert({
        id,
        message: `Solo quedan ${maxStock} unidades disponibles de "${productName}". Ya tienes ${currentQty} en tu carrito.`,
        maxStock,
      })
      setCartOpen(true)
      return false
    }

    setStockAlert(null)
    setCart((current) => ({ ...current, [id]: targetQty }))
    return true
  }

  function removeItem(id) {
    setCart((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setStockAlert(cur => (cur?.id === id ? null : cur))
  }

  function setQty(id, qty) {
    if (qty <= 0) {
      setCart((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setStockAlert(cur => (cur?.id === id ? null : cur))
      return
    }

    const itemProduct = products[id] || { id }
    const maxStock = stockLimit(itemProduct, cart, Object.values(products))

    if (qty > maxStock) {
      const productName = itemProduct.name || `Producto #${id}`
      setStockAlert({
        id,
        message: `Solo quedan ${maxStock} unidades disponibles de "${productName}". No es posible seleccionar ${qty}.`,
        maxStock,
      })
      setCart((current) => ({ ...current, [id]: maxStock }))
      return
    }

    setStockAlert(cur => (cur?.id === id ? null : cur))
    setCart((current) => ({ ...current, [id]: qty }))
  }

  function updateFormField(field, value) {
    const sanitizedValue = field === 'name' && typeof value === 'string' ? value.replace(/[0-9]/g, '') : value
    setForm((current) => ({ ...current, [field]: sanitizedValue }))
  }

  const pendingOrder = useRef(readPendingOrder());
  const confirmation = useRef(null);
  const isResumingOrder = useCallback(id => pendingOrder.current?.id === id &&
    pendingOrder.current.signature === orderSignature(getCurrentUser()?.id, {
      items: cartItems, deliveryType, form, payment,
    }), [cartItems, deliveryType, form, payment]);
  function currentOrderRequest() {
    return { items: cartItems, deliveryType, form, payment }
  }

  function getOrderAttempt(request) {
    const signature = orderSignature(getCurrentUser()?.id, request)
    const previous = readPendingOrder() || pendingOrder.current
    pendingOrder.current = previous?.signature === signature ? previous : { id: crypto.randomUUID(), signature }
    savePendingOrder(pendingOrder.current)
    return pendingOrder.current.id
  }

  const clearMatchingAttempt = useCallback(id => {
    const current = readPendingOrder() || pendingOrder.current
    if (current?.id !== id) return false
    pendingOrder.current = null
    clearPendingOrder()
    return true
  }, [])

  const completeCardCheckout = useCallback((id) => {
    const items = Object.entries(cart).map(([productId, qty]) => ({ product: { id: Number(productId) }, qty }))
    const signature = orderSignature(getCurrentUser()?.id, { items, deliveryType, form, payment: 'tarjeta' })
    const current = readPendingOrder() || pendingOrder.current
    if (current?.id === id && current.signature === signature) setCart({})
    clearMatchingAttempt(id)
    setOrderNumber(id)
    window.dispatchEvent(new Event('catalog-stock-changed'))
  }, [cart, deliveryType, form, clearMatchingAttempt])

  function beginCardCheckout() {
    validateCart()
    const request = currentOrderRequest()
    return { ...request, id: getOrderAttempt(request) }
  }

  function validateCart() {
    if (cartLoading || cartError || !cartItems.length || cartItems.some(item => !item.product.available)) {
      throw new Error('Revisa los productos y su disponibilidad en el carrito antes de continuar.')
    }
    if (getCurrentUser()?.rol !== 'cliente') throw new Error('Debes iniciar sesión como cliente.')
  }

  async function confirmOrder() {
    if (confirmation.current) return confirmation.current;
    validateCart()
    if (payment === 'tarjeta') throw new Error('Completa tu pago en Stripe.')

    const activeUnpaid = await orderService.getActiveUnpaidOrder()
    if (activeUnpaid && !isResumingOrder(activeUnpaid.id)) {
      throw new Error(
        `Ya tienes un pedido en curso (${formatCodigoPedido(activeUnpaid.id)}) con pago pendiente.${cardCheckoutEnabled ? ' Puedes pagar con tarjeta para continuar.' : ''}`
      )
    }

    const request = currentOrderRequest()
    const id = getOrderAttempt(request)
    confirmation.current = orderService.createOrder({ id, ...request })
      .then(saved => {
        window.dispatchEvent(new Event('catalog-stock-changed'));
        setOrderNumber(saved.id); setCart({});
        clearMatchingAttempt(id);
        return saved.id;
      }).catch(error => {
        window.dispatchEvent(new Event('catalog-stock-changed'));
        throw error;
      }).finally(() => { confirmation.current = null; });
    return confirmation.current;
  }

  function resetAll() {
    pendingOrder.current = null
    clearPendingOrder()
    setCart({})
    setDeliveryType('delivery')
    setForm(EMPTY_FORM)
    setPayment('')
    setOrderNumber(null)
  }

  const value = {
    cart,
    isResumingOrder,
    getAvailableStock: product => stockLimit(product, cart, [...Object.values(products), product]),
    stockAlert,
    clearStockAlert,
    missingCartIds,
    cartLoading,
    cartError,
    cartItems,
    cartCount,
    subtotal,
    shipping,
    total,
    cartOpen,
    openCart,
    closeCart,
    addToCart,
    removeItem,
    setQty,
    deliveryType,
    setDeliveryType,
    form,
    updateFormField,
    payment,
    setPayment,
    beginCardCheckout,
    completeCardCheckout,
    clearMatchingAttempt,
    orderNumber,
    confirmOrder,
    resetAll,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

// El contexto mantiene su provider y su hook público en el mismo módulo.
// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart debe usarse dentro de un CartProvider')
  }
  return context
}
