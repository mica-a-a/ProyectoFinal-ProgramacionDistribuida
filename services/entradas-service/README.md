# entradas-service

**Responsabilidad:** Órdenes de compra y tickets de uso único.

La definición completa (reglas de negocio, datos propios, endpoints, dependencias y límites) está en [`docs/arquitectura.md`](../../docs/arquitectura.md), sección 5.1. Este servicio es una aplicación independiente: tiene su propio `package.json`, configuración y punto de inicio.

## Ejecución local

```bash
cd services/entradas-service
cp .env.example .env
npm install
npm start
```

## Variables de entorno

| Variable | Ejemplo (local) | Descripción |
|---|---|---|
| `SERVICE_NAME` | `entradas-service` | Nombre que aparece en los logs y en /health |
| `PORT` | `3003` | Puerto de la aplicación (local). En Compose es 3000 por dentro |
| `LOG_LEVEL` | `info` | Nivel de log |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/entradas` | Base propia del servicio (Compose: mongodb://entradas-db:27017/entradas) |
| `USUARIOS_SERVICE_URL` | `http://localhost:3001` | URL base de usuarios-service (Compose: http://usuarios-service:3000) |
| `EVENTOS_SERVICE_URL` | `http://localhost:3002` | URL base de eventos-service (Compose: http://eventos-service:3000) |
| `REQUEST_TIMEOUT_MS` | `3000` | Timeout de las llamadas HTTP a otros servicios |
| `MAX_ENTRADAS_POR_USUARIO` | `4` | Máximo de entradas por usuario por evento |
| `PLAZO_CANCELACION_HORAS` | `24` | Horas antes del evento hasta las que se puede cancelar |

## Endpoints

| Método | Ruta | Estado |
|---|---|---|
| GET | `/health` | Implementado |
| GET | `/api-docs` | Swagger UI, implementado |

Los endpoints propios del servicio se agregan acá y en `src/docs/openapi.js` a medida que se implementan.

## Estructura

```text
src/
  routes/        rutas y asociación con controladores
  controllers/   adaptación HTTP: request y response
  services/      reglas de negocio
  clients/       llamadas HTTP a usuarios-service y eventos-service
  models/        modelos de persistencia propios
  config/        configuración, logger y errores
  docs/          contrato OpenAPI
  app.js         armado de Express
  server.js      arranque
```
