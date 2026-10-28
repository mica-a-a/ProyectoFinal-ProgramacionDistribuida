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
| `BCRYPT_ROUNDS` | `12` | Costo de bcrypt para las contraseñas |
| `JWT_SECRET` | *(sin valor)* | **Obligatoria.** Secreto de firma, mínimo 32 caracteres. Si falta o es corto, el servicio **no arranca**. Generar: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `1h` | Vida del token: entero positivo con unidad opcional (`900` = segundos, `30m`, `1h`, `2d`). Default 1 h. Un valor inválido o `0` hace fallar el arranque |
| `JWT_ISSUER` | `usuarios-service` | Valor del claim `iss` |

## Endpoints

Swagger UI: `http://localhost:3001/api-docs`

| Método | Ruta | Descripción | Respuestas |
|---|---|---|---|
| GET | `/health` | Estado del proceso | 200 |
| POST | `/auth/login` | Valida credenciales y emite un JWT | 200, 400, 401, 403, 503 |
| GET | `/usuarios` | Lista (filtro opcional `?activo=true\|false`) | 200, 503 |
| GET | `/usuarios/:id` | Consulta un usuario (lo usa `entradas-service`) | 200, 400, 404, 503 |
| POST | `/usuarios` | Alta (queda `activo=true`) | 201, 400, 409, 503 |
| PUT | `/usuarios/:id` | Modifica datos personales (no toca `activo`) | 200, 400, 404, 409, 503 |
| DELETE | `/usuarios/:id` | **Baja lógica** (`activo=false`), idempotente | 200, 400, 404, 503 |

### Modelo

`id`, `nombre`, `apellido`, `email` (único), `dni` (único, 7-8 dígitos), `fechaNacimiento` (`YYYY-MM-DD`), `direccion` (opcional), `activo`, `createdAt`, `updatedAt`. La `edad` se **calcula** a partir de la fecha de nacimiento y no se guarda.

### Login y JWT (`POST /auth/login`)

```bash
curl -X POST localhost:3001/auth/login -H "content-type: application/json" \
  -d '{"email":"lucia.fernandez@example.com","password":"<SEED_USER_PASSWORD>"}'
# 200 -> { "token": "eyJ...", "tokenType": "Bearer", "expiresIn": 3600 }
```

| Situación | Respuesta |
|---|---|
| Credenciales válidas | **200** `{ token, tokenType, expiresIn }` |
| Usuario inexistente **o** contraseña incorrecta (o usuario sin credenciales) | **401** `CREDENCIALES_INVALIDAS`, el mismo cuerpo en todos los casos |
| Cuenta deshabilitada **con contraseña correcta** | **403** `CUENTA_DESHABILITADA` |
| Email/contraseña ausentes, vacíos o de tipo incorrecto, JSON roto | **400** `VALIDACION` |
| Base no disponible | 503 `DB_NO_DISPONIBLE` |

**Política de cuenta deshabilitada:** se responde 403 solo *después* de validar la contraseña. Con contraseña incorrecta se responde el 401 genérico, así quien no conoce las credenciales no puede averiguar si una cuenta existe o está dada de baja. Para que usuario inexistente y contraseña incorrecta tampoco se distingan por tiempo de respuesta, se compara siempre contra un hash (uno de relleno si el usuario no existe).

**Token (JWT):**

| Aspecto | Valor |
|---|---|
| Algoritmo | **HS256**, fijo en el código (`config.jwtAlgorithm`) y usado **tanto al firmar como al verificar** (`algorithms: ['HS256']`). No es configurable ni se lee del header del token |
| Claims | `sub` (id del usuario), `role` (`USER`/`ADMIN`), `iat`, `exp`, `iss` |
| `role` | Sale **siempre de la base de datos**. El cuerpo del login solo se lee para `email` y `password`; cualquier `role`, `sub` o `activo` enviado por el cliente se ignora |
| No incluye | Contraseña, hash, secreto ni datos personales (ni email ni DNI) |
| Vencimiento | `JWT_EXPIRES_IN` (default 1 h). **No existen tokens sin `exp`**: se emite siempre con vencimiento, y la verificación rechaza cualquier token que no lo tenga |
| Verificación | `services/token.service.js` → `verificar(token)`. Rechaza (401): sin firma (`alg: none`), otro algoritmo (HS384/HS512/RS256…), otra clave, payload alterado, sin `exp`, vencido (`TOKEN_VENCIDO`), otro emisor, sin `sub` o con `role` inválido (`TOKEN_INVALIDO`) |
| Respuesta | Lleva `Cache-Control: no-store` |

El secreto nunca se escribe en el código, en los Dockerfile ni en el log (tampoco la contraseña ni el token).

### Errores

Todos devuelven `{ message, code }` (y `errors: [...]` en validación). Códigos: `VALIDACION`, `CREDENCIALES_INVALIDAS`, `CUENTA_DESHABILITADA`, `ID_INVALIDO`, `USUARIO_NO_ENCONTRADO`, `EMAIL_DUPLICADO`, `DNI_DUPLICADO`, `DB_NO_DISPONIBLE`.

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
  services/      reglas de negocio (validacion.js son funciones puras), auth.service.js (registro y login),
                 token.service.js (emisión y verificación de JWT) y traducción de errores
  models/        modelo Mongoose propio (colección usuarios)
  clients/       vacío a propósito: este servicio no invoca a otros
  config/        config, logger, errores y conexión a Mongo con reintentos
  docs/          contrato OpenAPI
  app.js         armado de Express
  server.js      arranque
scripts/seed.js  datos de prueba
test/            pruebas (node:test; login.test.js cubre login y JWT)
```
