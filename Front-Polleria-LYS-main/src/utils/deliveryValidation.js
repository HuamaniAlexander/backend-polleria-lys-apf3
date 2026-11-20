/**
 * Validaciones del formulario de entrega y checkout de Pollería LYS
 */
const CONTROL_CHARACTERS = /\p{Cc}/u

function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateDeliveryForm(form = {}, deliveryType = 'delivery') {
  const nextErrors = {}
  const trimmedName = trimmedText(form.name)

  if (!trimmedName) {
    nextErrors.name = 'Ingresa tu nombre completo.'
  } else if (trimmedName.length > 50 || CONTROL_CHARACTERS.test(trimmedName)) {
    nextErrors.name = 'Ingresa un nombre válido de hasta 50 caracteres.'
  } else if (/\d/.test(trimmedName)) {
    nextErrors.name = 'El nombre no puede contener números.'
  } else if (trimmedName.length <= 6) {
    nextErrors.name = 'Escribe tu nombre completo (debe tener más de 6 letras).'
  }

  const trimmedPhone = trimmedText(form.phone)
  if (!trimmedPhone) {
    nextErrors.phone = 'Ingresa un teléfono de contacto.'
  } else if (!/^9\d{8}$/.test(trimmedPhone)) {
    nextErrors.phone = 'El teléfono debe tener 9 dígitos y empezar con 9.'
  }

  if (deliveryType === 'delivery') {
    const trimmedAddress = trimmedText(form.address)
    if (!trimmedAddress) {
      nextErrors.address = 'Ingresa tu dirección de entrega en Carabayllo.'
    } else if (trimmedAddress.length < 5) {
      nextErrors.address = 'La dirección debe tener al menos 5 caracteres.'
    } else if (trimmedAddress.length > 250 || CONTROL_CHARACTERS.test(trimmedAddress)) {
      nextErrors.address = 'Ingresa una dirección válida de hasta 250 caracteres.'
    }

    if (form.reference != null && (
      typeof form.reference !== 'string' || form.reference.length > 80 || CONTROL_CHARACTERS.test(form.reference)
    )) {
      nextErrors.reference = 'Ingresa una referencia válida de hasta 80 caracteres.'
    }

    if (form.location && form.location.outOfZone) {
      nextErrors.location = 'La ubicación seleccionada está fuera de Carabayllo. Selecciona un punto dentro de la zona delimitada.'
    }
  }

  return nextErrors
}
