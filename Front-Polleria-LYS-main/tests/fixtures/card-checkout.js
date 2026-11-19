import { localUsers } from '../../scripts/local-db.mjs'

export const customer = localUsers.find(user => user.rol === 'cliente')

export function asPaymentServer(db, statement, params) {
  return db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE project_admin')
    return tx.query(statement, params)
  })
}

export async function prepareCard(db, id, request) {
  const { rows } = await asPaymentServer(db,
    'SELECT public.preparar_pago_tarjeta($1,$2,$3) AS attempt', [id, customer.id, request])
  const attempt = rows[0].attempt
  const session = `cs_test_${id.replaceAll('-', '')}`
  await asPaymentServer(db, 'SELECT public.vincular_sesion_tarjeta($1,$2,$3)', [id, customer.id, session])
  return { ...attempt, sesion: session }
}

export async function confirmCard(db, attempt) {
  const { rows } = await asPaymentServer(db, 'SELECT public.confirmar_pago_tarjeta($1,$2,$3) AS status',
    [attempt.sesion, `pi_${attempt.id.replaceAll('-', '')}`, attempt.centimos])
  return rows[0].status
}
