import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import CheckoutSteps from '../../components/CheckoutSteps'
import PaymentMethod from '../../components/PaymentMethod'
import { useCart } from '../../context/CartContext'
import orderService from '../../services/orderService'
import '../../styles/compras.css'

export default function PagoPage() {
  const navigate = useNavigate()
  const { deliveryType, payment, setPayment } = useCart()
  const [activeUnpaidOrder, setActiveUnpaidOrder] = useState(null)

  useEffect(() => {
    let active = true
    orderService.getActiveUnpaidOrder().then((unpaid) => {
      if (!active || !unpaid) return
      setActiveUnpaidOrder(unpaid)
      setPayment(current => current === 'tarjeta' ? current : 'tarjeta')
    }).catch(() => {})
    return () => { active = false }
  }, [setPayment])

  return (
    <section className="checkout-page">
      <button onClick={() => navigate('/catalogo')} className="lys-navlink checkout-back-link">
        <ArrowLeft size={15} /> Seguir comprando
      </button>
      <CheckoutSteps step={2} />
      <PaymentMethod
        deliveryType={deliveryType}
        payment={payment}
        onChange={setPayment}
        onBack={() => navigate('/checkout/entrega')}
        onContinue={() => navigate('/checkout/resumen')}
        activeUnpaidOrder={activeUnpaidOrder}
      />
    </section>
  )
}
