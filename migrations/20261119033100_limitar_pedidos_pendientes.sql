BEGIN;

CREATE OR REPLACE FUNCTION public.crear_pedido_cliente(
  solicitud_id uuid, tipo_entrega text, articulos jsonb, datos_entrega jsonb, metodo text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL OR public.rol_actual() IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'Solo clientes autenticados pueden crear pedidos' USING ERRCODE = '42501';
  END IF;
  IF metodo = 'tarjeta' AND current_setting('role') <> 'project_admin' THEN
    RAISE EXCEPTION 'El pago con tarjeta requiere una sesión de Stripe' USING ERRCODE = '42501';
  END IF;

  IF metodo IN ('efectivo', 'yape', 'plin') THEN
    -- Serializa nuevas solicitudes del mismo cliente y permite reintentar un pedido existente.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_usuario::text, 132));
    IF NOT EXISTS (SELECT 1 FROM public.pedidos WHERE id = solicitud_id AND cliente_id = v_usuario)
       AND EXISTS (SELECT 1 FROM public.pedidos WHERE cliente_id = v_usuario
         AND estado <> 'cancelado' AND estado_pago = 'pendiente' AND metodo_solicitado IN ('efectivo', 'yape', 'plin')) THEN
      RAISE EXCEPTION 'Ya tienes un pedido pendiente de pago. Puedes pagar con tarjeta para continuar.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN public.crear_pedido_cliente_interno(solicitud_id, tipo_entrega, articulos, datos_entrega, metodo);
END;
$$;

COMMIT;
