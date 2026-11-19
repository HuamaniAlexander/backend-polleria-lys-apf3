import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { asLocalUser, createLocalDatabase, localUsers } from '../scripts/local-db.mjs'
import { asPaymentServer, prepareCard, confirmCard, customer } from './fixtures/card-checkout.js'

let db
const order = () => ({
  tipo: 'delivery',
  articulos: [{ id: 1, qty: 1 }],
  entrega: { name: 'Cliente local', phone: '987654321', address: 'Av. Prueba 123' },
})

beforeAll(async () => { db = await createLocalDatabase() }, 60000)
afterAll(async () => { await db?.close() })

test('calcula el total en la base y publica el pedido únicamente al confirmar el pago', async () => {
  const id = randomUUID()
  const attempt = await prepareCard(db, id, order())
  const { rows: [product] } = await db.query('SELECT precio FROM public.productos WHERE id=1')
  expect(attempt.centimos).toBe(Math.round((Number(product.precio) + 6) * 100))
  expect((await db.query('SELECT id FROM public.pedidos WHERE id=$1', [id])).rows).toHaveLength(0)
  await expect(asPaymentServer(db, 'SELECT public.confirmar_pago_tarjeta($1,$2,$3)',
    [attempt.sesion, 'pi_invalido', 1])).rejects.toMatchObject({ code: '22023' })
  await expect(confirmCard(db, attempt)).resolves.toBe('confirmed')
  await expect(confirmCard(db, attempt)).resolves.toBe('confirmed')

  const { rows: [account] } = await db.query(
    'SELECT estado, estado_pago, total, metodo_solicitado FROM public.pedidos WHERE id=$1', [id],
  )
  const { rows: payments } = await db.query(
    'SELECT metodo, monto, recibido, vuelto, referencia, comprobante FROM public.pagos WHERE pedido_id=$1', [id],
  )
  expect(account).toMatchObject({ estado: 'pendiente', estado_pago: 'pagado', metodo_solicitado: 'tarjeta' })
  expect(payments).toHaveLength(1)
  expect(Number(payments[0].monto) * 100).toBeCloseTo(attempt.centimos)
  expect(payments[0].comprobante).toMatchObject({ id, estado: 'pagado', pago: { metodo: 'tarjeta' } })
})

test('RLS y permisos impiden leer intentos o registrar un cobro desde el navegador', async () => {
  const id = randomUUID()
  const { tipo, articulos, entrega } = order()
  const attempt = await prepareCard(db, id, order())
  for (const user of [null, customer, localUsers.find(user => user.rol === 'admin')]) {
    await expect(asLocalUser(db, user, tx => tx.query('SELECT * FROM public.intentos_tarjeta')))
      .rejects.toMatchObject({ code: '42501' })
    await expect(asLocalUser(db, user, tx => tx.query('SELECT public.confirmar_pago_tarjeta($1,$2,$3)',
      [attempt.sesion, 'pi_invalido', attempt.centimos]))).rejects.toMatchObject({ code: '42501' })
    await expect(asLocalUser(db, user, tx => tx.query('SELECT public.crear_pedido_cliente_tarjeta($1,$2,$3,$4,$5,$6)',
      [id, tipo, articulos, entrega, 'pi_invalido', id]))).rejects.toMatchObject({ code: '42501' })
    await expect(asLocalUser(db, user, tx => tx.query('SELECT public.crear_pedido_cliente($1,$2,$3,$4,$5)',
      [id, tipo, articulos, entrega, 'tarjeta']))).rejects.toMatchObject({ code: '42501' })
  }
  const { rows: [lookup] } = await asPaymentServer(db, 'SELECT public.leer_pago_tarjeta($1,$2,NULL) AS result',
    [id, randomUUID()])
  expect(lookup.result).toBeNull()
  await expect(prepareCard(db, id, { ...order(), tipo: 'recojo' })).rejects.toMatchObject({ code: '42501' })
})

test('revierte el pedido si el importe del catálogo cambió y permite conciliar el reembolso', async () => {
  const id = randomUUID()
  const attempt = await prepareCard(db, id, order())
  await db.exec('UPDATE public.productos SET precio=precio+1 WHERE id=1')
  try {
    await expect(confirmCard(db, attempt)).resolves.toBe('refund_required')
    expect((await db.query('SELECT id FROM public.pedidos WHERE id=$1', [id])).rows).toHaveLength(0)
    expect((await db.query('SELECT id FROM public.pagos WHERE pedido_id=$1', [id])).rows).toHaveLength(0)
    await asPaymentServer(db, 'SELECT public.registrar_reembolso_tarjeta($1)', [attempt.sesion])
    await expect(confirmCard(db, attempt)).resolves.toBe('refunded')
  } finally {
    await db.exec('UPDATE public.productos SET precio=precio-1 WHERE id=1')
  }
})

test('acepta un solo pedido pendiente por cliente y conserva su reintento', async () => {
  const { tipo, articulos, entrega } = order()
  const create = (id, method) => asLocalUser(db, customer, tx => tx.query(
    'SELECT public.crear_pedido_cliente($1,$2,$3,$4,$5) AS id', [id, tipo, articulos, entrega, method],
  ))
  const ids = [randomUUID(), randomUUID()]
  const results = await Promise.allSettled([create(ids[0], 'efectivo'), create(ids[1], 'yape')])
  const winner = results.findIndex(result => result.status === 'fulfilled')
  expect(winner).not.toBe(-1)
  expect(results[1 - winner]).toMatchObject({ status: 'rejected', reason: { code: '22023' } })
  await expect(create(ids[winner], winner === 0 ? 'efectivo' : 'yape'))
    .resolves.toMatchObject({ rows: [{ id: ids[winner] }] })
  const card = await prepareCard(db, randomUUID(), order())
  await expect(confirmCard(db, card)).resolves.toBe('confirmed')
})
