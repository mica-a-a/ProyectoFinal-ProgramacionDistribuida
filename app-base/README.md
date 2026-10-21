<<<<<<< HEAD
# ProyectoFinal-ProgramacionDistribuida

Trabajo final de la materia Programación Distribuida.

# Proyecto elegido: Eventos y Entradas
=======
# TP4 - Consenso Distribuido con Raft

## Programación Distribuida

Trabajo Práctico N.º 4 - Consenso Distribuido, Paxos y Raft
Alumno: Bazan Franco

> **Uso en este repositorio:** esta carpeta (`app-base/`) es la versión funcional de partida del TP5 (migración a microservicios). Corresponde a la API del TP4, sin cambios de código. Ver `BASE.md`.
---

## 1. Descripción

Este proyecto corresponde al Trabajo Práctico N.º 4 de la asignatura Programación Distribuida.

El trabajo continúa la aplicación desarrollada en el TP3 e incorpora un cluster fijo de tres nodos independientes utilizando una implementación educativa y simplificada del algoritmo Raft.

El objetivo principal es demostrar:

* Elección de un líder.
* Elección por mayoría.
* Comunicación entre réplicas.
* Heartbeats.
* Replicación ordenada de operaciones.
* Confirmación mediante quorum.
* Aplicación de operaciones confirmadas.
* Persistencia del estado de Raft.
* Recuperación de nodos.
* Recuperación de logs atrasados.
* Tolerancia a fallos de tipo crash/restart.
* Integración de Redis como mecanismo de exclusión mutua para operaciones concurrentes.

La API externa mantiene HTTPS y la comunicación interna entre nodos Raft utiliza HTTP.
>>>>>>> main

**Materia:** Programación Distribuida · Licenciatura en Sistemas de Información (UCH)

<<<<<<< HEAD
## Integrantes

| Apellido y Nombre | Usuario de GitHub |
|-------------------|-------------------|
| `Bazan Franco` | `francobazan11` |
| `Gorri Juan` | `jnahuelgorrig` |
| `Le Donne Micaela` | `mica-a-a` |
| `Molina Agostina` | `molinagos` |
| `Nievas Milagros` | `milinievas` |
=======
## 2. Tecnologías utilizadas

* Node.js
* Express
* MongoDB
* Mongoose
* Redis
* Winston
* Swagger / OpenAPI
* HTTPS
* Raft
* Docker
>>>>>>> main

**Grupo:** `sin def`

<<<<<<< HEAD
**Docentes agregados como colaboradores:** alvarezadriel@uch.edu.ar · cortezedgardo@uch.edu.ar

## De qué trata

Sistema de **eventos y entradas**: usuarios registrados compran entradas para eventos con aforo limitado, reciben un ticket y lo presentan en el ingreso, donde se valida (uso único).

Este repositorio parte de una API REST monolítica (`app-base/`, la del TP4) y la evoluciona hacia una arquitectura de **tres microservicios** que se ejecutan de forma reproducible con Docker Compose.

- **TP5:** análisis y diseño de la arquitectura: [`docs/arquitectura.md`](docs/arquitectura.md).
- **TP6:** implementación de los microservicios y Docker: ratificación de la arquitectura en [`docs/tp6-hito1-ratificacion.md`](docs/tp6-hito1-ratificacion.md) y todo lo que figura en este README.

## Arquitectura implementada

![Diagrama de arquitectura](docs/diagrama-arquitectura.svg)

| Servicio | Responsabilidad | Base de datos propia | Puerto local | Puerto publicado en Docker |
|---|---|---|---|---|
| `usuarios-service` | Identidad y datos personales de las personas; informa si un usuario existe y está activo | MongoDB `usuarios-db` (base `usuarios`) | 3001 | 3001 |
| `eventos-service` | Eventos y control de aforo: nunca se vende más que el aforo (lock en Redis, idempotencia por referencia) | MongoDB `eventos-db` (base `eventos`) y Redis | 3002 | 3002 |
| `entradas-service` | Compra de entradas, órdenes y tickets de uso único. Orquesta la compra consultando a los otros dos | MongoDB `entradas-db` (base `entradas`) | 3003 | 3003 |

Reglas de la arquitectura:

- Cada servicio modifica **solo sus datos**. Ninguno accede a la base de otro.
- Entradas guarda `usuarioId` y `eventoId` como referencias lógicas y, para saber algo de ellos, usa la API pública del servicio dueño.
- Solo Entradas llama a otros servicios (por HTTP, con timeout). No hay llamadas circulares.
- Redis lo usa únicamente Eventos, para el lock del aforo.

### Comunicación entre servicios

| Origen | Destino | Endpoint | Para qué |
|---|---|---|---|
| `entradas-service` | `usuarios-service` | `GET /usuarios/:id` | Verificar que el comprador existe y está activo |
| `entradas-service` | `eventos-service` | `GET /eventos/:id` | Obtener precio, fecha y vigencia del evento |
| `entradas-service` | `eventos-service` | `POST /eventos/:id/reservar-aforo` | Reservar lugares (idempotente por `referencia`) |
| `entradas-service` | `eventos-service` | `POST /eventos/:id/liberar-aforo` | Devolver lugares al cancelar o compensar |

Los contratos detallados están en [`docs/arquitectura.md`](docs/arquitectura.md) (sección 7) y en el Swagger de cada servicio.

## Requisitos de software

- **Para ejecutar con Docker (lo recomendado):** Docker Desktop con WSL 2 en Windows (o Docker Engine con el plugin de Compose en Linux) y Git.
- **Solo para ejecución local y pruebas automáticas:** Node.js 20.19 o superior y npm; para correr los servicios fuera de Docker, además MongoDB (`127.0.0.1:27017`) y Redis o Memurai (`127.0.0.1:6379`).

## Instalación y verificación de Docker

En Windows, instalar Docker Desktop con el backend WSL 2 y dejarlo abierto. Verificar:

```bash
wsl --status                  # solo en Windows
docker --version
docker compose version
docker info
docker run --rm hello-world
```

`hello-world` debe completarse correctamente antes de seguir. Las capturas de esta verificación están en [`docs/evidencias/`](docs/evidencias/).

## Variables de entorno

El `docker-compose.yml` define todos los valores y cada uno tiene un valor por defecto: **no hace falta ningún `.env` para levantar la solución**. Para cambiar alguno se copia el archivo de ejemplo (el `.env` real no se versiona):

```bash
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
```

| Variable | Por defecto | Qué controla |
|---|---|---|
| `IMAGE_PREFIX` | `grupo` | Prefijo de las imágenes (`grupo/<servicio>:tp6`) |
| `LOG_LEVEL` | `info` | Nivel de log de los tres servicios |
| `USUARIOS_HOST_PORT` | `3001` | Puerto publicado hacia la PC para usuarios-service |
| `EVENTOS_HOST_PORT` | `3002` | Puerto publicado hacia la PC para eventos-service |
| `ENTRADAS_HOST_PORT` | `3003` | Puerto publicado hacia la PC para entradas-service |
| `LOCK_TTL_MS` | `5000` | Vida del lock de aforo en Redis |
| `REQUEST_TIMEOUT_MS` | `3000` | Timeout de las llamadas de Entradas a otros servicios |
| `MAX_ENTRADAS_POR_USUARIO` | `4` | Máximo de entradas por usuario y evento |
| `PLAZO_CANCELACION_HORAS` | `24` | Horas antes del evento hasta las que se puede cancelar |

Dentro de los contenedores, Compose también define `SERVICE_NAME`, `PORT=3000`, `MONGODB_URI`, `REDIS_URL`, `USUARIOS_SERVICE_URL` y `EVENTOS_SERVICE_URL`. Cada servicio documenta sus variables para ejecución local en su propio `.env.example` (`services/<servicio>/.env.example`).

## Construir e iniciar la solución

Desde la raíz del repositorio, con Docker Desktop abierto:

```bash
docker compose config --quiet     # valida el archivo (no imprime nada si está bien)
docker compose up --build -d      # construye las imágenes y levanta todo
docker compose ps                 # esperar a que los 7 contenedores estén "healthy"
```

La primera vez descarga `mongo:7`, `redis:7-alpine` y `node:22-alpine` y tarda unos minutos. Construir una imagen por separado:

```bash
docker build -t grupo/entradas-service:tp6 ./services/entradas-service
```

## Puertos expuestos hacia el host

| Puerto | Servicio |
|---|---|
| 3001 | `usuarios-service` |
| 3002 | `eventos-service` |
| 3003 | `entradas-service` |

Las bases de datos (`usuarios-db`, `eventos-db`, `entradas-db`) y Redis **no se publican**: solo los usan los contenedores, por la red interna `tp6-net`. Para comunicarse entre sí, los servicios usan el nombre DNS y el puerto interno, no el puerto publicado.

## URLs de Swagger y health checks

| Servicio | Swagger UI | Health |
|---|---|---|
| `usuarios-service` | `http://localhost:3001/api-docs` | `http://localhost:3001/health` |
| `eventos-service` | `http://localhost:3002/api-docs` | `http://localhost:3002/health` |
| `entradas-service` | `http://localhost:3003/api-docs` | `http://localhost:3003/health` |

`GET /health` responde `{ "service": "<nombre>", "status": "ok" }` y no expone información sensible.

## Nombres internos y URLs dentro de Docker Compose

| Componente | Nombre interno | URL o conexión |
|---|---|---|
| Usuarios | `usuarios-service` | `http://usuarios-service:3000` |
| Eventos | `eventos-service` | `http://eventos-service:3000` |
| Entradas | `entradas-service` | `http://entradas-service:3000` |
| MongoDB de usuarios | `usuarios-db` | `mongodb://usuarios-db:27017/usuarios` |
| MongoDB de eventos | `eventos-db` | `mongodb://eventos-db:27017/eventos` |
| MongoDB de entradas | `entradas-db` | `mongodb://entradas-db:27017/entradas` |
| Redis | `redis` | `redis://redis:6379` |

## Ejecución local vs Docker Compose

El código fuente es el mismo en los dos entornos; solo cambia la configuración (variables de entorno).

| Variable | Ejecución local | Docker Compose |
|---|---|---|
| `PORT` | 3001, 3002 y 3003 | 3000 en los tres (internos) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/<base>` | `mongodb://<servicio>-db:27017/<base>` |
| `REDIS_URL` (eventos) | `redis://127.0.0.1:6379` | `redis://redis:6379` |
| `USUARIOS_SERVICE_URL` (entradas) | `http://localhost:3001` | `http://usuarios-service:3000` |
| `EVENTOS_SERVICE_URL` (entradas) | `http://localhost:3002` | `http://eventos-service:3000` |

Ejecución local de un servicio (requiere MongoDB y, para Eventos, Redis; no usarla a la vez que Compose porque comparten puertos):

```bash
cd services/<servicio>
cp .env.example .env          # en PowerShell: Copy-Item .env.example .env
npm install
npm start
```
=======
## 3. Arquitectura del cluster

El sistema está compuesto por tres nodos independientes.

| Nodo  | API HTTPS | Puerto Raft | Base MongoDB   |
| ----- | --------: | ----------: | -------------- |
| node1 |      3443 |        4001 | user-api-node1 |
| node2 |      3444 |        4002 | user-api-node2 |
| node3 |      3445 |        4003 | user-api-node3 |

Cada proceso utiliza una identidad propia mediante la variable `NODE_ID`.

El nodo que posee el rol `LEADER` recibe las operaciones que modifican el estado y las incorpora al log de Raft.

Los nodos `FOLLOWER` reciben las entradas mediante los RPC internos de Raft.

---

## 4. Estructura principal del proyecto

```text
app-base/
│
├── certs/            (se genera localmente, no se versiona)
│   ├── server.crt
│   └── server.key
│
├── src/
│   ├── config/
│   │   └── cluster.js
│   │
│   ├── models/
│   │   └── User.js
│   │
│   ├── raft/
│   │   ├── election.js
│   │   ├── replication.js
│   │   ├── state.js
│   │   └── stateMachine.js
│   │
│   ├── routes/
│   │   ├── raft.routes.js
│   │   ├── reservas.routes.js
│   │   └── users.routes.js
│   │
│   ├── app.js
│   ├── db.js
│   ├── logger.js
│   ├── redis.js
│   └── server.js
│
├── .env              (se crea a partir de .env.example, no se versiona)
├── .env.example
├── BASE.md
├── package.json
├── package-lock.json
└── README.md
```

---

## 5. Requisitos previos

Antes de ejecutar el proyecto se necesita tener instalado:

* Node.js
* npm
* Docker (solo para ejecutar el contenedor de MongoDB; no hay Dockerfile de la aplicación)
* MongoDB
* Redis

También se requieren los certificados HTTPS utilizados por la aplicación (ver sección 6.1).

---

## 6. Instalación

Clonar o copiar el proyecto y ubicarse en la carpeta:

```bash
cd app-base
```

Instalar las dependencias:

```bash
npm install
```

### 6.1 Certificado HTTPS de desarrollo

Los certificados no se versionan. Generar uno autofirmado dentro de `app-base/`:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/server.key -out certs/server.crt -days 365 -subj "/CN=localhost"
```

El servidor busca exactamente `certs/server.key` y `certs/server.crt`.
>>>>>>> main

**HTTPS:** en esta etapa no se usa. La comunicación interna y la publicada hacia la PC es HTTP, lo que la consigna permite. El HTTPS del TP2 no se migró.

<<<<<<< HEAD
## Inicio y disponibilidad de dependencias críticas

- Cada base de datos y Redis tienen un healthcheck. Usuarios y Eventos esperan con `depends_on` y `condition: service_healthy` a sus bases (y Eventos también a Redis).
- Cada servicio tiene un healthcheck sobre su `GET /health`, hecho con el `fetch` nativo de Node.
- **Entradas no espera a Usuarios ni a Eventos, a propósito:** tiene que poder arrancar y responder `503` si alguno no está, para poder demostrar la prueba de indisponibilidad.
- Los servicios abren su puerto primero y conectan a MongoDB en segundo plano con reintentos: mientras no hay conexión, `/health` y `/api-docs` responden y las rutas de negocio responden `503 DB_NO_DISPONIBLE`. Cuando la base vuelve, se recuperan sin reiniciarse.

## Comportamiento cuando una dependencia remota no está disponible

| Situación remota | Resultado en Entradas |
|---|---|
| `404` (usuario o evento inexistente) | `404` funcional, orden `RECHAZADA` |
| `409` (sin aforo, evento no vendible) | `409` propagado, orden `RECHAZADA` |
| `423` (lock ocupado) | Reintenta 3 veces (150 ms entre intentos); si persiste, `423` y orden `RECHAZADA` |
| Timeout, DNS o conexión rechazada | `503` controlado (no un `500`); Entradas sigue vivo |
| `5xx` remoto | `503` |
| `4xx` inesperado (por ejemplo `400`) | `502`: el servicio remoto rechazó el pedido |

Los logs identifican el servicio origen, la dependencia remota y la causa (por ejemplo `ECONNREFUSED`), y salen por stdout en formato JSON.

## Volúmenes y persistencia

Cada MongoDB guarda sus datos en un volumen nombrado: `usuarios-data`, `eventos-data` y `entradas-data`. Redis no persiste datos: solo guarda locks temporales.

```bash
docker compose down        # detiene y elimina los contenedores; CONSERVA los datos
docker compose up -d       # los datos siguen disponibles
docker compose down -v     # elimina también los volúmenes (borra los datos a propósito)
```

## Pruebas

### Pruebas automáticas (no requieren Docker ni MongoDB)

```bash
cd services/usuarios-service && npm install && npm test
cd services/eventos-service  && npm install && npm test   # las del lock usan Redis si REDIS_URL está definida
cd services/entradas-service && npm install && npm test   # 28 pruebas con servicios simulados
```

### Pruebas con Docker Compose (comandos de PowerShell, desde la raíz)

```powershell
# 1. Build individual y levantar todo
docker build -t grupo/usuarios-service:tp6 ./services/usuarios-service
docker build -t grupo/eventos-service:tp6 ./services/eventos-service
docker build -t grupo/entradas-service:tp6 ./services/entradas-service
docker compose up --build -d
docker compose ps

# 2. Health de los tres servicios
curl.exe http://localhost:3001/health
curl.exe http://localhost:3002/health
curl.exe http://localhost:3003/health
```

```powershell
# 3. Datos de prueba y compra de punta a punta (comunicación entre servicios)
$us = Invoke-RestMethod -Method Post -Uri http://localhost:3001/usuarios -ContentType 'application/json' -Body '{"nombre":"Ana","apellido":"Prueba","dni":"40111222","fechaNacimiento":"1995-05-10","email":"ana.prueba@example.com","direccion":"Calle 123"}'
$fecha = (Get-Date).AddDays(10).ToString("yyyy-MM-ddTHH:mm:ss")
$ev = Invoke-RestMethod -Method Post -Uri http://localhost:3002/eventos -ContentType 'application/json' -Body "{`"nombre`":`"Evento de prueba`",`"fecha`":`"$fecha`",`"lugar`":`"Aula Magna`",`"precio`":5000,`"aforoTotal`":5}"
$US = if ($us.id) { $us.id } else { $us._id }
$EV = if ($ev.id) { $ev.id } else { $ev._id }
$r = Invoke-RestMethod -Method Post -Uri http://localhost:3003/ordenes -ContentType 'application/json' -Body "{`"usuarioId`":`"$US`",`"eventoId`":`"$EV`",`"cantidad`":2}"
$ID = $r.orden.id
$r | ConvertTo-Json -Depth 5
curl.exe -s http://localhost:3002/eventos/$EV          # disponibles baja de 5 a 3
```

```powershell
# 4. Propiedad de los datos: una base por servicio
docker compose exec usuarios-db mongosh --quiet --eval "db.getSiblingDB('usuarios').getCollectionNames()"
docker compose exec eventos-db mongosh --quiet --eval "db.getSiblingDB('eventos').getCollectionNames()"
docker compose exec entradas-db mongosh --quiet --eval "db.getSiblingDB('entradas').getCollectionNames()"

# 5. Fallo de dependencia: detener Eventos y repetir la compra (debe dar 503), luego recuperar
docker compose stop eventos-service
curl.exe -s -w "`n[HTTP %{http_code}]`n" -X POST http://localhost:3003/ordenes -H "Content-Type: application/json" -d "{\`"usuarioId\`":\`"$US\`",\`"eventoId\`":\`"$EV\`",\`"cantidad\`":1}"
curl.exe http://localhost:3003/health                    # Entradas sigue en "ok"
docker compose logs entradas-service --tail 10           # dependency: eventos-service
docker compose start eventos-service                     # esperar a "healthy" en docker compose ps y repetir: 201

# 6. Persistencia
docker compose down
docker compose up -d
curl.exe -s http://localhost:3003/ordenes/$ID            # la orden sigue existiendo

# 7. Logs de un servicio y cierre
docker compose logs entradas-service --tail 30
docker compose down
```

### Qué demuestra cada prueba obligatoria

| Prueba | Cómo se demuestra |
|---|---|
| Build individual | `docker build` de cada servicio (paso 1) |
| Inicio con Compose | `docker compose up --build -d` y `docker compose ps` con todo `healthy` |
| Health | `GET /health` de los tres servicios (paso 2) |
| CRUD / negocio | Swagger de cada servicio y la compra del paso 3 |
| Comunicación | La compra: Entradas consulta a Usuarios y a Eventos, y Eventos descuenta el aforo (paso 3) |
| Propiedad de datos | Una base por servicio, con colecciones distintas (paso 4) |
| Persistencia | `down` y `up -d` conservan los datos (paso 6) |
| Fallo de dependencia | `503` controlado con Eventos detenido y recuperación (paso 5) |
| Logs | `docker compose logs <servicio>` (paso 7) |
| Swagger | URLs de la sección anterior |
| Configuración por entorno | El mismo código corre local y en Compose cambiando solo variables |
| Startup y disponibilidad | Healthchecks, `depends_on` y reintentos de conexión a MongoDB |
| Fallo parcial | Sección siguiente |
| Datos de prueba | Sección siguiente |

## Datos de prueba: procedimiento reproducible

Las bases arrancan vacías. Para volver a un estado inicial conocido:

```powershell
docker compose down -v
docker compose up -d
```

Después se crean un usuario y un evento (paso 3 de las pruebas, o desde el Swagger de cada servicio) y se compra con sus ids. Los ids que devuelven los servicios son los que se usan en las compras. Cada servicio documenta además sus propios datos y ejemplos en su README.

## Análisis de fallo parcial: comprar entradas

Participan, en este orden: Entradas (crea la orden `PENDIENTE`) → Usuarios (verifica) → Eventos (precio) → Eventos (`reservar-aforo`) → Entradas (emite tickets y confirma).

| Etapa que falla | Estado resultante | ¿Inconsistencia? |
|---|---|---|
| Usuarios o Eventos (consulta) | Orden `RECHAZADA`, aforo intacto | No |
| `reservar-aforo` responde `409`, `404` o `423` | Orden `RECHAZADA`, aforo intacto | No |
| `reservar-aforo` sin respuesta (timeout o `5xx`) | Orden `PENDIENTE` | **Posible**: Eventos pudo haber descontado el aforo sin que Entradas lo sepa |
| Emisión de tickets o confirmación (error de base) | Se intenta `liberar-aforo`: si sale bien, `RECHAZADA`; si no, `PENDIENTE` | Posible si la compensación también falla |

Para detectar, recuperar o compensar en una evolución futura alcanza con las órdenes `PENDIENTE` y su `id`: ese mismo `id` es la `referencia` idempotente que usa Eventos, así que se puede repetir `reservar-aforo` (no duplica el descuento) o llamar a `liberar-aforo`. Mientras una orden está `PENDIENTE` cuenta para el máximo de entradas del usuario, porque podría tener aforo reservado. La cancelación sigue la misma lógica: primero se anulan los tickets y después se libera el aforo; si `liberar-aforo` falla, se restauran los tickets y el cliente recibe `503`.

## Cambios respecto de la propuesta del TP5

Los tres servicios y sus límites se mantienen. Cambios y decisiones (detalle en [`docs/tp6-hito1-ratificacion.md`](docs/tp6-hito1-ratificacion.md)):

- **Raft no se migra.** En el TP5 era candidato para Eventos; es un mecanismo técnico, no una responsabilidad de negocio, y cada servicio corre una sola instancia. Se conserva el lock de Redis (clave `lock:evento:{id}`, TTL configurable, `423` si está ocupado).
- **Endpoints:** `/users` pasa a `/usuarios` y ya no pasa por Raft; `DELETE /usuarios/:id` pasa a baja lógica (`activo = false`); las reservas (`/reservas`) pasan a ser aforo de Eventos (`reservar-aforo` y `liberar-aforo`, internos) y el cliente compra con `POST /ordenes` en Entradas.
- **Usuario:** `nombre` y `apellido` por separado, más `dni`, `fechaNacimiento`, `direccion` y `activo`; la edad se calcula en lugar de guardarse.
- **Entradas:** `GET /entradas` exige el parámetro `usuarioId`; los tickets de una orden cancelada pasan a `ANULADO`; una orden `PENDIENTE` cuenta para el máximo del usuario.
- **HTTP** en toda la comunicación, interna y publicada (sin HTTPS en esta etapa).
- **Logs** a stdout en JSON, con el nombre del servicio en cada línea.

## Estructura del repositorio

```text
.
├── README.md                    Este archivo
├── docker-compose.yml           Solución integrada: 3 servicios, 3 MongoDB y Redis
├── .env.example                 Variables opcionales del Compose (sin valores sensibles)
├── .gitignore                   Excluye dependencias, .env, logs, claves y certificados
├── .github/pull_request_template.md
├── docs/
│   ├── arquitectura.md          Análisis y diseño del TP5
│   ├── tp6-hito1-ratificacion.md  Ratificación de la arquitectura y decisiones del TP6
│   ├── diagrama-arquitectura.svg  Diagrama (también .png)
│   ├── flujo-git.md             Flujo de ramas, commits, PR y tags
│   └── evidencias/              Capturas de Git, de Docker y de las pruebas
├── app-base/                    Versión de partida (API del TP4: Express, MongoDB, Redis, Raft, Swagger)
└── services/
    ├── usuarios-service/
    ├── eventos-service/
    └── entradas-service/
        ├── Dockerfile  .dockerignore  .env.example  package.json  README.md
        ├── src/{routes,controllers,services,clients,models,config,docs}  app.js  server.js
        └── test/
```

Cada servicio tiene su propio README con sus variables, endpoints y ejemplos.

## Flujo de trabajo con Git

- La rama principal es `main`. No se desarrolla directamente sobre ella.
- Cada tarea se hace en una rama propia (`feature/...`, `docs/...`, `fix/...`) y se integra mediante **Pull Request** con revisión de otro integrante.
- Los mensajes de commit describen cambios concretos.
- Cada entrega queda marcada con un tag (`tp5-entrega`, `tp6-entrega`).

Detalle completo en [`docs/flujo-git.md`](docs/flujo-git.md).

## Entregables del TP6 y dónde encontrarlos

| # | Entregable | Dónde está |
|---|---|---|
| 1 | URL del repositorio e integrantes | Este repositorio y la sección *Integrantes* |
| 2 | Tag sobre el commit presentado | `tp6-entrega` |
| 3 | Arquitectura final y cambios respecto del TP5 | [`docs/arquitectura.md`](docs/arquitectura.md), [`docs/tp6-hito1-ratificacion.md`](docs/tp6-hito1-ratificacion.md) y la sección *Cambios respecto de la propuesta del TP5* |
| 4 | Código fuente de los microservicios | [`services/`](services/) |
| 5 | Dockerfile y `.dockerignore` de cada servicio | `services/<servicio>/Dockerfile` y `services/<servicio>/.dockerignore` |
| 6 | Docker Compose de la solución integrada | [`docker-compose.yml`](docker-compose.yml) |
| 7 | `.env.example` sin secretos | [`.env.example`](.env.example) y `services/<servicio>/.env.example` |
| 8 | Persistencia y volúmenes | Sección *Volúmenes y persistencia* y [`docker-compose.yml`](docker-compose.yml) |
| 9 | READMEs e instrucciones de ejecución | Este README y `services/<servicio>/README.md` |
| 10 | Documentación OpenAPI/Swagger | `/api-docs` de cada servicio y `src/docs/openapi.js` |
| 11 | Evidencias de las pruebas obligatorias | [`docs/evidencias/`](docs/evidencias/) y la sección *Pruebas* |
| 12 | Historial de ramas, commits y Pull Requests | Historial del repositorio en GitHub |
| 13 | Procedimiento para inicializar los datos de prueba | Sección *Datos de prueba: procedimiento reproducible* |
| 14 | Análisis del fallo parcial seleccionado | Sección *Análisis de fallo parcial: comprar entradas* |

<details>
<summary>Entregables del TP5 (histórico)</summary>

| # | Entregable | Dónde está |
|---|------------|-----------|
| 1 | URL del repositorio único | Este repositorio |
| 2 | Listado de integrantes | Sección *Integrantes* de este README |
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

</details>
=======
## 7. MongoDB

El proyecto utiliza MongoDB como mecanismo de persistencia.

Para el desarrollo se utiliza el contenedor MongoDB creado previamente:

```bash
docker start mongodb-tp3
```

El puerto utilizado es:

```text
27017
```

Cada nodo utiliza una base independiente:

```text
user-api-node1
user-api-node2
user-api-node3
```

Esto permite que cada réplica mantenga su propia persistencia local.

---

## 8. Redis

Redis se utiliza para mantener la funcionalidad de exclusión mutua heredada del TP2.

Iniciar Redis:

```bash
brew services start redis
```

o, si se ejecuta manualmente:

```bash
redis-server
```

Redis no se utiliza para:

* Elegir el Leader.
* Almacenar votos de Raft.
* Calcular quorum.
* Decidir commits.
* Replicar el log de Raft.

Estas responsabilidades pertenecen exclusivamente al protocolo Raft.

---

## 9. Variables de entorno

Crear un archivo `.env` a partir de `.env.example`.

Ejemplo:

```env
REDIS_URL=redis://localhost:6379
```

Los puertos de cada nodo y su base de MongoDB se definen en `src/config/cluster.js`, no en el `.env`.

La identidad del nodo no se almacena en `.env`.

Se establece mediante `NODE_ID` al iniciar cada proceso.

No incluir el archivo `.env` real en la entrega.

---

## 10. Ejecución de los tres nodos

Los tres nodos se ejecutan como procesos independientes.

### Node 1

```bash
npm run node1
```

Utiliza:

```text
NODE_ID=node1
HTTPS: 3443
Raft: 4001
MongoDB: user-api-node1
```

### Node 2

En otra terminal:

```bash
npm run node2
```

Utiliza:

```text
NODE_ID=node2
HTTPS: 3444
Raft: 4002
MongoDB: user-api-node2
```

### Node 3

En otra terminal:

```bash
npm run node3
```

Utiliza:

```text
NODE_ID=node3
HTTPS: 3445
Raft: 4003
MongoDB: user-api-node3
```

El cluster selecciona automáticamente un Leader.

---

## 11. Scripts disponibles

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "node1": "NODE_ID=node1 node src/server.js",
    "node2": "NODE_ID=node2 node src/server.js",
    "node3": "NODE_ID=node3 node src/server.js"
  }
}
```

---

## 12. Diagnóstico del cluster

Cada nodo expone un endpoint para consultar su estado:

```text
GET /raft/status
```

Ejemplos:

```bash
curl -k https://localhost:3443/raft/status
```

```bash
curl -k https://localhost:3444/raft/status
```

```bash
curl -k https://localhost:3445/raft/status
```

La respuesta permite consultar:

* Identidad del nodo.
* Rol.
* Término actual.
* Leader actual.
* Commit index.
* Last applied.
* Cantidad de entradas del log.
* Puertos.
* Peers.

---

## 13. Consulta del log Raft

Cada nodo también permite consultar su log mediante:

```text
GET /raft/log
```

Ejemplo:

```bash
curl -k https://localhost:3443/raft/log
```

La respuesta muestra:

* `currentTerm`
* `commitIndex`
* `lastApplied`
* `log`

Este endpoint permite comprobar la convergencia de las réplicas.

---

## 14. API REST

La API conserva el CRUD de usuarios desarrollado en los trabajos anteriores.

### Obtener usuarios

```bash
curl -k https://localhost:3443/users
```

### Obtener un usuario

```bash
curl -k https://localhost:3443/users/ID
```

### Crear usuario

Las operaciones de escritura deben realizarse sobre el Leader.

Ejemplo:

```bash
curl -k -X POST https://localhost:3443/users \
-H "Content-Type: application/json" \
-d '{
  "nombre": "Franco",
  "apellido": "Bazan",
  "email": "franco@test.com",
  "edad": 25
}'
```

### Modificar usuario

```bash
curl -k -X PUT https://localhost:3443/users/ID \
-H "Content-Type: application/json" \
-d '{
  "nombre": "FrancoModificado",
  "apellido": "Bazan",
  "email": "franco@test.com",
  "edad": 26
}'
```

### Eliminar usuario

```bash
curl -k -X DELETE https://localhost:3443/users/ID
```

Las operaciones que modifican el estado siguen el flujo:

```text
Cliente
   ↓
Leader
   ↓
Comando
   ↓
Log Raft
   ↓
Replicación
   ↓
Quorum
   ↓
Commit
   ↓
Máquina de estados
   ↓
MongoDB
```

---

## 15. Comportamiento de las escrituras sobre Followers

Una escritura enviada directamente a un follower no debe modificar localmente la base de datos.

Ejemplo:

```bash
curl -k -X POST https://localhost:3444/users \
-H "Content-Type: application/json" \
-d '{
  "nombre": "Follower",
  "apellido": "Test",
  "email": "follower@test.com",
  "edad": 25
}'
```

El nodo responde indicando que no es Leader y proporciona la identidad del Leader cuando está disponible.

---

## 16. Elección de Leader

Al iniciar los tres nodos, todos comienzan como Followers.

Si no reciben heartbeats dentro del tiempo de elección, un nodo pasa a estado Candidate e inicia una elección.

El candidato solicita votos a los demás nodos.

En un cluster de tres nodos se necesita una mayoría de:

```text
2 de 3 nodos
```

Cuando obtiene la mayoría, pasa a:

```text
LEADER
```

Los demás permanecen como:

```text
FOLLOWER
```

---

## 17. Heartbeats

El Leader envía periódicamente mensajes `AppendEntries` sin nuevas entradas.

Estos mensajes funcionan como heartbeats y permiten:

* Mantener informado al cluster sobre el Leader.
* Evitar elecciones innecesarias.
* Informar el `commitIndex`.
* Detectar la disponibilidad de los Followers.

---

## 18. Quorum y commit

Una entrada agregada al log no se considera confirmada inmediatamente.

Primero debe replicarse y obtener una mayoría.

En un cluster de tres nodos:

```text
Leader + 1 follower = quorum
```

Por lo tanto:

```text
2/3 = quorum
1/3 = sin quorum
```

Si no se alcanza la mayoría, la operación no se confirma.

---

## 19. Persistencia y recuperación

Cada nodo almacena persistentemente:

* `currentTerm`
* `votedFor`
* `log`
* `commitIndex`
* `lastApplied`

Cuando un nodo se reinicia recupera este estado desde MongoDB.

Además, si un follower estuvo caído y posteriormente vuelve a conectarse, el Leader utiliza el estado de replicación para enviarle las entradas que le faltan.

---

# 20. Swagger / OpenAPI

La documentación de la API se encuentra disponible mediante Swagger UI:

```text
https://localhost:3443/api-docs
```

También puede consultarse la especificación OpenAPI en formato JSON:

```text
https://localhost:3443/api-docs.json
```

Swagger permite consultar y ejecutar las operaciones documentadas de la API.

Los endpoints de negocio se diferencian de los endpoints internos utilizados por Raft.

---

# 21. Secuencia de pruebas finales

Las siguientes pruebas deben realizarse con los tres nodos ejecutándose como procesos independientes.

## A - Arranque de tres nodos

### Acción

Iniciar:

```bash
npm run node1
npm run node2
npm run node3
```

### Resultado esperado

Debe existir:

```text
1 LEADER
2 FOLLOWERS
```

Se verifica mediante:

```bash
curl -k https://localhost:3443/raft/status
curl -k https://localhost:3444/raft/status
curl -k https://localhost:3445/raft/status
```

---

## B - Escritura sobre follower

### Acción

Enviar una operación de escritura directamente a un follower.

### Resultado esperado

La operación debe ser rechazada y no debe aplicarse localmente saltándose el consenso.

---

## C - CRUD sobre Leader

### Acción

Realizar:

* POST
* GET
* PUT
* DELETE

sobre el Leader.

### Resultado esperado

Las modificaciones confirmadas deben quedar replicadas y converger en los tres nodos.

La convergencia se puede comprobar mediante:

```bash
curl -k https://localhost:3443/raft/log
curl -k https://localhost:3444/raft/log
curl -k https://localhost:3445/raft/log
```

---

## D - Caída del Leader

### Acción

Detener el proceso correspondiente al Leader.

### Resultado esperado

Los nodos restantes deben iniciar una nueva elección y seleccionar un nuevo Leader.

---

## E - Quorum 2/3

### Acción

Mantener dos nodos disponibles y realizar una nueva operación de escritura sobre el Leader.

### Resultado esperado

La operación debe ser confirmada porque existe mayoría:

```text
2/3
```

---

## F - Sin quorum 1/3

### Acción

Dejar solamente un nodo disponible e intentar realizar una operación de escritura.

### Resultado esperado

La operación no debe confirmarse porque no existe mayoría.

---

## G - Follower atrasado

### Acción

Detener un follower.

Con los otros dos nodos activos:

1. Realizar nuevas operaciones.
2. Confirmarlas mediante quorum.
3. Volver a iniciar el follower detenido.

### Resultado esperado

El follower debe recuperar las entradas faltantes y converger con el resto del cluster.

---

## H - Restart completo

### Acción

Detener los tres nodos.

Volver a iniciar los tres procesos.

### Resultado esperado

Los nodos deben recuperar:

* Término.
* Voto.
* Log.
* Commit.
* Estado aplicado.

Las entradas confirmadas antes del reinicio deben permanecer disponibles.

---

## I - Integración Redis + Raft

### Acción

Ejecutar dos operaciones concurrentes sobre el mismo recurso compartido.

Redis debe proteger la sección crítica.

La modificación aceptada debe ingresar posteriormente al mecanismo Raft.

### Resultado esperado

Debe demostrarse que:

* Redis controla la exclusión mutua.
* Solo una operación accede a la sección crítica en un momento determinado.
* La modificación aceptada ingresa al log Raft.
* Raft replica la operación.
* Raft confirma mediante quorum.
* La modificación confirmada queda persistida.

Redis no debe utilizarse para elegir Leader ni para calcular el quorum.

---

# 22. Logging y observabilidad

El proyecto utiliza Winston para registrar eventos relevantes.

Entre los eventos registrados se encuentran:

* Inicio de nodos.
* Elecciones.
* Cambios de término.
* Cambios de liderazgo.
* Comunicación entre nodos.
* Replicación.
* Commit.
* Aplicación de operaciones.
* Recuperación del estado.

Los endpoints `/raft/status` y `/raft/log` permiten observar el estado interno necesario para verificar el funcionamiento del cluster.

---

# 23. Manejo de fallos

El TP considera fallas de tipo:

```text
crash / restart
```

Un nodo puede detenerse y posteriormente volver a iniciarse.

No se implementan:

* Fallas bizantinas.
* Membresía dinámica.
* Snapshots.
* Log compaction.
* ReadIndex.
* PreVote.
* Joint Consensus.
* Optimizaciones de producción.

El objetivo es una implementación educativa y simplificada del protocolo Raft.

---

# 24. Seguridad y archivos excluidos

No deben incluirse en la entrega:

```text
node_modules/
.env
credenciales
tokens
secretos
claves privadas
certificados sensibles
logs voluminosos
```

Debe incluirse:

```text
.env.example
```

sin valores sensibles.

---

# 25. Evidencias de la entrega

Las evidencias deben demostrar los principales hitos y las pruebas finales.

Se recomienda incluir capturas correspondientes a:

* A - Arranque de tres nodos.
* B - Escritura sobre follower.
* C - CRUD y convergencia.
* D - Caída del Leader.
* E - Quorum 2/3.
* F - Sin quorum 1/3.
* G - Recuperación de follower atrasado.
* H - Restart completo.
* I - Integración Redis + Raft.


>>>>>>> main
