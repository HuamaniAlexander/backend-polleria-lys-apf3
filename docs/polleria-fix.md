# Fix de actualizaciones por eventos

La rama `fix-eventos-nuevo-insforge` parte de `fix` (`2b7168d`), que ya configura el proyecto **FIX-DB-LYS-NOV** en `https://8bwzqx2s.us-east.insforge.app`. Sobre esa base se aplican los cambios de `polleria-fix.bundle`, cuyo commit final es `8106e01`.

Los cambios sustituyen consultas periódicas por eventos, limitan las lecturas de caja, cocina y mesas, actualizan catálogo y carrito cuando cambia el stock, y calculan el resumen diario de caja en PostgreSQL.

## Migraciones del backend

Publicar esta rama en GitHub no ejecuta las migraciones en InsForge. Los siguientes archivos de `migrations/realtime/` deben estar instalados en **FIX-DB-LYS-NOV** antes de desplegar el frontend:

1. `20261119030000_mesas_operativas.sql`: consulta de mesas y atenciones abiertas.
2. `20261119031000_eventos_operativos.sql`: eventos y permisos de suscripción.
3. `20261119032000_resumen_caja.sql`: resumen diario de caja e índice de pagos.

El ejecutor existente permite aplicar este grupo desde la raíz:

```powershell
node scripts/apply-migrations.mjs --realtime
```

Requiere `INSFORGE_BASE_URL` con la URL anterior e `INSFORGE_API_KEY` en el entorno administrativo. La API key debe permanecer fuera del frontend y de Git. El ejecutor comprueba las migraciones registradas y sus checksums antes de aplicar las pendientes.

La configuración del frontend se toma de `Front-Polleria-LYS-main/.env.local`, con `VITE_INSFORGE_BASE_URL` y la clave pública `VITE_INSFORGE_ANON_KEY` del mismo proyecto. Los documentos anteriores que mencionan otros proyectos describen instalaciones históricas.
