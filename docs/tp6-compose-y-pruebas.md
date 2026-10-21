# TP6 · Docker Compose, configuración y pruebas

Guía de la solución integrada (rama `feature/compose-integration`). Sirve de base para el README principal y para las evidencias.

## 1. Qué levanta `docker compose up --build`

| Servicio | Imagen | Puerto interno | Publicado en tu PC | Nombre DNS interno | Base propia |
|---|---|---|---|---|---|
| `usuarios-service` | `${IMAGE_PREFIX}/usuarios-service:tp6` | 3000 | **3001** | `usuarios-service` | `usuarios-db` (`usuarios`) |
| `eventos-service` | `${IMAGE_PREFIX}/eventos-service:tp6` | 3000 | **3002** | `eventos-service` | `eventos-db` (`eventos`) + `redis` |
| `entradas-service` | `${IMAGE_PREFIX}/entradas-service:tp6` | 3000 | **3003** | `entradas-service` | `entradas-db` (`entradas`) |
| `usuarios-db`, `eventos-db`, `entradas-db` | `mongo:7` | 27017 | no se publica | `<servicio>-db` | volumen propio |
| `redis` | `redis:7-alpine` | 6379 | no se publica | `redis` | sin volumen (los locks tienen TTL) |

**URLs internas** (las usan los contenedores entre sí, no las de la PC): `http://usuarios-service:3000`, `http://eventos-service:3000`, `mongodb://<servicio>-db:27017/<base>`, `redis://redis:6379`.

**Redes** (cumple "propiedad de datos" también a nivel de red):

- `tp6-net`: HTTP entre microservicios.
- `usuarios-net`, `eventos-net`, `entradas-net`: una red privada por servicio con *su* base (Redis vive en `eventos-net`). Un servicio ni siquiera puede resolver el nombre de la base de otro.

**Volúmenes**: `usuarios-data`, `eventos-data`, `entradas-data` (se ven como `tp6-eventos-entradas_<nombre>`).

**Swagger y health**

| Servicio | Swagger UI | Health |
|---|---|---|
| usuarios | http://localhost:3001/api-docs | http://localhost:3001/health |
| eventos | http://localhost:3002/api-docs | http://localhost:3002/health · `/ready` (Mongo + Redis) |
| entradas | http://localhost:3003/api-docs | http://localhost:3003/health |

## 2. Requisitos y verificación de Docker

Docker Desktop (Windows, backend WSL 2) o Docker Engine + plugin Compose (Linux), y Node 20+ (solo para el script de pruebas).

```bash
docker --version
docker compose version
docker info
docker run --rm hello-world
```

## 3. Configuración

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

El `.env` de la **raíz** solo lo lee Docker Compose (puertos publicados, prefijo de imagen, timeouts, reglas de negocio). Es opcional: todo tiene valor por defecto. **No se sube a Git.**

### Diferencias entre ejecución local y Docker Compose

El código es el mismo; cambia solo la configuración externa.

| Variable | Local (`npm start`, `.env` de cada servicio) | Docker Compose |
|---|---|---|
| `PORT` | 3001 / 3002 / 3003 | 3000 (publicado como 3001 / 3002 / 3003) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/<base>` | `mongodb://<servicio>-db:27017/<base>` |
| `REDIS_URL` | `redis://localhost:6379` (o Memurai en Windows) | `redis://redis:6379` |
| `USUARIOS_SERVICE_URL` | `http://localhost:3001` | `http://usuarios-service:3000` |
| `EVENTOS_SERVICE_URL` | `http://localhost:3002` | `http://eventos-service:3000` |

Dentro de un contenedor `localhost` es el propio contenedor: por eso nunca se usa para llegar a otro servicio.

## 4. Comandos

```bash
docker compose config          # valida y muestra la configuración final
docker compose up --build -d   # construye e inicia todo
docker compose ps              # estado y salud
docker compose logs -f entradas-service
docker compose down            # elimina contenedores, CONSERVA los datos
docker compose down -v         # elimina contenedores y BORRA los volúmenes (reinicia los datos)
```

Si ya tenés un servicio corriendo local en 3001–3003, cambiá `*_HOST_PORT` en el `.env`.

## 5. Inicio y disponibilidad de dependencias

- Cada base y Redis tienen **healthcheck**; cada servicio usa `depends_on: condition: service_healthy` sobre *sus* dependencias de arranque (su base y, en eventos, Redis).
- Cada microservicio tiene healthcheck propio sobre `/health`, con `fetch` de Node (la imagen Alpine no trae `curl`).
- **`entradas-service` no espera a usuarios ni a eventos a propósito**: debe poder arrancar y responder 503 si alguno falta (prueba 15.1).
- Aun con el orden de inicio, ningún servicio asume que sus dependencias estén siempre: los tres abren el puerto primero, conectan a su base con reintentos y responden 503 controlado mientras no esté lista.

| Situación | Respuesta |
|---|---|
| usuarios-service caído | entradas: `503 DEPENDENCIA_NO_DISPONIBLE` |
| eventos-service caído | entradas: `503 DEPENDENCIA_NO_DISPONIBLE` |
| Redis caído | eventos: `reservar-aforo` → `503 REDIS_NO_DISPONIBLE`; entradas: `503 ORDEN_PENDIENTE`; lecturas siguen funcionando |
| Base propia caída | el servicio: `503 DB_NO_DISPONIBLE`; `/health` y `/api-docs` siguen respondiendo |

Todos se recuperan solos cuando la dependencia vuelve, sin reiniciar el servicio.

## 6. Pruebas obligatorias (punto 18) con un comando

```bash
node scripts/tp6/pruebas.js <prueba>      # ver la lista con: node scripts/tp6/pruebas.js
node scripts/tp6/pruebas.js todo          # todas, en orden, con resumen
```

Cada prueba **imprime los comandos que ejecuta** y el resultado, y guarda la salida en `docs/evidencias/tp6/<prueba>.txt` (incluye fecha, versión de Docker y de Compose). Esos archivos son la evidencia reproducible; las capturas de pantalla las acompañan.

| Prueba del TP | Comando | Qué demuestra | Captura sugerida |
|---|---|---|---|
| Build individual | `… pruebas.js build` | Cada Dockerfile genera su imagen | salida del comando |
| Inicio con Compose | `… pruebas.js inicio` | `up --build` levanta los 7 contenedores, todos *healthy* | `docker compose ps` |
| Health | `… pruebas.js health` | Cada servicio responde su `/health` | navegador en `/health` |
| Datos de prueba | `… pruebas.js datos` | Estado inicial conocido (seeds) | salida del comando |
| CRUD / negocio + Comunicación | `… pruebas.js negocio` | CRUD de usuarios y eventos; compra entre los 3 servicios; reglas de cada dueño | salida del comando |
| Propiedad de datos | `… pruebas.js datos-propios` | Cada servicio usa solo su base; aislamiento de red; solo 3 puertos publicados | salida del comando |
| Swagger | `… pruebas.js swagger` | Las 3 interfaces están documentadas | las 3 UIs abiertas en el navegador |
| Fallo de dependencia | `… pruebas.js fallo-dependencia` | Se detiene `usuarios-service`: entradas responde 503 y se recupera (15.1) | salida del comando |
| Startup / disponibilidad | `… pruebas.js fallo-db` y `fallo-redis` | Caída y recuperación de la base y de Redis | salida del comando |
| Fallo parcial | `… pruebas.js fallo-parcial` | Orden `PENDIENTE` por falla en etapa intermedia + análisis | salida del comando |
| Logs | `… pruebas.js logs` | Logs JSON con servicio y nivel en `docker compose logs` | `docker compose logs entradas-service` |
| Persistencia | `… pruebas.js persistencia` (`--con-down-v` agrega la comparación) | Los datos sobreviven a `down` + `up`; `down -v` los borra | salida del comando |
| Configuración por entorno | ver §7 | Mismo código local y en Docker | capturas de ambas ejecuciones |

Orden recomendado para la primera corrida: `inicio` → `datos` → el resto. `todo` ya lo hace.

## 7. Prueba de configuración por entorno (manual)

1. **Sin Docker** (`docker compose down`), en una terminal por servicio, con su `.env` (copiado de `services/<servicio>/.env.example`), MongoDB y Redis/Memurai locales:
   ```bash
   cd services/usuarios-service && npm install && npm start
   ```
   Verificar `http://localhost:3001/health` y una compra desde Swagger de entradas. Captura.
2. `git status` → sin cambios en el código fuente.
3. **Con Docker**: `docker compose up --build -d` y repetir la misma verificación. Captura.

## 8. Datos de prueba

`node scripts/tp6/pruebas.js datos` deja siempre el mismo estado inicial:

- usuarios: 5 con IDs fijos `64b000000000000000000001` … `05` (el `04`, Diego Paz, está **inactivo**);
- eventos: 5 (Taller de Node.js con 5 lugares, Recital con 100, uno agotado, uno cancelado, uno finalizado);
- entradas: sin órdenes ni tickets.

Equivale a: `docker compose exec -T usuarios-service npm run seed` y `docker compose exec -T eventos-service npm run seed`.

## 9. Cambios respecto del compose anterior (para el PR)

- `name: tp6-eventos-entradas`: volúmenes y redes con nombre fijo, independiente de la carpeta donde se clonó el repo.
- Redes segmentadas: `tp6-net` para HTTP entre servicios y una red privada por servicio con su base.
- `.env.example` de la raíz reescrito: antes tenía variables que ningún servicio ni el compose leían (`USUARIOS_PORT`, `USUARIOS_MONGO_URI`, rutas SSL…); ahora documenta exactamente las que usa `docker-compose.yml`.
- Se agregaron `scripts/tp6/pruebas.js` y esta guía.
