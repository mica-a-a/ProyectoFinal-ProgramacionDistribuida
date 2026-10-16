# eventos-service

**Responsabilidad:** Eventos y control de aforo (lock por evento en Redis).

La definición completa (reglas de negocio, datos propios, endpoints, dependencias y límites) está en [`docs/arquitectura.md`](../../docs/arquitectura.md), sección 5.1. Este servicio es una aplicación independiente: tiene su propio `package.json`, configuración y punto de inicio.

## Ejecución local

```bash
cd services/eventos-service
cp .env.example .env
npm install
npm start
```

## Variables de entorno

| Variable | Ejemplo (local) | Descripción |
|---|---|---|
| `SERVICE_NAME` | `eventos-service` | Nombre que aparece en los logs y en /health |
| `PORT` | `3002` | Puerto de la aplicación (local). En Compose es 3000 por dentro |
| `LOG_LEVEL` | `info` | Nivel de log |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/eventos` | Base propia del servicio (Compose: mongodb://eventos-db:27017/eventos) |
| `REDIS_URL` | `redis://localhost:6379` | Redis para el lock por evento (Compose: redis://redis:6379) |
| `LOCK_TTL_MS` | `5000` | TTL del lock de aforo en milisegundos |

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
  clients/       (vacío: este servicio no invoca a otros)
  models/        modelos de persistencia propios
  config/        configuración, logger y errores
  docs/          contrato OpenAPI
  app.js         armado de Express
  server.js      arranque
```
