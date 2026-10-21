# usuarios-service

**Responsabilidad:** identidad y datos personales de las personas registradas. Es la **única autoridad** sobre el perfil de un usuario y sobre si está activo. No depende de ningún otro servicio.

Definición completa (reglas, datos, límites): [`docs/arquitectura.md`](../../docs/arquitectura.md), sección 5.1.

## Ejecución local

```bash
cd services/usuarios-service
cp .env.example .env      # en Windows: copy .env.example .env
npm install
npm start                 # requiere MongoDB en MONGODB_URI
npm test                  # no necesita MongoDB
npm run seed              # opcional: carga datos de prueba conocidos
```

## Variables de entorno

| Variable | Ejemplo (local) | Descripción |
|---|---|---|
| `SERVICE_NAME` | `usuarios-service` | Nombre que aparece en los logs y en `/health` |
| `PORT` | `3001` | Puerto de la aplicación (local). En Compose es 3000 por dentro |
| `LOG_LEVEL` | `info` | Nivel de log |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/usuarios` | Base propia. Compose: `mongodb://usuarios-db:27017/usuarios` |
| `MONGODB_RETRY_MS` | `3000` | Reintento de la conexión inicial a Mongo |
| `MONGODB_TIMEOUT_MS` | `3000` | Tiempo máximo para encontrar Mongo antes de fallar |

## Endpoints

Swagger UI: `http://localhost:3001/api-docs`

| Método | Ruta | Descripción | Respuestas |
|---|---|---|---|
| GET | `/health` | Estado del proceso | 200 |
| GET | `/usuarios` | Lista (filtro opcional `?activo=true\|false`) | 200, 503 |
| GET | `/usuarios/:id` | Consulta un usuario (lo usa `entradas-service`) | 200, 400, 404, 503 |
| POST | `/usuarios` | Alta (queda `activo=true`) | 201, 400, 409, 503 |
| PUT | `/usuarios/:id` | Modifica datos personales (no toca `activo`) | 200, 400, 404, 409, 503 |
| DELETE | `/usuarios/:id` | **Baja lógica** (`activo=false`), idempotente | 200, 400, 404, 503 |

### Modelo

`id`, `nombre`, `apellido`, `email` (único), `dni` (único, 7-8 dígitos), `fechaNacimiento` (`YYYY-MM-DD`), `direccion` (opcional), `activo`, `createdAt`, `updatedAt`. La `edad` se **calcula** a partir de la fecha de nacimiento y no se guarda.

### Errores

Todos devuelven `{ message, code }` (y `errors: [...]` en validación). Códigos: `VALIDACION`, `ID_INVALIDO`, `USUARIO_NO_ENCONTRADO`, `EMAIL_DUPLICADO`, `DNI_DUPLICADO`, `DB_NO_DISPONIBLE`.

## Comportamiento si MongoDB no está disponible

El servicio **abre el puerto primero** y conecta a Mongo en segundo plano con reintentos. Mientras no haya conexión: `/health` y `/api-docs` responden normalmente y los endpoints de `/usuarios` devuelven **503** `DB_NO_DISPONIBLE`. Cuando Mongo vuelve, el servicio se recupera solo, sin reiniciarse.

## Prueba manual rápida

```bash
curl -X POST localhost:3001/usuarios -H "content-type: application/json" \
  -d '{"nombre":"Ana","apellido":"Lopez","email":"ana@example.com","dni":"31222333","fechaNacimiento":"1992-07-21"}'
curl localhost:3001/usuarios
curl -X DELETE localhost:3001/usuarios/<id>      # baja lógica
```

## Datos de prueba

`npm run seed` borra la colección `usuarios` y carga 5 usuarios con **IDs fijos** (`64b000000000000000000001` a `...05`; el `...04` está inactivo, útil para probar que `entradas-service` rechaza compradores dados de baja). En Docker: `docker compose run --rm usuarios-service npm run seed`.

## Docker

```bash
docker build -t grupo2/usuarios-service:tp6 .
docker run --rm -p 3001:3000 -e PORT=3000 -e MONGODB_URI=mongodb://host.docker.internal:27017/usuarios grupo2/usuarios-service:tp6
```

## Estructura

```text
src/
  routes/        rutas; el chequeo "base disponible" aplica solo a /usuarios
  controllers/   adaptación HTTP (request -> service -> response)
  services/      reglas de negocio (validacion.js son funciones puras) y traducción de errores
  models/        modelo Mongoose propio (colección usuarios)
  clients/       vacío a propósito: este servicio no invoca a otros
  config/        config, logger, errores y conexión a Mongo con reintentos
  docs/          contrato OpenAPI
  app.js         armado de Express
  server.js      arranque
scripts/seed.js  datos de prueba
test/            pruebas (node:test, sin dependencias extra)
```
