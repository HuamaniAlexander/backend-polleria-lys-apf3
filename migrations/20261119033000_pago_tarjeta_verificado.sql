BEGIN;

-- Mantiene la implementación anterior como pieza interna del checkout y de los pedidos comunes.
ALTER FUNCTION public.crear_pedido_cliente(uuid,text,jsonb,jsonb,text) RENAME TO crear_pedido_cliente_interno;
REVOKE ALL ON FUNCTION public.crear_pedido_cliente_interno(uuid,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crear_pedido_cliente_tarjeta(uuid,text,jsonb,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crear_pedido_cliente(
  solicitud_id uuid, tipo_entrega text, articulos jsonb, datos_entrega jsonb, metodo text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF metodo = 'tarjeta' AND current_setting('role') <> 'project_admin' THEN
    RAISE EXCEPTION 'El pago con tarjeta requiere una sesión de Stripe' USING ERRCODE = '42501';
  END IF;
  RETURN public.crear_pedido_cliente_interno(solicitud_id, tipo_entrega, articulos, datos_entrega, metodo);
END;
$$;
REVOKE ALL ON FUNCTION public.crear_pedido_cliente(uuid,text,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_pedido_cliente(uuid,text,jsonb,jsonb,text) TO authenticated;

CREATE TABLE public.intentos_tarjeta (
  id uuid PRIMARY KEY,
  usuario uuid NOT NULL,
  solicitud jsonb NOT NULL,
  centimos integer NOT NULL CHECK (centimos BETWEEN 30 AND 99999999),
  sesion text UNIQUE,
  intento_stripe text UNIQUE,
  estado text NOT NULL DEFAULT 'open' CHECK (estado IN ('open','confirmed','refund_required','refunded')),
  creado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intentos_tarjeta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intentos_tarjeta FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.preparar_pago_tarjeta(p_id uuid, p_usuario uuid, p_solicitud jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_intento public.intentos_tarjeta%ROWTYPE;
  v_centimos integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  SELECT * INTO v_intento FROM public.intentos_tarjeta WHERE id = p_id;
  IF FOUND THEN
    IF v_intento.usuario IS DISTINCT FROM p_usuario OR v_intento.solicitud IS DISTINCT FROM p_solicitud THEN
      RAISE EXCEPTION 'El intento ya pertenece a otra solicitud' USING ERRCODE = '42501';
    END IF;
    RETURN to_jsonb(v_intento) - 'solicitud';
  END IF;

  -- La cotización usa las mismas validaciones, precios, envío y stock que el pedido real.
  -- La subtransacción revierte todos los cambios del pedido provisional.
  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', p_usuario::text, true);
    PERFORM public.crear_pedido_cliente_interno(p_id, p_solicitud->>'tipo', p_solicitud->'articulos', p_solicitud->'entrega', 'tarjeta');
    SELECT (total * 100)::integer INTO v_centimos FROM public.pedidos WHERE id = p_id;
    RAISE SQLSTATE 'LY001';
  EXCEPTION WHEN SQLSTATE 'LY001' THEN
    NULL;
  END;

  IF v_centimos IS NULL OR v_centimos NOT BETWEEN 30 AND 99999999 THEN
    RAISE EXCEPTION 'El pedido no admite este importe' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.intentos_tarjeta(id, usuario, solicitud, centimos)
    VALUES (p_id, p_usuario, p_solicitud, v_centimos) RETURNING * INTO v_intento;
  RETURN to_jsonb(v_intento) - 'solicitud';
END;
$$;

CREATE FUNCTION public.vincular_sesion_tarjeta(p_id uuid, p_usuario uuid, p_sesion text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.intentos_tarjeta SET sesion = p_sesion
  WHERE id = p_id AND usuario = p_usuario AND (sesion IS NULL OR sesion = p_sesion);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La sesión no corresponde al intento' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.leer_pago_tarjeta(p_id uuid, p_usuario uuid, p_sesion text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(i) - 'solicitud'
  FROM public.intentos_tarjeta i
  WHERE (p_usuario IS NOT NULL AND i.id = p_id AND i.usuario = p_usuario)
     OR (p_id IS NULL AND p_usuario IS NULL AND i.sesion = p_sesion);
$$;

CREATE FUNCTION public.confirmar_pago_tarjeta(p_sesion text, p_intento_stripe text, p_centimos integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_intento public.intentos_tarjeta%ROWTYPE;
  v_centimos integer;
  v_estado text := 'confirmed';
BEGIN
  SELECT * INTO v_intento FROM public.intentos_tarjeta WHERE sesion = p_sesion FOR UPDATE;
  IF NOT FOUND OR p_centimos IS DISTINCT FROM v_intento.centimos OR p_intento_stripe IS NULL
     OR (v_intento.intento_stripe IS NOT NULL AND v_intento.intento_stripe <> p_intento_stripe) THEN
    RAISE EXCEPTION 'El pago no corresponde a la cotización' USING ERRCODE = '22023';
  END IF;
  IF v_intento.estado <> 'open' THEN RETURN v_intento.estado; END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_intento.usuario, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_intento.usuario::text, true);
    IF public.rol_actual() IS DISTINCT FROM 'cliente' THEN RAISE SQLSTATE 'LY002'; END IF;
    PERFORM public.crear_pedido_cliente_tarjeta(v_intento.id, v_intento.solicitud->>'tipo',
      v_intento.solicitud->'articulos', v_intento.solicitud->'entrega', p_intento_stripe, v_intento.id);
    SELECT (total * 100)::integer INTO v_centimos FROM public.pedidos WHERE id = v_intento.id;
    IF v_centimos IS DISTINCT FROM v_intento.centimos THEN RAISE SQLSTATE 'LY002'; END IF;
  EXCEPTION WHEN SQLSTATE 'LY002' OR invalid_parameter_value OR unique_violation THEN
    -- Precio, disponibilidad o identidad cambiaron. Revierte el pedido antes de reembolsar.
    v_estado := 'refund_required';
  END;

  UPDATE public.intentos_tarjeta SET estado = v_estado, intento_stripe = p_intento_stripe WHERE id = v_intento.id;
  RETURN v_estado;
END;
$$;

CREATE FUNCTION public.registrar_reembolso_tarjeta(p_sesion text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.intentos_tarjeta SET estado = 'refunded' WHERE sesion = p_sesion AND estado = 'refund_required';
$$;

REVOKE ALL ON FUNCTION public.preparar_pago_tarjeta(uuid,uuid,jsonb),
  public.vincular_sesion_tarjeta(uuid,uuid,text), public.leer_pago_tarjeta(uuid,uuid,text),
  public.confirmar_pago_tarjeta(text,text,integer), public.registrar_reembolso_tarjeta(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preparar_pago_tarjeta(uuid,uuid,jsonb),
  public.vincular_sesion_tarjeta(uuid,uuid,text), public.leer_pago_tarjeta(uuid,uuid,text),
  public.confirmar_pago_tarjeta(text,text,integer), public.registrar_reembolso_tarjeta(text)
  TO project_admin;

NOTIFY pgrst, 'reload schema';
COMMIT;
