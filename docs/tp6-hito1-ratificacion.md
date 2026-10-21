# TP6 – Hito 1: Ratificación de la arquitectura

**Programación Distribuida – Licenciatura en Sistemas de Información – UCH**

Partimos de la arquitectura del TP5 ([`arquitectura.md`](arquitectura.md)) y la transformamos en un plan de implementación. Mantenemos los tres servicios aprobados: `usuarios-service`, `eventos-service` y `entradas-service`. Los límites no cambian; lo único que se agrega son decisiones de implementación (sección 3).

---

## 1. Matriz de ratificación

| Microservicio | Responsabilidad | Endpoints a implementar | Datos propios | Dependencias |
|---|---|---|---|---|
| `usuarios-service` | Identidad y datos personales; informar si un usuario existe y está activo | `GET /usuarios`, `GET /usuarios/:id`, `POST /usuarios`, `PUT /usuarios/:id`, `DELETE /usuarios/:id` (baja lógica), `GET /health`, `GET /api-docs` | `usuarios`: `id`, `nombre`, `apellido`, `email`, `dni`, `fechaNacimiento`, `direccion`, `activo` | Ninguna |
| `eventos-service` | Eventos y control de aforo, sin vender nunca más que el aforo | `GET /eventos`, `GET /eventos/:id`, `POST /eventos`, `PUT /eventos/:id`, `PATCH /eventos/:id/cancelar`, `POST /eventos/:id/reservar-aforo` (interno), `POST /eventos/:id/liberar-aforo` (interno), `GET /health`, `GET /api-docs` | `eventos`, `movimientosAforo`, locks `lock:evento:{id}` en Redis | Ninguna (usa Redis como infraestructura propia) |
| `entradas-service` | Compra de entradas y ciclo de vida de órdenes y tickets | `POST /ordenes`, `GET /ordenes/:id`, `DELETE /ordenes/:id`, `GET /entradas?usuarioId=`, `POST /entradas/validar`, `GET /health`, `GET /api-docs` | `ordenes`, `tickets` | `usuarios-service` y `eventos-service`, solo por HTTP |

**Qué puede modificar cada servicio:** únicamente sus datos propios. Entradas guarda `usuarioId` y `eventoId` como referencias lógicas y, para saber algo de ellos, consulta la API del servicio dueño. Nadie accede a la base de otro.

## 2. Propietario de cada endpoint de la aplicación anterior

| Endpoint de la app anterior (TP4) | Servicio propietario | Cómo queda |
|---|---|---|
| `GET /users`, `GET /users/:id` | `usuarios-service` | `GET /usuarios`, `GET /usuarios/:id` |
| `POST /users`, `PUT /users/:id` | `usuarios-service` | `POST /usuarios`, `PUT /usuarios/:id` (ya sin pasar por Raft) |
| `DELETE /users/:id` | `usuarios-service` | `DELETE /usuarios/:id`, que pasa a baja lógica (`activo = false`) |
| `GET /reservas` | `eventos-service` | `GET /eventos`, `GET /eventos/:id` |
| `POST /reservas/:id/reservar` | `eventos-service` (regla y lock) | `POST /eventos/:id/reservar-aforo`, interno. El cliente ahora compra con `POST /ordenes` en `entradas-service` |
| `/raft/*` (`status`, `log`, `request-vote`, `append-entries`, `command`) | Ninguno | No se migra (ver decisión de Raft) |
| `GET /api-docs` | Cada servicio | Cada servicio publica su propio Swagger |
| `GET /` | Ninguno | Se reemplaza por `GET /health` en cada servicio |

Ninguna regla de negocio queda implementada en dos servicios: la unicidad y validez de datos personales es de Usuarios, la capacidad es de Eventos, y el máximo por usuario, el uso único del ticket y el plazo de cancelación son de Entradas.

## 3. Decisiones de implementación

| Tema | Decisión | Motivo |
|---|---|---|
| **Raft** | No se migra a ningún servicio. Es un cambio respecto del TP5, donde era "candidato" para Eventos | Es un mecanismo técnico, no una responsabilidad de negocio. El TP6 pide conservar la exclusión mutua (el lock Redis) y no menciona el consenso. Cada servicio corre una sola instancia |
| **Concurrencia** | Se conserva el lock de Redis del TP2, con clave `lock:evento:{id}`, TTL configurable y `423` si está ocupado. La espera de 2 s de la demo no se migra | Es la regla que garantiza no vender más que el aforo |
| **HTTPS** | Comunicación interna por HTTP simple dentro de la red Docker. Los servicios publicados al host también usan HTTP | El TP6 permite HTTP entre contenedores. Se documenta en el README |
| **Puertos** | Local: 3001 (usuarios), 3002 (eventos), 3003 (entradas). En Compose todos escuchan el 3000 por dentro y se publican como 3001, 3002 y 3003 | Se diferencia puerto interno de puerto publicado. Las bases y Redis no se publican |
| **Persistencia** | Una instancia de MongoDB por servicio: `usuarios-db`, `eventos-db` y `entradas-db`, con volúmenes nombrados. Un solo Redis, que usa solo Eventos | Independencia de datos. Ningún servicio accede a la base de otro |
| **Variables** | `SERVICE_NAME`, `PORT`, `LOG_LEVEL`, `MONGODB_URI`, `REDIS_URL`, `USUARIOS_SERVICE_URL`, `EVENTOS_SERVICE_URL`, `REQUEST_TIMEOUT_MS`, `MAX_ENTRADAS_POR_USUARIO`, `PLAZO_CANCELACION_HORAS` | Mismo código local y en Docker; solo cambia la configuración |
| **Estructura** | `services/<servicio>/src/{routes,controllers,services,clients,models,config}` más `app.js` y `server.js` | Separa HTTP, negocio y dependencias externas |
| **Logs** | Winston a stdout en formato JSON, con el nombre del servicio en cada línea | Se consultan con `docker compose logs <servicio>` |
| **Errores entre servicios** | Cliente HTTP con timeout. `404` remoto se trata como error funcional, `409` se propaga, `423` se puede reintentar. Timeout, DNS o conexión rechazada y `5xx` responden `503` y quedan registrados | Cumple la tabla 15.2 del TP6 |
| **Idempotencia** | `reservar-aforo` y `liberar-aforo` son idempotentes por `referencia` (`ordenId`) | Un reintento no descuenta ni devuelve dos veces |

## 4. Reparto de tareas y ramas

| Rama | Qué incluye | Depende de | Responsable |
|---|---|---|---|
| `feature/usuarios-service` | CRUD con MongoDB, validaciones, baja lógica, Swagger | Nada | COMPLETAR |
| `feature/eventos-service` | Eventos, estados, reservar y liberar aforo con lock Redis e idempotencia | Nada | COMPLETAR |
| `feature/entradas-service` | Órdenes, tickets, validación, orquestación de la compra con los clientes HTTP | Contratos de los otros dos (puede avanzar con respuestas simuladas) | COMPLETAR |
| `feature/docker-servicios` | `Dockerfile` y `.dockerignore` de cada servicio, build individual | Cada servicio funcionando con `npm start` | COMPLETAR |
| `feature/compose-integration` | `docker-compose.yml`, red, volúmenes, healthchecks, `.env.example` raíz | Dockerfiles | COMPLETAR |
| `docs/tp6-pruebas-y-readme` | Datos de prueba, pruebas obligatorias, fallo parcial, README final, evidencias | Compose funcionando | COMPLETAR |

**Orden:** primero cada servicio corriendo con Node sin Docker, después los Dockerfiles, después Compose y, al final, pruebas y documentación. Cada integrante hace sus commits en su rama y los integra a `main` con Pull Request.
