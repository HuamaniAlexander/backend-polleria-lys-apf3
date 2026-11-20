# Pagos con tarjeta en InsForge

El cliente revisa el pedido y continúa en Stripe Checkout. Pollería LYS envía el identificador de la solicitud, los productos, las cantidades y los datos de entrega a su Edge Function. Stripe recibe el importe en céntimos de PEN calculado por PostgreSQL con los precios del catálogo y el envío. El número de tarjeta, la fecha de vencimiento y el CVC se ingresan en la página de Stripe.

La función `pago-tarjeta` valida la sesión de InsForge. En el retorno de Stripe y al recibir un webhook firmado, consulta el estado en Stripe y verifica el identificador de la sesión, la solicitud, el importe, la moneda y el modo. PostgreSQL registra el pedido y el comprobante en una sola transacción. Los reintentos reutilizan la solicitud y las operaciones de Stripe tienen claves de idempotencia. Si el catálogo o el stock cambian e impiden registrar un pago confirmado, la función solicita el reembolso completo y espera la confirmación de Stripe.

Los intentos se guardan en `public.intentos_tarjeta` con RLS habilitado. La Edge Function usa acceso de proyecto para las RPC privadas. Las cuentas del navegador, incluidas las de administración del sistema de la pollería, carecen de ese permiso. Los pagos de caja conservan su RPC y sus permisos de rol.

## Activación en un entorno de pruebas autorizado

1. Selecciona una instancia de InsForge de prueba con el esquema de la rama de origen. Comprueba que ya tenga la migración `20261116012000_registro-tarjeta-cliente.sql`, las migraciones de inventario correspondientes y el esquema de Realtime. Aplica las migraciones nuevas desde el servidor de operación con la URL y API key de esa instancia en su entorno.

   ```bash
   node scripts/apply-migrations.mjs --application --from 20261119033000
   ```

2. Vincula InsForge CLI con la misma instancia y publica la función.

   ```bash
   npx -y @insforge/cli functions deploy pago-tarjeta --file insforge/functions/pago-tarjeta.mjs
   ```

3. Configura `INSFORGE_BASE_URL` con el origen HTTPS de InsForge, `STRIPE_CHECKOUT_APP_URL` con el origen HTTPS del frontend y `STRIPE_MODE=test` en el entorno de la función. Guarda `INSFORGE_API_KEY`, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` como secretos del servidor. La clave de Stripe debe permitir crear y leer sesiones de Checkout y consultar y crear reembolsos. Registra el webhook para `checkout.session.completed` y `checkout.session.async_payment_succeeded` en `https://<origen-insforge>/functions/pago-tarjeta`.
4. Configura `VITE_PAGO_TARJETA_HABILITADO=true` en el entorno de vista previa de Vercel y vuelve a desplegar esa vista previa. Compila el frontend con el origen y la clave pública de esa misma instancia. El frontend valida el origen con el proyecto definido en `src/lib/insforgeConfig.js`. Si se usa una copia de InsForge, ajusta el proyecto de referencia en la compilación de pruebas. Verifica el regreso a la pantalla de confirmación y la llegada del pedido cobrado a Caja mediante Stripe en modo de prueba.

Si Stripe deja un reembolso pendiente o rechaza intentos de conciliación, revisa el evento en el Dashboard de Stripe usando el ID de la sesión. Conserva ambos webhooks durante el despliegue y valida el pago de prueba antes de considerar un cambio de modo.

## Stripe en modo prueba desde la computadora

En `Front-Polleria-LYS-main/.env.stripe.local` configura `STRIPE_SECRET_KEY` con una clave de prueba de Stripe. Git ignora ese archivo. El checkout alojado recibe los datos de tarjeta en Stripe y funciona con la clave privada en el servidor local. La integración usa la versión de API `2025-04-30.basil` para ofrecer tarjeta únicamente en Checkout.

```bash
cd Front-Polleria-LYS-main
npm run dev:stripe
```

Abre [el frontend local](http://127.0.0.1:5180) e inicia sesión como `cliente@local.test` con la contraseña de demostración `Local123!`. Agrega un producto y elige Tarjeta. El servidor concilia el pago al regresar de Stripe. Si usas Stripe CLI para reenviar eventos al puerto 5191, agrega el secreto de firma de la CLI como `STRIPE_WEBHOOK_SECRET` en el mismo archivo y reinicia el servidor. En un despliegue alojado se requiere el webhook configurado en Stripe.

## Verificación local

Desde `Front-Polleria-LYS-main`, ejecuta `npm test`, `npm run lint` y `npm run build`. Las pruebas de pagos usan PGlite y respuestas simuladas de Stripe. La prueba de navegador en `e2e/orders.spec.js` intercepta Stripe e InsForge. Los scripts de integración que apuntan a un proyecto remoto deben configurarse para una instancia de pruebas y con cuentas de prueba propias.

Las contraseñas que estuvieron en el README siguen en el historial de la rama de origen. Si esas cuentas continúan habilitadas, rótalas en el proyecto correspondiente. Si algún despliegue anterior de Vite llegó a incorporar una clave privada de Stripe, rótala también desde el proveedor.
