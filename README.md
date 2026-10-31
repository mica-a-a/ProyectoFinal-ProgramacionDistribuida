# ProyectoFinal-ProgramacionDistribuida

**Materia:** Programación Distribuida · Licenciatura en Sistemas de Información (UCH)
**Proyecto elegido:** Eventos y Entradas (TP5: diseño · TP6: implementación con Docker)

## Integrantes

| Apellido y Nombre | Usuario de GitHub |
|-------------------|-------------------|
| `Bazan Franco` | `francobazan11` |
| `Gorri Juan` | `jnahuelgorrig` |
| `Le Donne Micaela` | `mica-a-a` |
| `Molina Agostina` | `molinagos` |
| `Nievas Milagros` | `milinievas` |

**Grupo:** `2`

**Docentes agregados como colaboradores:** alvarezadriel@uch.edu.ar · cortezedgardo@uch.edu.ar

## De qué trata

Sistema de venta de entradas para eventos con aforo limitado. Los usuarios registrados compran entradas, reciben un ticket y lo presentan en el ingreso, donde se valida. El sistema garantiza tres cosas:

1. **No se vende más que el aforo** (lock en Redis + descuento atómico).
2. **Solo compran usuarios válidos**, con un máximo de entradas por persona.
3. **Cada entrada se usa una sola vez.**

El repositorio parte de la API REST de Usuarios de los trabajos anteriores (`app-base/`, versión del TP4) y la evoluciona a **tres microservicios** ejecutables con Docker Compose. El diseño y su justificación están en [`docs/arquitectura.md`](docs/arquitectura.md); los cambios entre el diseño (TP5) y lo implementado (TP6) están en su [sección 11](docs/arquitectura.md#11-tp6-arquitectura-implementada-y-cambios-respecto-del-tp5). El TP7 agrega **identidad y control de acceso con JWT** sin cambiar la topología: ver [Seguridad](#seguridad-identidad-jwt-y-roles-tp7) y la [sección 12](docs/arquitectura.md#12-tp7-identidad-y-control-de-acceso).

## Arquitectura implementada

```text
Cliente ──► usuarios-service :3001 ──► usuarios-db (MongoDB)
   │
   ├──────► entradas-service :3003 ──► entradas-db (MongoDB)
   │              │   │
   │              │   └── GET /usuarios/:id ──► usuarios-service
   │              └────── GET /eventos/:id, POST /eventos/:id/reservar-aforo|liberar-aforo ──┐
   │                                                                                       ▼
   └──────► eventos-service :3002 ◄────────────────────────────────────────────────────────┘
                   │
                   ├──► eventos-db (MongoDB)
                   └──► redis (lock del aforo)
```

| Servicio | Responsabilidad | Datos propios | Depende de |
|---|---|---|---|
| `usuarios-service` | Identidad de las personas: alta, consulta, modificación y baja lógica. DNI y email únicos | `usuarios` | Nada |
| `eventos-service` | Eventos y aforo. Única autoridad sobre cuántos lugares quedan (lock por evento, reserva y liberación idempotentes) | `eventos`, `movimientos de aforo`, locks en Redis | Nada |
| `entradas-service` | Compra, órdenes y tickets: máximo por usuario, ticket de uso único, cancelación con plazo | `ordenes`, `tickets` | `usuarios-service` y `eventos-service`, solo por HTTP |

Reglas de la arquitectura: solo Entradas llama a los otros dos (no hay dependencias circulares), cada servicio tiene su propia base y nadie lee ni escribe datos de otro. Entradas guarda `usuarioId` y `eventoId` solo como referencias lógicas.

## Seguridad: identidad, JWT y roles (TP7)

**Componente responsable de identidad:** `usuarios-service`. Es la **única autoridad sobre las credenciales** (guarda el hash de la contraseña) y el **único que emite tokens**. Ningún otro servicio consulta su base. No se creó un cuarto servicio: Usuarios ya era el dueño de las personas (justificación en [`docs/tp7-hito1-seguridad.md`](docs/tp7-hito1-seguridad.md)).

| Aspecto | Decisión |
|---|---|
| Contraseñas | Hash **bcrypt** (`bcryptjs`), costo `BCRYPT_ROUNDS` (12 por defecto), salt manejado por la biblioteca. Nunca se guardan, devuelven ni loguean en texto plano |
| Token | **JWT HS256** (clave simétrica `JWT_SECRET`, mínimo 32 caracteres). Claims: `sub`, `role`, `iat`, `exp`, `iss`. No lleva contraseña, hash ni datos personales |
| Vencimiento | Todo token vence: `JWT_EXPIRES_IN` (1 h por defecto). No hay tokens sin `exp` |
| Validación | Cada servicio verifica la firma, el algoritmo, el emisor y el vencimiento **localmente** (sin consultar a Usuarios), con el mismo middleware |
| Roles | `USER` y `ADMIN` (campo `role`). El registro **siempre** crea `USER`; el cliente nunca elige su rol. Un `ADMIN` se crea por seed o con `POST /usuarios` (solo ADMIN) |
| Propiedad del recurso | Un `USER` solo ve y modifica lo suyo (perfil, órdenes y entradas); lo aplica el servicio dueño del recurso |
| Propagación | Entradas valida el token del cliente y lo **reenvía** a Usuarios y a Eventos. Detalle en [`docs/tp7-propagacion-token.md`](docs/tp7-propagacion-token.md) |

### Roles y permisos (resumen)

| Operación | Público | USER | ADMIN |
|---|:-:|:-:|:-:|
| `POST /auth/register`, `POST /auth/login`, `GET /health`, `/api-docs` | Sí | Sí | Sí |
| `GET /eventos`, `GET /eventos/:id` (catálogo) | Sí | Sí | Sí |
| Comprar, consultar y cancelar **sus** órdenes; listar **sus** entradas; ver y editar **su** perfil | No | Sí | Sí |
| Lo anterior sobre recursos **de otra persona** | No | No (403) | Sí |
| Crear, modificar, cancelar y finalizar eventos | No | No (403) | Sí |
| Listar, dar de alta y dar de baja usuarios; validar tickets en la puerta | No | No (403) | Sí |

La matriz completa por endpoint (27 endpoints) está en [`docs/tp7-hito1-seguridad.md`](docs/tp7-hito1-seguridad.md).

### Respuestas 401 y 403

| Código | Cuándo | `code` |
|---|---|---|
| **401** | No hay identidad válida | `TOKEN_AUSENTE`, `TOKEN_INVALIDO` (mal formado, firma inválida, algoritmo no esperado) o `TOKEN_VENCIDO`; en el login, `CREDENCIALES_INVALIDAS` (mismo mensaje si el usuario no existe o la contraseña es incorrecta) |
| **403** | Identidad válida sin permiso | `PERMISOS_INSUFICIENTES` (rol insuficiente o recurso ajeno); en el login, `CUENTA_DESHABILITADA` (solo si la contraseña es correcta) |
| 400 / 409 | Datos inválidos / usuario ya existente | `VALIDACION` / `EMAIL_DUPLICADO`, `DNI_DUPLICADO` |

### Registrar un usuario, iniciar sesión y usar el token

```bash
# 1) Registro (público): siempre crea un USER
curl -s -X POST http://localhost:3001/auth/register -H 'content-type: application/json' \
  -d '{"nombre":"Ana","apellido":"Lopez","email":"ana@example.com","dni":"31222333","fechaNacimiento":"1992-07-21","password":"Clave-Segura-1"}'

# 2) Login: devuelve { "token": "...", "tokenType": "Bearer", "expiresIn": 3600 }
curl -s -X POST http://localhost:3001/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"Clave-Segura-1"}'

# 3) Usar el token en cualquier servicio
curl -s http://localhost:3001/usuarios/<id> -H 'Authorization: Bearer <token>'
```

En PowerShell:

```powershell
$cuerpo = @{ email = 'ana@example.com'; password = 'Clave-Segura-1' } | ConvertTo-Json
$token = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login -ContentType 'application/json' -Body $cuerpo).token
Invoke-RestMethod -Uri http://localhost:3001/usuarios/<id> -Headers @{ Authorization = "Bearer $token" }
```

**Usuarios de prueba** (los crea `npm run seed`): `admin@example.com` (rol `ADMIN`, contraseña `SEED_ADMIN_PASSWORD`) y cinco usuarios `USER` (por ejemplo `lucia.fernandez@example.com`, contraseña `SEED_USER_PASSWORD`). Las contraseñas salen del `.env`; en `.env.example` hay valores ficticios.

### Probar los endpoints protegidos desde Swagger

1. Abrir el Swagger de Usuarios: http://localhost:3001/api-docs.
2. `POST /auth/login` → **Try it out** → enviar las credenciales → copiar el valor de `token`.
3. Botón **Authorize** (arriba a la derecha) → pegar **solo el token** (sin la palabra `Bearer`) → **Authorize**.
4. Ahora los endpoints con el candado 🔒 se pueden probar. El mismo token sirve en los Swagger de Eventos (http://localhost:3002/api-docs) y de Entradas (http://localhost:3003/api-docs); cada endpoint indica el rol que exige y sus respuestas 401 y 403.

### Secretos

`JWT_SECRET` es obligatorio y **no tiene valor por defecto**: `docker compose up` falla con un mensaje claro si falta. Se define una sola vez en el `.env` de la raíz y el Compose se lo entrega a los tres servicios. Ningún `.env` real, secreto ni token se versiona. Los logs registran `sub` y `role` de cada pedido autenticado, y nunca el token ni las contraseñas.

## Requisitos de software

- **Docker** (Docker Desktop con WSL 2 en Windows, o Docker Engine + plugin Compose en Linux) y Git.
- **Node.js 20.19 o superior**, solo para los scripts de pruebas, los tests unitarios y para ejecutar un servicio sin Docker (Entradas lo exige: `engines` de su `package.json`).
- Para ejecutar sin Docker: MongoDB y Redis (o Memurai en Windows).

### Verificar Docker

```bash
docker --version
docker compose version
docker info
docker run --rm hello-world
```

## Inicio rápido

```bash
git clone <URL del repositorio>
cd ProyectoFinal-ProgramacionDistribuida
cp .env.example .env              # Windows: copy .env.example .env
# Completar JWT_SECRET en el .env (OBLIGATORIO, mínimo 32 caracteres). Para generar uno:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
docker compose up --build -d      # construye e inicia toda la solución
docker compose ps                 # los 7 contenedores deben figurar "healthy"
docker compose exec -T usuarios-service npm run seed   # usuarios y administrador de prueba
docker compose exec -T eventos-service npm run seed    # eventos de prueba
```

En PowerShell, para escribir el secreto en el `.env` sin abrir el archivo:

```powershell
$secreto = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
(Get-Content .env) -replace '^JWT_SECRET=.*', "JWT_SECRET=$secreto" | Set-Content .env
```

Sin `JWT_SECRET`, `docker compose up` se detiene con el mensaje `required variable JWT_SECRET is missing a value`.

> **Guía paso a paso** (con y sin Docker), pruebas manuales y automáticas con los resultados esperados, y solución de problemas: [`docs/guia-instalacion-y-pruebas.md`](docs/guia-instalacion-y-pruebas.md).

### Puertos publicados hacia tu PC y URLs

Cada contenedor escucha en el puerto interno `3000`. Solo estos puertos se publican (las bases y Redis no):

| Servicio | URL base | Health | Swagger UI |
|---|---|---|---|
| `usuarios-service` | http://localhost:3001 | http://localhost:3001/health | http://localhost:3001/api-docs |
| `eventos-service` | http://localhost:3002 | http://localhost:3002/health · `/ready` (Mongo y Redis) | http://localhost:3002/api-docs |
| `entradas-service` | http://localhost:3003 | http://localhost:3003/health | http://localhost:3003/api-docs |

Si ya tenés algo en 3001 a 3003, cambiá `USUARIOS_HOST_PORT`, `EVENTOS_HOST_PORT` o `ENTRADAS_HOST_PORT` en el `.env`.

## Variables de entorno

- **`.env` de la raíz:** solo lo lee Docker Compose. Plantilla en [`.env.example`](.env.example): `IMAGE_PREFIX`, `LOG_LEVEL`, `*_HOST_PORT`, `JWT_SECRET` (obligatoria, sin default, mínimo 32 caracteres), `JWT_EXPIRES_IN` (default `1h`), `BCRYPT_ROUNDS` (default `12`), `SEED_USER_PASSWORD` y `SEED_ADMIN_PASSWORD` (contraseñas **ficticias** de los usuarios del seed), `LOCK_TTL_MS`, `REQUEST_TIMEOUT_MS`, `MAX_ENTRADAS_POR_USUARIO`, `PLAZO_CANCELACION_HORAS`.
- **`.env` de cada servicio** (solo para ejecución sin Docker): `services/<servicio>/.env.example`. Variables: `SERVICE_NAME`, `PORT`, `LOG_LEVEL`, `MONGODB_URI`, y según el servicio `REDIS_URL`, `LOCK_TTL_MS`, `USUARIOS_SERVICE_URL`, `EVENTOS_SERVICE_URL`, `REQUEST_TIMEOUT_MS`, `MAX_ENTRADAS_POR_USUARIO`, `PLAZO_CANCELACION_HORAS`.
- Para ejecutar un servicio **sin Docker** con `npm start`, el `.env` de cada servicio también necesita `JWT_SECRET` (el **mismo** valor en los tres) y, en Usuarios, `JWT_EXPIRES_IN`, `JWT_ISSUER` y `BCRYPT_ROUNDS`.
- Ningún `.env` real se sube a Git. No hay contraseñas, tokens ni claves en los Dockerfile, en el Compose ni en el código.

### Diferencias entre ejecución local y Docker Compose

El código es el mismo; cambia solo la configuración.

| Variable | Local (`npm start`) | Docker Compose |
|---|---|---|
| `PORT` | 3001 / 3002 / 3003 | 3000 (publicado como 3001 / 3002 / 3003) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/<base>` | `mongodb://<servicio>-db:27017/<base>` |
| `REDIS_URL` | `redis://localhost:6379` | `redis://redis:6379` |
| `USUARIOS_SERVICE_URL` | `http://localhost:3001` | `http://usuarios-service:3000` |
| `EVENTOS_SERVICE_URL` | `http://localhost:3002` | `http://eventos-service:3000` |

Dentro de un contenedor `localhost` es el propio contenedor, por eso nunca se usa para llegar a otro servicio.

### Nombres internos en la red Docker

| Origen | Destino | Dirección |
|---|---|---|
| entradas-service | usuarios-service | `http://usuarios-service:3000` |
| entradas-service | eventos-service | `http://eventos-service:3000` |
| cada servicio | su MongoDB | `mongodb://usuarios-db:27017/usuarios`, `eventos-db`, `entradas-db` |
| eventos-service | Redis | `redis://redis:6379` |

Redes: `tp6-net` (HTTP entre servicios) y una red privada por servicio con su base (`usuarios-net`, `eventos-net`, `entradas-net`). Un servicio ni siquiera puede resolver el nombre de la base de otro.

## Inicio y disponibilidad de dependencias

- Cada base y Redis tienen **healthcheck**, y cada servicio usa `depends_on` con `condition: service_healthy` sobre *sus* dependencias de arranque (su base y, en Eventos, Redis).
- Cada servicio tiene healthcheck propio sobre `/health`, con `fetch` de Node (la imagen Alpine no trae `curl`).
- **`entradas-service` no espera a Usuarios ni a Eventos a propósito:** debe poder arrancar y responder 503 si alguno falta.
- El orden de inicio no alcanza por sí solo: los tres servicios abren el puerto primero, conectan a su base con reintentos y responden 503 controlado mientras no esté lista.

### Comportamiento ante una dependencia indisponible

| Situación | Respuesta |
|---|---|
| `usuarios-service` caído | Entradas: `503 DEPENDENCIA_NO_DISPONIBLE` |
| `eventos-service` caído | Entradas: `503 DEPENDENCIA_NO_DISPONIBLE` |
| Redis caído | Eventos: `reservar-aforo` → `503 REDIS_NO_DISPONIBLE`. Entradas: `503 ORDEN_PENDIENTE`. Las lecturas siguen funcionando |
| Base propia caída | El servicio responde `503 DB_NO_DISPONIBLE`; `/health` y `/api-docs` siguen respondiendo |

Todos se recuperan solos cuando la dependencia vuelve, sin reiniciar el servicio. Los errores `404` y `409` del servicio remoto se tratan como errores funcionales (no como indisponibilidad).

## Volúmenes y persistencia

Cada MongoDB usa un volumen nombrado (`usuarios-data`, `eventos-data`, `entradas-data`, que Compose crea como `tp6-eventos-entradas_<nombre>`). Redis no lleva volumen: los locks tienen TTL y no hay nada que conservar.

```bash
docker compose down        # elimina contenedores y CONSERVA los datos
docker compose up -d       # los datos siguen ahí
docker compose down -v     # elimina contenedores y BORRA los volúmenes (reinicia los datos)
```

## Pruebas

### Pruebas del TP7 (seguridad)

Requieren la solución levantada y los seeds aplicados (ver *Inicio rápido*). Cada escenario imprime los comandos que ejecuta y guarda su salida en [`docs/evidencias/tp7/`](docs/evidencias/tp7/); los tokens, contraseñas y hashes salen **enmascarados**, así que las evidencias se pueden versionar.

```bash
node scripts/tp7/pruebas.js todo         # escenarios A a L de la consigna, con resumen
node scripts/tp7/pruebas.js C            # un escenario puntual (A..L)
node scripts/tp7/propagacion.js todo     # propagación del token, disponibilidad y logs sin secretos
cd services/<servicio> && npm test       # tests unitarios y de API de cada servicio
```

| Escenario | Qué demuestra |
|---|---|
| **A** Registro | Usuario creado sin contraseña ni hash en la respuesta; el cliente no puede elegir su rol |
| **B** Duplicado | `409` por email y por DNI repetidos |
| **C** Login válido | `200` con un JWT HS256 con `sub`, `role`, `iat`, `exp` e `iss`, y vencimiento |
| **D** Login inválido | `401` con password incorrecta (mismo mensaje que si el usuario no existe), `400`, y `403` si la cuenta está deshabilitada |
| **E** Sin token | `401 TOKEN_AUSENTE` en los tres servicios; lo público sigue público |
| **F** Token modificado | `401` ante payload alterado, firma de otra clave, `alg: none` y algoritmo no esperado |
| **G** Token vencido | `401 TOKEN_VENCIDO`; un token sin `exp` tampoco se acepta |
| **H** Sin rol suficiente | `403` para un USER en operaciones de ADMIN y sobre recursos de otro usuario |
| **I** Rol autorizado | Las operaciones de USER y de ADMIN se ejecutan correctamente |
| **J** Dos servicios | La identidad viaja Entradas → Usuarios/Eventos y queda en los logs de cada servicio |
| **K** Reinicio | Tras `docker compose down` y `up`, los usuarios persisten y el sistema vuelve a autenticar |
| **L** Persistencia | La contraseña está guardada como hash bcrypt y no en texto plano |

Detalle de la propagación, la disponibilidad ante la caída de Usuarios y las limitaciones asumidas en [`docs/tp7-propagacion-token.md`](docs/tp7-propagacion-token.md).

### Pruebas del TP6 (siguen vigentes)

Operan como el administrador del seed (necesitan `SEED_ADMIN_PASSWORD` en el `.env` y los seeds aplicados).

```bash
node scripts/tp6/pruebas.js              # lista las pruebas disponibles
node scripts/tp6/pruebas.js todo         # corre todas, en orden, y guarda la evidencia
node scripts/tp6/concurrencia.js         # 10 compras simultáneas sobre 3 lugares: sin sobreventa
cd services/<servicio> && npm test      # pruebas unitarias y de API de cada servicio
```

Cada prueba imprime los comandos que ejecuta y guarda su salida en `docs/evidencias/tp6/<prueba>.txt`. Detalle de cada una en [`docs/tp6-compose-y-pruebas.md`](docs/tp6-compose-y-pruebas.md).

| Prueba del TP6 | Comando |
|---|---|
| Build individual / Inicio con Compose / Health | `build` · `inicio` · `health` |
| CRUD, negocio y comunicación entre servicios | `negocio` |
| Propiedad de datos | `datos-propios` |
| Persistencia | `persistencia` |
| Fallo de dependencia | `fallo-dependencia` |
| Startup / disponibilidad | `fallo-db` · `fallo-redis` |
| Fallo parcial | `fallo-parcial` |
| Logs / Swagger / Datos de prueba | `logs` · `swagger` · `datos` |

### Datos de prueba

`node scripts/tp6/pruebas.js datos` deja siempre el mismo estado inicial (equivale a ejecutar `npm run seed` dentro de `usuarios-service` y `eventos-service`):

- **Usuarios:** 5 `USER`, con IDs fijos `64b000000000000000000001` a `05` (el `04` está inactivo), más el administrador `admin@example.com` (`ADMIN`, id `64b000000000000000000006`). Las contraseñas salen de `SEED_USER_PASSWORD` y `SEED_ADMIN_PASSWORD`.
- **Eventos:** 5 (Taller de Node.js con 5 lugares, Recital con 100, uno agotado, uno cancelado y uno finalizado).
- **Entradas:** sin órdenes ni tickets.

### Logs

Salen por stdout en JSON, con el nombre del servicio y el nivel en cada línea:

```bash
docker compose logs -f entradas-service
```

## Detener el entorno

```bash
docker compose down        # conserva los datos
docker compose down -v     # borra también los datos
```

## Cambios respecto de la propuesta del TP5

Resumen (detalle y motivos en [`docs/arquitectura.md` §11.2](docs/arquitectura.md#112-cambios-respecto-del-tp5)):

- **Raft no se migra:** es un mecanismo y no una responsabilidad de negocio; se conserva el lock de Redis.
- **HTTP en lugar de HTTPS:** los servicios escuchan HTTP, tanto entre contenedores (lo permite el TP6) como hacia el cliente en el laboratorio.
- **Usuarios:** campos nuevos (`dni`, `fechaNacimiento`, `direccion`, `activo`), baja lógica y prefijo `/usuarios` en lugar de `/users`.
- **Eventos:** `GET /eventos/:id` devuelve además `estado` y `vendible`; nuevos `PATCH /eventos/:id/finalizar` y `GET /ready`; el lock se libera con un script Lua.
- **Entradas:** el ticket tiene un estado más (`ANULADO`, para órdenes canceladas).
- **Infraestructura:** una base por servicio, redes segmentadas, healthchecks y volúmenes nombrados.

## Análisis del fallo parcial

Caso elegido: **comprar entradas** (Entradas crea la orden → Eventos reserva aforo → Entradas emite los tickets). Si falla Redis en la etapa intermedia, la orden queda `PENDIENTE`, sin tickets y con el aforo intacto: no hay datos corruptos, pero sí una orden "colgada". Hoy no hay recuperación automática: se resolvería reintentando `reservar-aforo` con la misma referencia (idempotente) o liberando el aforo. Análisis completo, con todas las etapas, en [`docs/arquitectura.md` §11.3](docs/arquitectura.md#113-análisis-del-fallo-parcial-compra-de-entradas).

## Estructura del repositorio

```text
ProyectoFinal-ProgramacionDistribuida/
├── README.md                       Este archivo
├── docker-compose.yml              Solución integrada (7 contenedores)
├── .env.example                    Variables de Docker Compose (sin valores sensibles)
├── .gitignore                      Excluye dependencias, .env, logs, claves y certificados
├── .github/pull_request_template.md
├── docs/
│   ├── arquitectura.md             Diseño (TP5) y arquitectura implementada (§11, TP6)
│   ├── diagrama-arquitectura.svg   Diagrama de arquitectura (también .png)
│   ├── tp6-hito1-ratificacion.md   Hito 1 del TP6
│   ├── tp6-compose-y-pruebas.md    Guía de Compose, configuración y pruebas
│   ├── flujo-git.md                Flujo de ramas, commits, PR y tags
│   └── evidencias/                 Capturas (Git, Docker) y salidas de pruebas (tp6/)
├── scripts/tp6/                    pruebas.js y concurrencia.js
├── services/
│   ├── usuarios-service/           Dockerfile, .dockerignore, src, test, README
│   ├── eventos-service/
│   └── entradas-service/
└── app-base/                       Versión funcional de partida (API del TP4)
```

Cada servicio tiene su propio README con endpoints, variables y reglas.

## Versión funcional de partida (`app-base/`)

Es la API del TP4 (HTTPS, MongoDB, Redis, Swagger y cluster de tres nodos con Raft). Requiere MongoDB, Redis y un certificado de desarrollo; instrucciones en [`app-base/BASE.md`](app-base/BASE.md). Es el punto de partida del TP5 y no forma parte de la solución con Docker Compose.

## Flujo de trabajo con Git

- La rama principal es `main`; no se desarrolla directamente sobre ella.
- Cada tarea se hace en una rama propia (`feature/...`, `docs/...`, `fix/...`) y se integra con **Pull Request** revisado por otro integrante.
- Los mensajes de commit describen cambios concretos.
- Cada entrega queda marcada con un tag (`tp5-entrega`, `tp6-entrega`, `tp7-entrega`).

Detalle en [`docs/flujo-git.md`](docs/flujo-git.md).

## Entregables del TP7 y dónde encontrarlos

| # | Requisito (sección 21) | Dónde está |
|---|------------------------|-----------|
| 1 | Integrantes del grupo | Sección *Integrantes* |
| 2 | Arquitectura actual y componente responsable de identidad | Sección *Seguridad* y [`docs/arquitectura.md` §12](docs/arquitectura.md#12-tp7-identidad-y-control-de-acceso) |
| 3 | Roles y permisos implementados | Sección *Roles y permisos* y [`docs/tp7-hito1-seguridad.md`](docs/tp7-hito1-seguridad.md) (matrices de las secciones 4, 10 y 11 de la consigna) |
| 4 | Variables de entorno necesarias | Sección *Variables de entorno* y [`.env.example`](.env.example) |
| 5 | Cómo iniciar la solución con Docker Compose | Sección *Inicio rápido* |
| 6 | Cómo registrar o dar de alta un usuario | *Registrar un usuario, iniciar sesión y usar el token* |
| 7 | Cómo realizar login | Ídem |
| 8 | Cómo usar el token en endpoints protegidos | Ídem y *Probar los endpoints protegidos desde Swagger* |
| 9 | Ubicación de Swagger/OpenAPI | `/api-docs` de cada servicio (`src/docs/openapi.js`), con esquema Bearer, roles y respuestas 401/403 |
| 10 | Cómo ejecutar las pruebas obligatorias | Sección *Pruebas del TP7* (escenarios A a L) |
| 11 | Decisiones de propagación y validación del JWT | [`docs/tp7-propagacion-token.md`](docs/tp7-propagacion-token.md) |
| 12 | Evidencias de las pruebas | [`docs/evidencias/tp7/`](docs/evidencias/tp7/) |
| 13 | Tag de entrega | `tp7-entrega` |
| 14 | Guía de instalación y pruebas | [`docs/guia-instalacion-y-pruebas.md`](docs/guia-instalacion-y-pruebas.md) |

## Entregables del TP6 y dónde encontrarlos

| # | Entregable | Dónde está |
|---|------------|-----------|
| 1 | URL del repositorio e integrantes | Este repositorio y la sección *Integrantes* |
| 2 | Tag sobre el commit presentado | `tp6-entrega` |
| 3 | Arquitectura final y cambios respecto del TP5 | [`docs/arquitectura.md` §11](docs/arquitectura.md#11-tp6-arquitectura-implementada-y-cambios-respecto-del-tp5) |
| 4 | Código fuente de los microservicios | [`services/`](services/) |
| 5 | Dockerfile y `.dockerignore` de cada servicio | `services/<servicio>/Dockerfile` y `.dockerignore` |
| 6 | Docker Compose de la solución integrada | [`docker-compose.yml`](docker-compose.yml) |
| 7 | `.env.example` sin secretos | [`.env.example`](.env.example) y `services/<servicio>/.env.example` |
| 8 | Persistencia y volúmenes | `docker-compose.yml` y sección *Volúmenes y persistencia* |
| 9 | READMEs e instrucciones de ejecución | Este archivo y el README de cada servicio |
| 10 | Documentación OpenAPI/Swagger | `/api-docs` de cada servicio (`src/docs/openapi.js`) |
| 11 | Evidencias de las pruebas obligatorias | [`docs/evidencias/tp6/`](docs/evidencias/tp6/) |
| 12 | Historial de ramas, commits y Pull Requests | Historial del repositorio en GitHub |
| 13 | Procedimiento para inicializar los datos de prueba | Sección *Datos de prueba* |
| 14 | Análisis del fallo parcial | [`docs/arquitectura.md` §11.3](docs/arquitectura.md#113-análisis-del-fallo-parcial-compra-de-entradas) |

## Entregables del TP5 y dónde encontrarlos

| # | Entregable | Dónde está |
|---|------------|-----------|
| 1 | URL del repositorio único | Este repositorio |
| 2 | Listado de integrantes | Sección *Integrantes* |
| 3 | Docentes como colaboradores | Settings → Collaborators de GitHub (ver `docs/evidencias/`) |
| 4 | Versión funcional de partida | [`app-base/`](app-base/) |
| 5 | `.gitignore` y variables sensibles | [`.gitignore`](.gitignore) y [`.env.example`](.env.example) |
| 6 | Evidencia de ramas, commits y Pull Request | Historial del repositorio y [`docs/evidencias/`](docs/evidencias/) |
| 7 | Inventario de funcionalidades y endpoints | [`docs/arquitectura.md` §2](docs/arquitectura.md#2-análisis-de-la-aplicación-existente-inventario) |
| 8 | Identificación de responsabilidades | [`docs/arquitectura.md` §3](docs/arquitectura.md#3-identificación-de-responsabilidades) |
| 9 | Tres ejemplos de acoplamiento y desacople | [`docs/arquitectura.md` §4](docs/arquitectura.md#4-identificación-de-acoplamientos) |
| 10 | Propuesta de al menos tres microservicios | [`docs/arquitectura.md` §5](docs/arquitectura.md#5-propuesta-de-microservicios) |
| 11 | Ficha y justificación de cada microservicio | [`docs/arquitectura.md` §5.1](docs/arquitectura.md#5-propuesta-de-microservicios) |
| 12 | Matriz de propiedad de datos | [`docs/arquitectura.md` §6](docs/arquitectura.md#6-propiedad-y-acceso-a-los-datos) |
| 13 | Matriz de comunicaciones | [`docs/arquitectura.md` §7](docs/arquitectura.md#7-comunicación-entre-microservicios) |
| 14 | Trazado de al menos dos casos de uso | [`docs/arquitectura.md` §8](docs/arquitectura.md#8-trazado-de-casos-de-uso) |
| 15 | Diagrama de arquitectura | [`docs/diagrama-arquitectura.svg`](docs/diagrama-arquitectura.svg) |
| 16 | Checklist de validación de límites | [`docs/arquitectura.md` §10](docs/arquitectura.md#10-validación-de-los-límites-propuestos-checklist) |
