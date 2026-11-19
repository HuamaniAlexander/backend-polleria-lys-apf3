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
