import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import CheckoutSteps from '../../components/CheckoutSteps'
import OrderSummary from '../../components/OrderSummary'
import { useCart } from '../../context/CartContext'
import { money } from '../../utils/currency'
import orderService from '../../services/orderService'
import { getCardCheckoutStatus, redirectToCardCheckout, startCardCheckout } from '../../services/paymentGatewayService'
import '../../styles/compras.css'

function StripeReturn({ attemptId }) {
  const navigate = useNavigate()
  const { completeCardCheckout, clearMatchingAttempt } = useCart()
  const [retry, setRetry] = useState(0)
  const [feedback, setFeedback] = useState(null)

  useEffect(() => {
    let active = true
    getCardCheckoutStatus(attemptId).then(({ status, orderId }) => {
      if (!active) return
      if (status === 'confirmed' && orderId === attemptId) {
        completeCardCheckout(orderId)
        navigate('/confirmacion', { replace: true })
      } else if (status === 'refunded' || status === 'expired') {
        clearMatchingAttempt(attemptId)
        setFeedback({ status, text: status === 'refunded'
          ? 'No se pudo preparar el pedido y Stripe confirmó el reembolso.'
          : 'La sesión de Stripe venció. Puedes volver a pagar desde el resumen.' })
      } else {
        setFeedback({ status, text: 'Stripe aún no confirma el pago. Puedes volver a consultarlo.' })
      }
    }).catch(error => {
      if (active) setFeedback({ status: 'error', text: error.message })
    })
    return () => { active = false }
  }, [attemptId, retry, completeCardCheckout, clearMatchingAttempt, navigate])

  return (
    <section className="checkout-page">
      <CheckoutSteps step={3} />
      <h2 className="font-display checkout-form-title">Confirmación del pago</h2>
      <p role="status">{feedback?.text || 'Verificando el pago con Stripe…'}</p>
      {feedback && (
        <div className="checkout-actions">
          <button className="btn-outline" onClick={() => navigate('/checkout/resumen', { replace: true })}>Volver al resumen</button>
          {!['refunded', 'expired'].includes(feedback.status) && (
            <button className="btn-ember" onClick={() => { setFeedback(null); setRetry(value => value + 1) }}>Consultar de nuevo</button>
          )}
        </div>
      )}
    </section>
  )
}

function OrderReview() {
  const navigate = useNavigate()
  const {
    cartItems, subtotal, shipping, total, deliveryType, form, payment, confirmOrder, cartLoading,
    cartError, isResumingOrder, beginCardCheckout, completeCardCheckout, clearMatchingAttempt,
  } = useCart()
  const unavailable = cartItems.some(item => !item.product.available)
  const isSubmitting = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unpaidOrder, setUnpaidOrder] = useState(null)

  useEffect(() => {
    if (payment === 'tarjeta') return
    let active = true
    orderService.getActiveUnpaidOrder()
      .then(unpaid => { if (active) setUnpaidOrder(unpaid && !isResumingOrder(unpaid.id) ? unpaid : null) })
      .catch(() => { if (active) setUnpaidOrder(null) })
    return () => { active = false }
  }, [payment, isResumingOrder])

  async function handleConfirm() {
    if (isSubmitting.current) return
    isSubmitting.current = true
    setSaving(true)
    setError('')
    let redirecting = false
    try {
      if (payment === 'tarjeta') {
        const attempt = beginCardCheckout()
        const { status, orderId, url } = await startCardCheckout(attempt)
        if (status === 'open' && url) {
          redirectToCardCheckout(url)
          redirecting = true
          return
        }
        if (status === 'confirmed' && orderId === attempt.id) {
          completeCardCheckout(orderId)
        } else if (status === 'expired' || status === 'refunded') {
          clearMatchingAttempt(attempt.id)
          throw new Error(status === 'expired' ? 'La sesión venció. Pulsa Pagar con Stripe para iniciar otra.'
            : 'Stripe confirmó el reembolso del intento anterior. Puedes iniciar otro pago.')
        } else {
          navigate(`/checkout/resumen?pago_tarjeta=${attempt.id}`, { replace: true })
          return
        }
      } else {
        await confirmOrder()
      }
      navigate('/confirmacion')
    } catch (err) {
      setError(err.message)
    } finally {
      if (!redirecting) {
        isSubmitting.current = false
        setSaving(false)
      }
    }
  }

  const pendingCash = payment === 'tarjeta' ? null : unpaidOrder
  return (
    <section className="checkout-page">
      <button onClick={() => navigate('/catalogo')} className="lys-navlink checkout-back-link">
        <ArrowLeft size={15} /> Seguir comprando
      </button>
      <CheckoutSteps step={3} />
      {error && <p role="alert">{error}</p>}
      {cartLoading && <p role="status">Actualizando los productos del carrito...</p>}
      {(cartError || unavailable) && <p role="alert">{cartError || 'Hay productos no disponibles en el carrito.'}</p>}
      <OrderSummary
        items={cartItems}
        subtotal={subtotal}
        shipping={shipping}
        total={total}
        deliveryType={deliveryType}
        form={form}
        payment={payment}
        money={money}
        onBack={() => navigate('/checkout/pago')}
        onConfirm={handleConfirm}
        saving={saving}
        blocked={!payment || !cartItems.length || cartLoading || Boolean(cartError) || unavailable}
        unpaidOrder={pendingCash}
      />
    </section>
  )
}

export default function ResumenPage() {
  const [params] = useSearchParams()
  const attemptId = params.get('pago_tarjeta')
  return attemptId ? <StripeReturn key={attemptId} attemptId={attemptId} /> : <OrderReview />
}
