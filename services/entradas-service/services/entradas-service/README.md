# entradas-service

**Responsabilidad:** gestionar la compra de entradas de cada usuario y el ciclo de vida de cada ticket (órdenes de compra y tickets de uso único).

La definición completa (reglas de negocio, datos propios, endpoints, dependencias y límites) está en [`docs/arquitectura.md`](../../docs/arquitectura.md), sección 5.1; los contratos con los otros servicios, en la sección 7. Este servicio es una aplicación independiente: tiene su propio `package.json`, configuración y punto de inicio.

## Ejecución local (sin Docker)

Requisitos: Node.js >= 20.19 y MongoDB corriendo en la PC (por defecto `127.0.0.1:27017`).

```bash
cd services/entradas-service
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
npm install
npm start
```

- Swagger UI: `http://localhost:3003/api-docs`
- Health: `http://localhost:3003/health` -> `{ "service": "entradas-service", "status": "ok" }`

## Variables de entorno

| Variable | Ejemplo (local) | Descripción |
|---|---|---|
| `SERVICE_NAME` | `entradas-service` | Nombre que aparece en los logs y en /health |
| `PORT` | `3003` | Puerto de la aplicación (local). En Compose es 3000 por dentro |
| `LOG_LEVEL` | `info` | Nivel de log |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/entradas` | Base propia del servicio (Compose: `mongodb://entradas-db:27017/entradas`) |
| `USUARIOS_SERVICE_URL` | `http://localhost:3001` | URL base de usuarios-service (Compose: `http://usuarios-service:3000`) |
| `EVENTOS_SERVICE_URL` | `http://localhost:3002` | URL base de eventos-service (Compose: `http://eventos-service:3000`) |
| `REQUEST_TIMEOUT_MS` | `3000` | Timeout de las llamadas HTTP a otros servicios |
| `MAX_ENTRADAS_POR_USUARIO` | `4` | Máximo de entradas por usuario por evento |
| `PLAZO_CANCELACION_HORAS` | `24` | Horas antes del evento hasta las que se puede cancelar |

Si falta `MONGODB_URI`, `USUARIOS_SERVICE_URL` o `EVENTOS_SERVICE_URL`, el servicio no arranca y lo informa en el log. El código no usa `localhost` ni IPs fijas: el mismo código corre local o en Docker Compose cambiando solo estas variables.

## Endpoints

| Método | Ruta | Descripción | Códigos |
|---|---|---|---|
| GET | `/health` | Estado del servicio | 200 |
| GET | `/api-docs` | Swagger UI | 200 |
| POST | `/ordenes` | Comprar entradas | 201, 400, 404, 409, 423, 502, 503 |
| GET | `/ordenes/:id` | Consultar una orden y sus tickets | 200, 400, 404, 503 |
| DELETE | `/ordenes/:id` | Cancelar una orden | 200, 400, 404, 409, 502, 503 |
| GET | `/entradas?usuarioId=` | Listar los tickets de un usuario | 200, 400, 503 |
| POST | `/entradas/validar` | Validar un ticket en el ingreso | 200, 400, 404, 409, 422, 503 |

El contrato detallado (cuerpos, ejemplos y códigos de error) está en Swagger.

## Qué espera Entradas de los otros servicios

| Servicio | Endpoint | Lo que usa Entradas |
|---|---|---|
| usuarios-service | `GET /usuarios/:id` | `404` si no existe. Campo `activo` (si es `false` rechaza la compra; si no viene, se considera activo) |
| eventos-service | `GET /eventos/:id` | `precio` (número), `fecha` (ISO), `vigente` (booleano). `404` si no existe |
| eventos-service | `POST /eventos/:id/reservar-aforo` | Body `{ cantidad, referencia }`. `200` si reservó (idempotente por `referencia`); `409` sin aforo o evento no vendible; `423` lock ocupado |
| eventos-service | `POST /eventos/:id/liberar-aforo` | Body `{ cantidad, referencia }`. `200`; repetir la misma `referencia` no vuelve a sumar |

Los errores remotos pueden traer `{ "message": "..." }`; si lo traen, Entradas lo propaga en los `409` y `404`. Los ids de usuario y de evento se tratan como texto opaco (referencias lógicas).

## Comportamiento ante fallos de dependencias

| Situación remota | Resultado en Entradas |
|---|---|
| `404` (usuario o evento inexistente) | `404` funcional, orden `RECHAZADA` |
| `409` (sin aforo, evento no vendible) | `409` propagado, orden `RECHAZADA` |
| `423` (lock ocupado) | Se reintenta 3 veces (150 ms); si persiste, `423` y orden `RECHAZADA` |
| Timeout, DNS, conexión rechazada | `503`; la orden queda `RECHAZADA` y no se descuenta aforo (si falló al reservar, ver "fallo parcial") |
| `5xx` remoto | `503` |
| `4xx` inesperado (por ejemplo `400`) | `502` (el servicio remoto rechazó nuestro pedido) |

Además: sin base de datos, las rutas de negocio responden `503 DB_NO_DISPONIBLE`, pero `/health` y `/api-docs` siguen respondiendo. El servicio arranca aunque MongoDB todavía no esté lista y reintenta la conexión.

## Análisis de fallo parcial: comprar entradas

Participan, en este orden: Entradas (crea la orden `PENDIENTE`) -> Usuarios (verifica) -> Eventos (precio) -> Eventos (`reservar-aforo`) -> Entradas (emite tickets y confirma).

| Etapa que falla | Estado resultante | ¿Inconsistencia? |
|---|---|---|
| Usuarios o Eventos (consulta) | Orden `RECHAZADA`, aforo intacto | No |
| `reservar-aforo` responde `409`/`404`/`423` | Orden `RECHAZADA`, aforo intacto | No |
| `reservar-aforo` sin respuesta (timeout o `5xx`) | Orden `PENDIENTE` | **Posible**: Eventos pudo haber descontado el aforo sin que Entradas lo sepa |
| Emisión de tickets o confirmación (error de base) | Se intenta `liberar-aforo`; si sale bien, orden `RECHAZADA`; si no, `PENDIENTE` | Posible si la compensación también falla |

Para detectar, recuperar o compensar en una evolución futura alcanza con las órdenes `PENDIENTE` y su `id`: ese mismo `id` es la `referencia` idempotente, así que se puede reconsultar o repetir `reservar-aforo` (no duplica el descuento) o llamar a `liberar-aforo`. Mientras una orden está `PENDIENTE` cuenta para el máximo por usuario, porque podría tener aforo reservado.

## Datos de prueba reproducibles

La base se crea sola al primer uso. Para volver a un estado inicial conocido, borrar la base `entradas`:

```bash
mongosh "mongodb://127.0.0.1:27017/entradas" --eval "db.dropDatabase()"
```

Para probar sin esperar a los otros servicios hay **servicios simulados** que respetan los contratos:

```bash
npm run mocks     # usuarios (u1, u2 activos; u3 inactivo) en :3001 y eventos (e1 a e4) en :3002
```

| Evento simulado | Para probar |
|---|---|
| `e1` | Compra y cancelación normales (aforo 10) |
| `e2` | Empieza en 2 horas: cancelar da `409 FUERA_DE_PLAZO` |
| `e3` | Cancelado: comprar da `409` y validar da `422` |
| `e4` | Aforo 2: comprar 3 da `409 SIN_AFORO` |

## Pruebas automáticas

```bash
npm test
```

Ejecutan Entradas contra usuarios y eventos simulados y modelos en memoria (no requieren MongoDB ni Docker). Cubren compra, reglas de negocio, cancelación, validación de tickets (incluido el uso simultáneo), timeouts, servicio caído y recuperación, y el fallo parcial.

## Estructura

```text
src/
  routes/        rutas y asociación con controladores
  controllers/   adaptación HTTP: request y response
  services/      reglas de negocio (órdenes, entradas, traducción de errores remotos)
  clients/       llamadas HTTP a usuarios-service y eventos-service (con timeout)
  models/        modelos de Mongoose propios (Orden, Ticket)
  config/        configuración, logger, errores, conexión a MongoDB
  docs/          contrato OpenAPI
  app.js         armado de Express
  server.js      arranque
test/            pruebas con servicios simulados
scripts/         servicios simulados para pruebas manuales
```
