import { MapPin, Store } from 'lucide-react'
import AddressAutocomplete from './AddressAutocomplete'
import DeliveryMap from './DeliveryMap'

export default function DeliveryForm({ deliveryType, form, errors = {}, onTypeChange, onFormChange, onContinue }) {
  function handlePhoneChange(event) {
    const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 9)
    if (digitsOnly && digitsOnly[0] !== '9') return
    onFormChange('phone', digitsOnly)
  }

  function handleNameChange(event) {
    const noNumbers = event.target.value.replace(/[0-9]/g, '')
    onFormChange('name', noNumbers)
  }

  function handleNameKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (/[0-9]/.test(event.key)) {
      event.preventDefault()
    }
  }

  function handleNamePaste(event) {
    const paste = (event.clipboardData || window.clipboardData)?.getData('text') || ''
    if (/[0-9]/.test(paste)) {
      event.preventDefault()
      const sanitized = paste.replace(/[0-9]/g, '')
      const input = event.target
      const start = input.selectionStart || 0
      const end = input.selectionEnd || 0
      const current = form.name || ''
      const updated = (current.slice(0, start) + sanitized + current.slice(end)).slice(0, 50)
      onFormChange('name', updated)
    }
  }

  return (
    <div className="delivery-form-wrapper">
      <h2 className="font-display checkout-form-title">Datos de entrega</h2>
      <div className="delivery-type-group">
        <button
          type="button"
          onClick={() => onTypeChange('delivery')}
          className={`chip delivery-type-chip ${deliveryType === 'delivery' ? 'active' : ''}`}
        >
          <MapPin size={16} /> Delivery (Carabayllo)
        </button>
        <button
          type="button"
          onClick={() => onTypeChange('recojo')}
          className={`chip delivery-type-chip ${deliveryType === 'recojo' || deliveryType === 'pickup' ? 'active' : ''}`}
        >
          <Store size={16} /> Recojo en tienda
        </button>
      </div>

      <div className="delivery-form-grid">
        <label className="checkout-field-label">
          Nombre completo
          <input
            className={`lys-input ${errors.name ? 'err' : ''}`}
            value={form.name || ''}
            onChange={handleNameChange}
            onKeyDown={handleNameKeyDown}
            onPaste={handleNamePaste}
            placeholder="Ej. María Torres López"
            maxLength={50}
          />
          {errors.name && <span className="checkout-field-error">{errors.name}</span>}
        </label>

        {deliveryType === 'delivery' && (
          <>
            <div className="checkout-field-group">
              <label className="checkout-field-label">
                Dirección de entrega
                <AddressAutocomplete
                  value={form.address || ''}
                  onChange={(val) => onFormChange('address', val)}
                  onSelectLocation={(point, fullAddress) => {
                    onFormChange('location', point)
                    if (fullAddress) onFormChange('address', fullAddress)
                  }}
                  error={errors.address}
                  placeholder="Escribe tu calle o avenida en Carabayllo..."
                />
              </label>
              {errors.address && <span className="checkout-field-error">{errors.address}</span>}
            </div>

            <label className="checkout-field-label">
              Referencia (opcional)
              <input
                className={`lys-input ${errors.reference ? 'err' : ''}`}
                value={form.reference || ''}
                onChange={(event) => onFormChange('reference', event.target.value)}
                placeholder="Ej. Frente al parque, fachada azul, piso 2..."
                maxLength={80}
              />
              {errors.reference && <span className="checkout-field-error">{errors.reference}</span>}
            </label>

            {/* Mapa interactivo delimitado al distrito de Carabayllo */}
            <DeliveryMap
              point={form.location || null}
              onChange={(loc) => onFormChange('location', loc)}
              onAddressDetected={(detectedAddr) => {
                if (detectedAddr) {
                  onFormChange('address', detectedAddr)
                }
              }}
            />
            {errors.location && <span className="checkout-field-error">{errors.location}</span>}
          </>
        )}

        <label className="checkout-field-label">
          Teléfono de contacto
          <input
            className={`lys-input ${errors.phone ? 'err' : ''}`}
            value={form.phone || ''}
            onChange={handlePhoneChange}
            type="tel"
            inputMode="numeric"
            maxLength={9}
            placeholder="9XXXXXXXX"
          />
          {errors.phone && <span className="checkout-field-error">{errors.phone}</span>}
        </label>
      </div>

      <button className="btn-ember checkout-submit-btn" onClick={onContinue}>
        Continuar al pago
      </button>
    </div>
  )
}
