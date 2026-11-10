# eventos-service

**Responsabilidad:** gestionar los eventos y garantizar que nunca se entreguen más lugares que su aforo.

Es la **única autoridad sobre la disponibilidad**: ningún otro servicio modifica el aforo ni accede a esta base. La definición completa (reglas, datos, límites) está en [`docs/arquitectura.md`](../../docs/arquitectura.md), sección 5.1.

## Ejecución local

Requisitos: Node.js 20+, MongoDB y Redis en ejecución.

```bash
cd services/eventos-service
cp .env.example .env
npm install
npm start          # http://localhost:3002
npm test           # pruebas (las del lock usan Redis si REDIS_URL está definida)
npm run seed       # carga eventos de prueba (se puede correr varias veces)
```

Para tener las dependencias sin usar Compose todavía:

```bash
docker run -d --name eventos-mongo -p 27017:27017 mongo
docker run -d --name eventos-redis -p 6379:6379 redis
```

## Variables de entorno

| Variable | Ejemplo (local) | Descripción |
|---|---|---|
| `SERVICE_NAME` | `eventos-service` | Nombre que aparece en los logs y en `/health` |
| `PORT` | `3002` | Puerto de la aplicación (en Compose será 3000 por dentro) |
| `LOG_LEVEL` | `info` | Nivel de log |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/eventos` | Base propia (Compose: `mongodb://eventos-db:27017/eventos`) |
| `REDIS_URL` | `redis://localhost:6379` | Redis para el lock por evento (Compose: `redis://redis:6379`) |
| `LOCK_TTL_MS` | `5000` | TTL del lock en milisegundos |
| `EVENTOS_SERVICE_TOKEN_SECRET` | Secreto aleatorio de 48 bytes | Verifica la identidad técnica de entradas-service; debe coincidir con Entradas y ser distinto de `JWT_SECRET` |

## Endpoints

Swagger UI: `http://localhost:3002/api-docs`

| Método | Ruta | Descripción | Respuestas |
|---|---|---|---|
| GET | `/eventos` | Listar (filtro opcional `?estado=`) | 200, 400 |
| POST | `/eventos` | Crear (queda PUBLICADO con todo el aforo) | 201, 400 |
| GET | `/eventos/:id` | Consultar (incluye `vigente` y `vendible`) | 200, 400, 404 |
| PUT | `/eventos/:id` | Modificar datos o aforo | 200, 400, 404, 409, 423 |
| PATCH | `/eventos/:id/cancelar` | Cancelar (idempotente) | 200, 404, 409, 423 |
| PATCH | `/eventos/:id/finalizar` | Finalizar, solo si ya ocurrió (idempotente) | 200, 404, 409, 423 |
| POST | `/eventos/:id/reservar-aforo` | **Interno.** Reservar lugares `{ cantidad, referencia }` | 200, 400, 404, 409, 423, 503 |
| POST | `/eventos/:id/liberar-aforo` | **Interno.** Liberar lugares `{ cantidad, referencia }` | 200, 400, 404, 409, 423, 503 |
| GET | `/health` | El proceso está activo | 200 |
| GET | `/ready` | Estado de MongoDB y Redis | 200, 503 |

Los errores tienen la forma `{ "message": "...", "code": "..." }`. Códigos de negocio: `SIN_AFORO`, `EVENTO_NO_VENDIBLE`, `REFERENCIA_CONFLICTIVA`, `CANTIDAD_INCONSISTENTE`, `AFORO_MENOR_A_VENDIDO`, `EVENTO_NO_MODIFICABLE`, `TRANSICION_INVALIDA`, `LOCK_OCUPADO`.

Los POST de reserva y liberación son internos: requieren una credencial técnica de un minuto firmada por `entradas-service`. Los JWT de usuarios (incluido ADMIN) no autorizan esas rutas. Ambos servicios deben compartir `EVENTOS_SERVICE_TOKEN_SECRET`, distinto de `JWT_SECRET`.

## Reglas de negocio

- Estados: `PUBLICADO`, `AGOTADO`, `CANCELADO`, `FINALIZADO`. El cliente no puede indicar `estado` ni `disponibles`: los administra el servicio.
- No se reserva aforo si el evento no está `PUBLICADO` o ya pasó.
- `0 ≤ disponibles ≤ aforoTotal` siempre. Al llegar a 0 pasa a `AGOTADO`; al liberar vuelve a `PUBLICADO`.
- El aforo total no puede bajar de lo ya vendido.
- Un evento `CANCELADO` o `FINALIZADO` no se modifica. Sí se puede liberar aforo en un evento cancelado (compensación).
- `reservar-aforo` y `liberar-aforo` son **idempotentes por `referencia`** (el `ordenId` de entradas-service).

## Concurrencia: cómo se garantiza no vender de más

1. **Lock por evento en Redis** (`lock:evento:{id}`), con `SET NX PX`: solo un pedido a la vez modifica un evento. Si está ocupado se responde `423`. Cancelar, finalizar y modificar el evento usan el **mismo** lock.
2. **TTL** (`LOCK_TTL_MS`): si el proceso se cae con el lock tomado, expira solo.
3. **Liberación segura:** se libera con un script Lua que compara el token y borra en un solo paso, para no borrar el lock de otro pedido si el propio expiró.
4. **Descuento atómico y condicional en MongoDB** (`disponibles >= cantidad`, estado `PUBLICADO`, fecha futura): segunda defensa. Aunque el lock fallara (por ejemplo, vencido el TTL), la base nunca deja `disponibles` en negativo.

## Comportamiento ante fallos

| Situación | Respuesta |
|---|---|
| Redis no disponible | `503 REDIS_NO_DISPONIBLE`; el servicio sigue vivo y reconecta solo |
| MongoDB no disponible | `503 DB_NO_DISPONIBLE`; el servicio sigue vivo y reconecta solo |
| Arranque con dependencias todavía no listas | El servicio arranca igual; `/health` da 200 y `/ready` da 503 hasta que estén |
| Caída del proceso con un lock tomado | El lock expira por TTL |

El orden de las operaciones está pensado para fallar del lado seguro (se puede vender de menos, nunca de más): al reservar primero se descuenta y después se registra el movimiento; al liberar primero se registra y después se suma.

## Cambios respecto del TP5

| Cambio | Motivo |
|---|---|
| `GET /eventos/:id` devuelve además `vendible` y `estado` (a más de `vigente`) | Que Entradas no tenga que replicar la regla "PUBLICADO y futuro". Es un agregado compatible con el contrato anterior |
| Nuevo `PATCH /eventos/:id/finalizar` | Sin él, el estado `FINALIZADO` sería inalcanzable |
| Nuevo `GET /ready` | Distinguir "proceso activo" (`/health`) de "dependencias disponibles" |
| El lock se libera con script Lua | El `GET` + `DEL` del TP4 podía borrar el lock de otro pedido |
| La espera de 2 s de la demo del TP2 no se migra | Era solo para mostrar la exclusión mutua |

## Estructura

```text
src/
  routes/          rutas -> controladores
  controllers/     adaptación HTTP
  services/        reglas de negocio (aforo.service, eventos.service, validaciones)
  repositories/    acceso a MongoDB (único lugar que conoce Mongoose)
  lock/            lock distribuido con Redis
  models/          esquemas de Mongoose (Evento, MovimientoAforo)
  config/          configuración, logger, errores, conexiones
  docs/            contrato OpenAPI
  container.js     arma las piezas reales
  app.js           Express
  server.js        arranque y apagado ordenado
scripts/seed.js    datos de prueba
test/              pruebas
```

Los servicios reciben sus dependencias (repositorios y lock) por parámetro: por eso las reglas se prueban sin MongoDB, y el lock se prueba contra un Redis real.

## Para el Dockerfile

- Arrancar con `CMD ["node", "src/server.js"]` (y no `npm start`) para que `SIGTERM` llegue al proceso y se cierre ordenadamente.
- Healthcheck de Compose con `/health` (liveness) o `/ready` (si se quiere esperar a Mongo y Redis), usando `node` + `fetch`, sin `curl`.
