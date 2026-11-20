-- Borrador local. Requiere 20261120010000_perfiles-validacion.sql.
-- Conserva la implementación existente de precios, stock, propietario e idempotencia.
ALTER FUNCTION public.crear_pedido_cliente(uuid,text,jsonb,jsonb,text) RENAME TO crear_pedido_cliente_validacion_base;
REVOKE ALL ON FUNCTION public.crear_pedido_cliente_validacion_base(uuid,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crear_pedido_cliente(
  solicitud_id uuid, tipo_entrega text, articulos jsonb, datos_entrega jsonb, metodo text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE entrega jsonb; lat numeric; lng numeric;
BEGIN
  IF auth.uid() IS NULL OR public.rol_actual() IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'Solo clientes autenticados pueden crear pedidos' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(datos_entrega) IS DISTINCT FROM 'object' OR
     jsonb_typeof(datos_entrega->'name') IS DISTINCT FROM 'string' OR
     public.nombre_persona_valido(datos_entrega->>'name',7) IS NOT TRUE OR
     jsonb_typeof(datos_entrega->'phone') IS DISTINCT FROM 'string' OR
     (datos_entrega->>'phone') !~ '^9[0-9]{8}$' THEN
    RAISE EXCEPTION 'Revisa el nombre completo y teléfono de entrega' USING ERRCODE = '22023';
  END IF;
  IF datos_entrega ? 'reference' AND
     (jsonb_typeof(datos_entrega->'reference') IS DISTINCT FROM 'string' OR char_length(datos_entrega->>'reference') > 500) THEN
    RAISE EXCEPTION 'La referencia debe ser texto de hasta 500 caracteres' USING ERRCODE = '22023';
  END IF;
  IF tipo_entrega = 'delivery' THEN
    IF jsonb_typeof(datos_entrega->'address') IS DISTINCT FROM 'string' OR
       char_length(btrim(datos_entrega->>'address')) NOT BETWEEN 5 AND 250 OR
       (datos_entrega->>'address') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Dirección inválida' USING ERRCODE = '22023';
    END IF;
    -- Si se envía un punto, el servidor comprueba sus coordenadas, no outOfZone.
    -- La dirección sin punto sigue admitida por compatibilidad con el checkout existente.
    IF datos_entrega ? 'location' THEN
      IF jsonb_typeof(datos_entrega->'location') IS DISTINCT FROM 'object' OR
         jsonb_typeof(datos_entrega->'location'->'lat') IS DISTINCT FROM 'number' OR
         jsonb_typeof(datos_entrega->'location'->'lng') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Coordenadas inválidas' USING ERRCODE = '22023';
      END IF;
      lat := (datos_entrega->'location'->>'lat')::numeric;
      lng := (datos_entrega->'location'->>'lng')::numeric;
      IF lat NOT BETWEEN -11.945 AND -11.750 OR lng NOT BETWEEN -77.085 AND -76.960 THEN
        RAISE EXCEPTION 'La ubicación está fuera de Carabayllo' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  entrega := jsonb_set(datos_entrega,'{name}',to_jsonb(public.normalizar_nombre_persona(datos_entrega->>'name')));
  RETURN public.crear_pedido_cliente_validacion_base(solicitud_id,tipo_entrega,articulos,entrega,metodo);
END;
$$;

REVOKE ALL ON FUNCTION public.crear_pedido_cliente(uuid,text,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_pedido_cliente(uuid,text,jsonb,jsonb,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
