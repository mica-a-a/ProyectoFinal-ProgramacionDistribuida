# usuarios-service

**Responsabilidad:** Identidad y datos personales de las personas registradas.

La definición completa (reglas de negocio, datos propios, endpoints, dependencias y límites) está en [`docs/arquitectura.md`](../../docs/arquitectura.md), sección 5.1. Este servicio es una aplicación independiente: tiene su propio `package.json`, configuración y punto de inicio.

## Ejecución local

```bash
cd services/usuarios-service
cp .env.example .env
npm install
npm start
```

## Variables de entorno

| Variable | Ejemplo (local) | Descripción |
|---|---|---|
| `SERVICE_NAME` | `usuarios-service` | Nombre que aparece en los logs y en /health |
| `PORT` | `3001` | Puerto de la aplicación (local). En Compose es 3000 por dentro |
| `LOG_LEVEL` | `info` | Nivel de log |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/usuarios` | Base propia del servicio (Compose: mongodb://usuarios-db:27017/usuarios) |

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
