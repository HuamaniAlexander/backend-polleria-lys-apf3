export function obtenerColorMetodo(nombre = "") {
  const norm = String(nombre).toLowerCase().trim();
  if (norm.includes("yape")) return "#6A1B9A"; // Morado intenso Yape (no pastel, alto contraste)
  if (norm.includes("plin")) return "#007A64"; // Turquesa oscuro intenso Plin (no pastel, gran definición)
  if (norm.includes("efectivo")) return "#15803D"; // Verde bosque sólido Efectivo (no pastel)
  if (norm.includes("tarjeta")) return "#1D4ED8"; // Azul cobalto sólido Tarjeta (no pastel)
  return "#B45309"; // Ámbar tostado por defecto
}
