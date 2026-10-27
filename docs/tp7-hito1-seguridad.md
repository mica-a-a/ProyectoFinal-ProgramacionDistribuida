# TP7 – Hito 1: Modelo de seguridad y clasificación de endpoints

**Programación Distribuida – Licenciatura en Sistemas de Información – UCH**

Antes de escribir código revisamos los endpoints reales de los tres servicios del TP6 y definimos qué identidad existe en el dominio, quién emite y valida los tokens, y qué operaciones son públicas, autenticadas o restringidas por rol. Este documento es la referencia común para implementar el resto del TP7.

---

## 1. Decisiones previas

| Tema | Decisión | Justificación |
|---|---|---|
| **Componente de identidad** | Se integra en `usuarios-service` (no se crea un cuarto servicio) | Usuarios ya es el dueño de las personas. Un servicio nuevo duplicaría usuarios y credenciales, y la consigna penaliza dividir de más |
| **Roles** | `USER` y `ADMIN` (un único rol por usuario, en el campo `role`) | Es el mínimo pedido y alcanza para el dominio: comprar entradas vs. administrar eventos y usuarios |
| **Firma del JWT** | HS256 (clave simétrica) con el secreto en `JWT_SECRET` | Es el mínimo permitido. Una ampliación posible es RS256, para que solo Usuarios tenga la clave privada |
| **Vencimiento** | `JWT_EXPIRES_IN=1h`, configurable | Todo token tiene `exp`; no hay tokens sin vencimiento |
| **Hash de contraseñas** | bcrypt mediante `bcryptjs`, con `BCRYPT_ROUNDS` configurable | `bcryptjs` es JavaScript puro: no necesita compilar en las imágenes Alpine de Docker. El salt lo maneja la biblioteca |
| **Registro** | `POST /auth/register` es público y **siempre crea `USER`**. Un `ADMIN` se crea por seed o por alta administrada (`POST /usuarios`, solo ADMIN) | El cliente nunca elige su rol |
| **Cuenta deshabilitada** | Se responde **403** `CUENTA_DESHABILITADA`, pero solo cuando la contraseña es correcta | Si la contraseña es incorrecta se responde 401 genérico, así no se revela si la cuenta existe o está deshabilitada a quien no conoce las credenciales |
| **Propagación entre servicios** | Entradas reenvía el `Authorization: Bearer` que recibió del cliente | La consigna lo admite (sección 13) y evita crear un mecanismo nuevo |
| **Middleware** | Un middleware de autenticación y uno de roles por servicio, con el mismo código en los tres | Los servicios son independientes: no comparten código ni paquetes |
| **Contraseñas del seed** | Salen de variables de entorno (`SEED_ADMIN_PASSWORD`, `SEED_USER_PASSWORD`) con valores ficticios en `.env.example` | No se versionan contraseñas reales |

## 2. Qué identidad existe, quién la necesita y qué exige autorización adicional

**Qué identidad existe en el dominio.** La identidad es la **persona registrada**, que ya existe en `usuarios-service` (con `dni`, `email` y `activo`). Un token representa a esa persona durante un tiempo limitado, con su identificador (`sub`) y su rol (`role`).

**Qué endpoints necesitan conocerla.**

- **Entradas:** toda operación de compra, consulta, cancelación y listado de entradas se hace *en nombre de* un usuario, así que necesita su `sub` para aplicar la regla de propiedad.
- **Usuarios:** los datos personales (DNI, email, dirección) son del propio usuario o de un administrador.
- **Eventos:** no necesita saber *quién* es la persona; necesita saber *si es administrador* para gestionar eventos, y que la llamada llegue autenticada para modificar el aforo.

**Qué operaciones requieren autorización adicional (más que estar autenticado).**

- **Rol `ADMIN`:** crear, modificar, cancelar y finalizar eventos; listar, crear y dar de baja usuarios; validar tickets en la puerta.
- **Propiedad del recurso:** un `USER` solo puede ver o modificar sus propios datos, y comprar, consultar o cancelar sus propias órdenes y tickets.

## 3. Matriz de endpoints (sección 4 de la consigna)

Incluye los 25 endpoints que ya existen en la solución más los 2 nuevos de autenticación (27 en total).

| Servicio | Endpoint | Acceso | Rol / permiso | Justificación |
|---|---|---|---|---|
| usuarios | `POST /auth/register` *(nuevo)* | Público | — | Auto-registro. Siempre crea `USER`; no acepta el campo `role` |
| usuarios | `POST /auth/login` *(nuevo)* | Público | — | Es la puerta de entrada: valida credenciales y emite el token |
| usuarios | `GET /usuarios` | Restringido | `ADMIN` | Lista los datos personales de todos |
| usuarios | `POST /usuarios` | Restringido | `ADMIN` | Alta administrada. Es el camino para crear otro `ADMIN` |
| usuarios | `GET /usuarios/:id` | Autenticado | `USER` (solo el propio) o `ADMIN` | Datos personales. Entradas lo consulta con el token propagado |
| usuarios | `PUT /usuarios/:id` | Autenticado | `USER` (solo el propio) o `ADMIN` | Un `USER` no puede cambiar `role` ni `activo`. No modifica la contraseña |
| usuarios | `DELETE /usuarios/:id` | Restringido | `ADMIN` | Baja lógica: deshabilita una identidad |
| usuarios | `GET /health` | Público | — | Healthcheck de Docker; no expone datos |
| usuarios | `GET /api-docs` | Público | — | Documentación; permite probar el login desde Swagger |
| eventos | `GET /eventos` | Público | — | Catálogo de consulta, sin datos personales |
| eventos | `GET /eventos/:id` | Público | — | Ídem; también lo usa Entradas |
| eventos | `POST /eventos` | Restringido | `ADMIN` | Crea información administrada |
| eventos | `PUT /eventos/:id` | Restringido | `ADMIN` | Modifica información administrada |
| eventos | `PATCH /eventos/:id/cancelar` | Restringido | `ADMIN` | Afecta a todos los compradores |
| eventos | `PATCH /eventos/:id/finalizar` | Restringido | `ADMIN` | Cambia el estado del evento |
| eventos | `POST /eventos/:id/reservar-aforo` | Autenticado | `USER` o `ADMIN` | Interno: lo invoca Entradas con el token propagado (ver sección 7) |
| eventos | `POST /eventos/:id/liberar-aforo` | Autenticado | `USER` o `ADMIN` | Interno: ídem |
| eventos | `GET /health`, `GET /ready` | Público | — | Salud del servicio y de sus dependencias |
| eventos | `GET /api-docs` | Público | — | Documentación |
| entradas | `POST /ordenes` | Autenticado | `USER` (solo para sí mismo) o `ADMIN` | Compra asociada a un usuario |
| entradas | `GET /ordenes/:id` | Autenticado | Dueño de la orden o `ADMIN` | Propiedad del recurso |
| entradas | `DELETE /ordenes/:id` | Autenticado | Dueño de la orden o `ADMIN` | Cancelar es una operación del dueño |
| entradas | `GET /entradas?usuarioId=` | Autenticado | `USER` (solo el propio) o `ADMIN` | Tickets de un usuario |
| entradas | `POST /entradas/validar` | Restringido | `ADMIN` | Lo hace el personal de control de acceso. Si un `USER` pudiera validar, podría "gastar" tickets ajenos |
| entradas | `GET /health` | Público | — | Healthcheck |
| entradas | `GET /api-docs` | Público | — | Documentación |

## 4. Clasificación pública, autenticada y restringida (sección 10)

| Acceso | Cantidad | Endpoints | Criterio |
|---|---|---|---|
| **Público** | 11 | `/auth/register`, `/auth/login`, `/health` (x3), `/ready`, `/api-docs` (x3), `GET /eventos`, `GET /eventos/:id` | No exponen datos personales ni modifican nada, o son la única forma de obtener un token |
| **Autenticado** | 8 | Compra, consulta y cancelación de órdenes, listado de entradas, `GET` y `PUT /usuarios/:id`, `reservar-aforo` y `liberar-aforo` | Operaciones asociadas a una persona; se agrega la regla de propiedad |
| **Restringido** | 8 | Gestión de eventos (4), `GET`, `POST` y `DELETE /usuarios`, `POST /entradas/validar` | Modifican información administrada o exponen datos de terceros |

**Por qué no protegimos todo.** `/health` debe poder consultarse sin token para que Docker Compose lo use en el healthcheck. `/api-docs` es documentación y es desde donde se prueba el login. La consulta de eventos es el catálogo del sistema: no tiene datos personales y no tiene sentido exigir una cuenta para ver qué eventos hay.

## 5. Matriz Público / USER / ADMIN (sección 11)

| Servicio | Endpoint | Público | USER | ADMIN |
|---|---|---|---|---|
| usuarios | `POST /auth/register` | Sí | Sí | Sí |
| usuarios | `POST /auth/login` | Sí | Sí | Sí |
| usuarios | `GET /usuarios` | No | No | Sí |
| usuarios | `POST /usuarios` | No | No | Sí |
| usuarios | `GET /usuarios/:id` | No | Sí (solo el propio) | Sí |
| usuarios | `PUT /usuarios/:id` | No | Sí (solo el propio, sin `role` ni `activo`) | Sí |
| usuarios | `DELETE /usuarios/:id` | No | No | Sí |
| eventos | `GET /eventos`, `GET /eventos/:id` | Sí | Sí | Sí |
| eventos | `POST /eventos`, `PUT /eventos/:id` | No | No | Sí |
| eventos | `PATCH /eventos/:id/cancelar`, `/finalizar` | No | No | Sí |
| eventos | `POST /eventos/:id/reservar-aforo`, `/liberar-aforo` | No | Sí | Sí |
| entradas | `POST /ordenes` | No | Sí (solo para sí mismo) | Sí |
| entradas | `GET /ordenes/:id`, `DELETE /ordenes/:id` | No | Sí (solo las propias) | Sí |
| entradas | `GET /entradas?usuarioId=` | No | Sí (solo el propio) | Sí |
| entradas | `POST /entradas/validar` | No | No | Sí |
| todos | `GET /health`, `GET /api-docs` (y `/ready`) | Sí | Sí | Sí |

**401 y 403.** Responde `401` cuando no hay una identidad válida (sin token, mal formado, firma inválida o vencido) y `403` cuando la identidad es válida pero no alcanza el rol o no es la dueña del recurso.

## 6. Propiedad del recurso (sección 11.2)

El dominio tiene recursos que pertenecen a un usuario (órdenes, tickets y el perfil), así que el rol por sí solo no alcanza.

| Recurso | Regla | Quién la aplica |
|---|---|---|
| Orden (`GET`, `DELETE`) | El `sub` del token debe coincidir con el `usuarioId` de la orden, salvo `ADMIN` | `entradas-service` |
| Compra (`POST /ordenes`) | Un `USER` solo puede comprar con su propio `usuarioId` | `entradas-service` |
| Entradas (`GET /entradas`) | Un `USER` solo puede consultar su propio `usuarioId` | `entradas-service` |
| Perfil (`GET`, `PUT /usuarios/:id`) | El `:id` debe coincidir con el `sub`, salvo `ADMIN`. Un `USER` no puede cambiar `role` ni `activo` | `usuarios-service` |

Cada regla la aplica el servicio dueño del recurso: **Usuarios no decide quién puede ver una orden**, y Entradas no decide quién puede ver un perfil.

## 7. Endpoints internos y propagación del token (sección 13)

Entradas reenvía el `Authorization: Bearer` del cliente en sus llamadas a Usuarios (`GET /usuarios/:id`) y a Eventos (`GET /eventos/:id`, `reservar-aforo` y `liberar-aforo`).

```text
Cliente ──Authorization: Bearer JWT──► Entradas ──Authorization: Bearer JWT──► Usuarios
                                          └──────Authorization: Bearer JWT──► Eventos
```

**Decisión sobre `reservar-aforo` y `liberar-aforo`:** quedan protegidos y exigen un token válido de cualquier rol (`USER` o `ADMIN`). Como Entradas propaga el token del comprador, no se puede exigir `ADMIN`.

**Limitación que dejamos anotada:** el puerto de Eventos está publicado hacia el host, por lo que un usuario autenticado podría llamar a `reservar-aforo` directamente, sin pasar por Entradas, y consumir aforo sin generar una orden. Como mejora futura: un rol o token de servicio (por ejemplo, un rol `SERVICE`) para estos dos endpoints, o dejar de publicar el puerto de Eventos y acceder solo desde la red interna.

## 8. Autenticación en la arquitectura de microservicios (sección 12)

| Pregunta de la consigna | Respuesta |
|---|---|
| ¿Qué componente emite los tokens? | Solo `usuarios-service`, en `POST /auth/login` |
| ¿Qué servicios validan tokens? | Los tres, cada uno en sus endpoints protegidos, con su propio middleware |
| ¿Qué información del token usa cada servicio? | **Usuarios:** `sub` (propiedad) y `role`. **Eventos:** `role` (exige `ADMIN` para gestionar). **Entradas:** `sub` (dueño de la orden) y `role` |
| ¿Cómo se comparte la configuración para verificar la firma? | `JWT_SECRET` se define una sola vez en el `.env` raíz y `docker-compose.yml` lo entrega a los tres servicios. Cada servicio verifica la firma **localmente**, sin consultar la base de usuarios |
| ¿Qué pasa si Usuarios no está disponible después de emitir un token? | Eventos y Entradas **siguen validando tokens** porque no dependen de Usuarios para eso. Lo que deja de funcionar es el login y el registro, y las compras (Entradas consulta a Usuarios, y responde `503` como en el TP6). La gestión de eventos sigue funcionando |

**Limitaciones asumidas.** No hay revocación de tokens: una cuenta deshabilitada conserva su token hasta que vence (por eso la vida corta, de 1 hora). Y como la clave es simétrica, cualquier servicio que tenga `JWT_SECRET` podría firmar tokens; con firma asimétrica (RS256) solo Usuarios podría hacerlo.

## 9. Contrato común para la implementación

Para que los tres servicios y las pruebas sean consistentes:

| Aspecto | Valor |
|---|---|
| Encabezado | `Authorization: Bearer <token>` |
| Algoritmo | HS256, fijado explícitamente al firmar y al verificar (`algorithms: ['HS256']`) |
| Claims | `sub` (id del usuario, string), `role` (`USER` o `ADMIN`), `iat`, `exp` y `iss` (`usuarios-service`) |
| El token **no** incluye | Contraseña, hash, secretos ni datos personales (ni siquiera el email) |
| Identidad en el request | El middleware deja `req.auth = { sub, role }` |
| Middlewares | `autenticar` (responde 401) y `requerirRol(...roles)` (responde 403) |
| Variables de entorno | `JWT_SECRET` (los tres servicios), `JWT_EXPIRES_IN` e `JWT_ISSUER` (emisor), `BCRYPT_ROUNDS`, `SEED_ADMIN_PASSWORD`, `SEED_USER_PASSWORD` |
| Cuerpo de los errores | `{ "message": "...", "code": "..." }`, igual que en el TP6. Sin stack traces |

| Estado | Código | `code` |
|---|---|---|
| Datos inválidos | 400 | `VALIDACION` |
| Usuario o contraseña incorrectos | 401 | `CREDENCIALES_INVALIDAS` (mensaje genérico, sin revelar cuál falló) |
| Sin token | 401 | `TOKEN_AUSENTE` |
| Token mal formado, firma inválida o algoritmo no esperado | 401 | `TOKEN_INVALIDO` |
| Token vencido | 401 | `TOKEN_VENCIDO` |
| Rol insuficiente o recurso ajeno | 403 | `PERMISOS_INSUFICIENTES` |
| Cuenta deshabilitada (con contraseña correcta) | 403 | `CUENTA_DESHABILITADA` |
| Email o DNI ya existentes | 409 | `EMAIL_DUPLICADO` / `DNI_DUPLICADO` (ya existen) |
| Error interno | 500 | Mensaje genérico, sin detalles |

## 10. Cambios de responsabilidad y límites

| Servicio | Antes (TP6) | Con el TP7 | Sigue fuera de su alcance |
|---|---|---|---|
| `usuarios-service` | Datos personales de las personas | **Además:** credenciales (`passwordHash`, `role`), registro, login y emisión de JWT | Reglas de eventos, aforo, compras y tickets |
| `eventos-service` | Eventos y aforo, sin noción de identidad | Valida el JWT y exige `ADMIN` para gestionar eventos | Saber quién es cada persona; consultar la base de usuarios |
| `entradas-service` | Compra y tickets, sin noción de identidad | Valida el JWT, aplica la propiedad de órdenes y tickets y propaga el token | Credenciales y datos personales |

**No centralizamos reglas de negocio en el componente de autenticación.** Usuarios solo emite una identidad (`sub` y `role`); cada servicio decide qué puede hacer con ella. La regla "un usuario solo ve sus órdenes" vive en Entradas, y la regla "solo un administrador gestiona eventos" vive en Eventos.

## 11. Impacto sobre lo ya existente (para coordinar el resto del TP7)

| Qué se ve afectado | Qué hay que adaptar |
|---|---|
| Modelo y seed de usuarios | Agregar `passwordHash` y `role`; el seed debe incluir al menos un `ADMIN` con contraseña con hash |
| Tests de los tres servicios | Las peticiones a endpoints protegidos necesitan un token (conviene un helper que firme tokens de prueba) |
| `scripts/tp6/pruebas.js` y `concurrencia.js` | Hacer login y enviar el `Bearer`; el dato de prueba debe incluir un `ADMIN` y un `USER` con contraseña |
| Clientes HTTP de Entradas | Reenviar el `Authorization` recibido |
| `docker-compose.yml` y `.env.example` | Pasar `JWT_SECRET` y el resto de variables nuevas a cada servicio |
| Swagger de cada servicio | Esquema Bearer, roles y respuestas 401 y 403 |
| `package.json` y `package-lock.json` | Agregar `jsonwebtoken` y `bcryptjs` donde se usen; los Dockerfile usan `npm ci`, así que el lock debe estar actualizado |
