import { randomUUID } from 'node:crypto';
import { createPaymentHandler } from '../../insforge/functions/pago-tarjeta.mjs';

const paymentRpcArgs = new Map([
  ['preparar_pago_tarjeta', ['p_id', 'p_usuario', 'p_solicitud']],
  ['vincular_sesion_tarjeta', ['p_id', 'p_usuario', 'p_sesion']],
  ['leer_pago_tarjeta', ['p_id', 'p_usuario', 'p_sesion']],
  ['confirmar_pago_tarjeta', ['p_sesion', 'p_intento_stripe', 'p_centimos']],
  ['registrar_reembolso_tarjeta', ['p_sesion']],
]);

export function getTestStripeKey(value) {
  if (!/^(?:sk|rk)_test_\w+$/.test(value || '')) {
    throw new Error('Configura STRIPE_SECRET_KEY con una clave de prueba en .env.stripe.local.');
  }
  return value;
}

export function createLocalStripeHandler({ db, identity, port, stripeKey, webhookSecret }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminKey = randomUUID();
  const config = {
    INSFORGE_BASE_URL: baseUrl,
    INSFORGE_API_KEY: adminKey,
    STRIPE_CHECKOUT_APP_URL: 'http://127.0.0.1:5180',
    STRIPE_MODE: 'test',
    STRIPE_SECRET_KEY: getTestStripeKey(stripeKey),
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  };

  return createPaymentHandler({
    allowLoopbackTest: true,
    env: name => config[name],
    request: async (input, options) => {
      const url = new URL(input);
      if (url.origin === 'https://api.stripe.com') return fetch(url, options);
      if (url.origin !== baseUrl) return Response.json(null, { status: 404 });
      const authorization = options.headers?.Authorization;
      if (url.pathname === '/api/auth/sessions/current') {
        const user = identity({ headers: { authorization } });
        return Response.json({ user: user && { id: user.id } }, { status: user ? 200 : 401 });
      }
      const name = url.pathname.replace(/^\/api\/database\/rpc\//, '');
      const args = paymentRpcArgs.get(name);
      if (!args || authorization !== `Bearer ${adminKey}`) return Response.json(null, { status: 403 });
      const payload = JSON.parse(options.body);
      try {
        const result = await db.transaction(async tx => {
          await tx.exec('SET LOCAL ROLE project_admin');
          const parameters = args.map((_, i) => '$' + (i + 1)).join(', ');
          return tx.query(`SELECT public.${name}(${parameters}) AS value`, args.map(arg => payload[arg]));
        });
        return Response.json(result.rows[0].value ?? null);
      } catch (error) {
        return Response.json({ code: error.code }, { status: error.code === '42501' ? 403 : 400 });
      }
    },
  });
}
