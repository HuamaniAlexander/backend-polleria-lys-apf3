# Fix de actualizaciones por eventos

La rama `fix-eventos-nuevo-insforge` parte de `fix` (`2b7168d`), que ya configura el proyecto **FIX-DB-LYS-NOV** en `https://8bwzqx2s.us-east.insforge.app`. Sobre esa base se aplican los cambios de `polleria-fix.bundle`, cuyo commit final es `8106e01`.

Los cambios sustituyen consultas periódicas por eventos, limitan las lecturas de caja, cocina y mesas, actualizan catálogo y carrito cuando cambia el stock, y calculan el resumen diario de caja en PostgreSQL.

## Migraciones del backend

Publicar esta rama en GitHub no ejecuta las migraciones en InsForge. Los siguientes archivos de `migrations/realtime/` deben estar instalados en **FIX-DB-LYS-NOV** antes de desplegar el frontend:

1. `20261119030000_mesas_operativas.sql`: consulta de mesas y atenciones abiertas.
2. `20261119031000_eventos_operativos.sql`: eventos y permisos de suscripción.
3. `20261119032000_resumen_caja.sql`: resumen diario de caja e índice de pagos.

Este grupo requiere previamente `migrations/20261016220100_seguimiento-pedidos.sql`, que crea los canales privados, sus políticas y los triggers de pedidos. Al recuperar el backend desde una copia, comprobar también esta dependencia: las tablas de negocio pueden existir sin la configuración de Realtime.

Una vez instalada esa dependencia, el ejecutor existente permite aplicar este grupo desde la raíz:

```powershell
node scripts/apply-migrations.mjs --realtime
```

Requiere `INSFORGE_BASE_URL` con la URL anterior e `INSFORGE_API_KEY` en el entorno administrativo. La API key debe permanecer fuera del frontend y de Git. El ejecutor comprueba las migraciones registradas y sus checksums antes de aplicar las pendientes.

La configuración del frontend se toma de `Front-Polleria-LYS-main/.env.local`, con `VITE_INSFORGE_BASE_URL` y la clave pública `VITE_INSFORGE_ANON_KEY` del mismo proyecto. Los documentos anteriores que mencionan otros proyectos describen instalaciones históricas.

## Aplicación verificada: 19 de noviembre de 2026

Se instalaron en **FIX-DB-LYS-NOV** la dependencia inicial y las tres migraciones del fix. Se ejecutó primero un ensayo con rollback y después una aplicación conjunta mediante el MCP, dentro de una sola transacción. Las comprobaciones de datos y permisos forman parte de esa transacción; un fallo revierte todo el bloque.

Versiones y SHA-256 confirmados en `public.schema_migrations` desde una conexión independiente:

| Versión | SHA-256 |
| --- | --- |
| `20261016220100_seguimiento-pedidos.sql` | `ec85da9d7f2741758a1110ea3d1ae6057a45bd9a3593093bba6cc6ffd7ba8624` |
| `20261119030000_mesas_operativas.sql` | `cb285878bfb0a3023a4db2d98f3e17ae56c0885b2c85e539ad38a6f8efde7b7f` |
| `20261119031000_eventos_operativos.sql` | `fc3cce83bfba46d69abed019a2ff92dde51ba7e50421e0a9944df8a1a6c2175a` |
| `20261119032000_resumen_caja.sql` | `9035f748a0dc740b245658f790fcd19f667018a58ff2d90da56e530f950b335d` |

Resultados de la validación:

- Mismas cantidades y huellas de contenido en 14 tablas de negocio, incluidos 81 pedidos, 67 pagos, 108 detalles y el inventario.
- Tres canales habilitados (`lys:catalogo`, `lys:staff`, `lys:client:%`), 12 triggers de notificación y RLS activo en canales y mensajes.
- Consultas internas de mesas y resumen de caja ejecutadas con los datos reales; el resumen coincide con la agregación directa de pagos.
- Permisos de ejecución comprobados: las RPC están disponibles para `authenticated`, y las funciones de trigger no son ejecutables por clientes.
- Prueba con el SDK real: suscripción anónima al catálogo aceptada; suscripción anónima al canal de personal y llamadas anónimas a ambas RPC rechazadas.
- Publicación nativa comprobada dentro de un bloque con rollback, sin dejar el mensaje de prueba persistido.

Para utilizar estas mejoras en la web publicada, desplegar el frontend de `fix-eventos-nuevo-insforge` con las variables del mismo proyecto.

## Validaciones locales en revisión: 20 de noviembre de 2026

Esta etapa se distribuye en la rama `fix-validaciones-registro-carrito`, creada desde `fix-eventos-nuevo-insforge` (`bee3344`), y conserva el backend **FIX-DB-LYS-NOV**. Los cambios SQL de validación se incluyen como borradores; esta publicación no los ejecuta en el backend compartido. El frontend en `localhost` sigue utilizando el InsForge remoto para las operaciones reales: una cuenta válida que se registre manualmente puede enviar correo y crear datos reales.

Se reutilizan los validadores JavaScript del proyecto, con reglas compartidas para nombres y tipos de datos. No se añade Zod ni una Edge Function. Registro y perfil validan tanto en el formulario como antes de la llamada del servicio. Los datos personales pendientes almacenados en el navegador se vuelven a comprobar antes de guardarlos.

El carrito exige cantidades enteras entre 1 y 100, identificadores válidos y hasta 100 productos distintos. Descarta carritos corruptos guardados en `localStorage`. Antes del pago y de confirmar se revisan disponibilidad, precios finitos, stock compartido, método de pago, entrega y datos de contacto. La confirmación del servicio vuelve a validar el pedido aunque se omitan los pasos del formulario. Los precios enviados por el navegador siguen sin determinar los importes del servidor.

La entrega comprueba nombres sin números, celular, longitudes de dirección/referencia y coordenadas cuando se proporcionan. La cobertura se calcula con las coordenadas; no se confía únicamente en `outOfZone`. La dirección sin punto en el mapa sigue permitida por compatibilidad; exigir un punto obligatorio requiere una decisión adicional y actualizar también los clientes anteriores.

Los siguientes borradores SQL están aislados en `migrations/validacion/`; los ejecutores existentes no los aplican automáticamente:

1. `20261120010000_perfiles-validacion.sql`: revoca permisos generales sobre perfiles, conserva edición de campos personales autorizados y añade un trigger para validar cambios. Mantiene los perfiles provisionales sin apellido/teléfono creados por el alta nativa y no reescribe nombres históricos.
2. `20261120011000_entrega-validacion.sql`: protege la RPC de pedidos con las reglas de contacto y coordenadas, conservando la implementación original de precios, stock e idempotencia como función interna no accesible al cliente.

Las pruebas SQL utilizan una base PostgreSQL desechable con PGlite y aplican estos borradores solo allí. Reproducen los permisos amplios detectados en el backend importado. Las pruebas de navegador interceptan las APIs y no envían correos ni crean cuentas en InsForge. La posibilidad de bloquear un alta nativa antes de emitir OTP debe verificarse en un backend aislado antes de prometer ese comportamiento: las comprobaciones del frontend no bloquean el acceso directo a la API de Auth.

Para repetir las pruebas desde `Front-Polleria-LYS-main`:

```powershell
npm test
npm run test:e2e:validaciones
npm run build
```

Para probar la interfaz, seleccionar esta rama, instalar las dependencias del frontend con `npm ci`, configurar su `.env.local` para el mismo proyecto y ejecutar `npm run dev`. La revisión de los demás inputs y formularios queda para una etapa posterior.

Las pruebas de navegador usan el puerto 5185 para conservar el servidor de desarrollo del usuario. El pago con tarjeta y su integración con Stripe quedan expresamente fuera de esta etapa; los hallazgos de la auditoría sobre ese flujo siguen pendientes.

Verificación local completada: 423 pruebas de Vitest, 34 pruebas de navegador y compilación de producción correctas. Se comprobó explícitamente que cambiar el input de nombre a `number` no solicita el alta ni el código de correo. El lint de los archivos modificados no presenta errores; conserva una advertencia anterior de dependencias del efecto en `PagoPage.jsx`.

El ajuste posterior de los campos de nombre y apellido también impide números durante la escritura y filtra el texto pegado o autocompletado antes de actualizar el formulario. Se aplica a registro, perfil y nombre de entrega, incluidos dígitos Unicode. Si se pega `María2 José3`, queda `María José`; si se pegan solo números, el campo queda vacío y no permite continuar sin un nombre válido. Se mantienen las validaciones de los servicios. Este ajuste pasó 37 pruebas de validadores, cinco casos específicos de navegador (teclado, portapapeles y HTML manipulado), lint de los archivos modificados y compilación.
