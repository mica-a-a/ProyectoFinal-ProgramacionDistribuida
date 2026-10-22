# Arquitectura propuesta: de API REST a Microservicios

**Materia:** Programación Distribuida · Licenciatura en Sistemas de Información
**Trabajo Práctico N° 5:** De API REST a Microservicios
**Trabajo Práctico N° 6:** Implementación de Microservicios y Docker (ver [§11](#11-tp6-arquitectura-implementada-y-cambios-respecto-del-tp5))
**Fecha:** `COMPLETAR`
**Grupo:** `2`
**Integrantes:** Bazan Franco · Gorri Juan · Le Donne Micaela · Molina Agostina · Nievas Milagros

> **Dominio elegido:** Eventos y entradas. Usuarios registrados compran entradas para eventos con aforo limitado, reciben un ticket y lo presentan en el ingreso, donde se valida.

## Índice

1. [Punto de partida y alcance](#1-punto-de-partida-y-alcance)
2. [Análisis de la aplicación existente (inventario)](#2-análisis-de-la-aplicación-existente-inventario)
3. [Identificación de responsabilidades](#3-identificación-de-responsabilidades)
4. [Identificación de acoplamientos](#4-identificación-de-acoplamientos)
5. [Propuesta de microservicios](#5-propuesta-de-microservicios)
6. [Propiedad y acceso a los datos](#6-propiedad-y-acceso-a-los-datos)
7. [Comunicación entre microservicios](#7-comunicación-entre-microservicios)
8. [Trazado de casos de uso](#8-trazado-de-casos-de-uso)
9. [Diagrama de arquitectura](#9-diagrama-de-arquitectura)
10. [Validación de los límites propuestos (checklist)](#10-validación-de-los-límites-propuestos-checklist)
11. [TP6: arquitectura implementada y cambios respecto del TP5](#11-tp6-arquitectura-implementada-y-cambios-respecto-del-tp5)

> La numeración de este documento es propia; entre paréntesis se indica a qué sección de la consigna del TP5 corresponde cada parte.

---

## 1. Punto de partida y alcance

La aplicación base es la API desarrollada en los trabajos anteriores, que está en la carpeta [`app-base/`](../app-base/) (versión del TP4):

| TP | Aporte a la aplicación |
|----|------------------------|
| TP1 | API REST con CRUD de usuarios (Node.js + Express), datos en memoria |
| TP2 | HTTPS con certificado autofirmado; recurso de reservas de cupo con condición de carrera y exclusión mutua mediante lock en Redis/Memurai (TTL 5 s) |
| TP3 | Persistencia en MongoDB con Mongoose (usuarios y reservas), logging con Winston (rotación y retención), documentación OpenAPI/Swagger |
| TP4 | Cluster de 3 nodos con Raft educativo: elección de Leader, log replicado, State Machine sobre el CRUD de usuarios, integración Redis + Raft |

**Alcance de este TP:** análisis y diseño. No se implementan los microservicios; se deja documentada y justificada la arquitectura para comenzar la migración del código en los trabajos siguientes.

> **Nota de fuentes:** armamos el inventario leyendo el código de `app-base/`: `src/app.js`, `src/server.js`, `src/routes/`, `src/models/` y `src/raft/`. Los nombres de rutas, campos y códigos de respuesta son los de esa versión.

---

## 2. Análisis de la aplicación existente (inventario)
*(Sección 5 de la consigna)*

### 2.1 Recursos y entidades principales

| Recurso / entidad | Campos | Origen |
|-------------------|--------|--------|
| **Usuario** | `_id`, `nombre`, `apellido`, `email` (único), `edad`, `createdAt`, `updatedAt` | TP1, persistido en MongoDB desde TP3. Cada nodo del cluster tiene su propia base |
| **Reserva (cupo)** | `_id`, `nombre`, `disponibles` (entero ≥ 0), `createdAt`, `updatedAt` | TP2, persistido en MongoDB |
| **Estado Raft** | término actual, voto, log, `commitIndex`, `lastApplied` | TP4, persistido en MongoDB por cada nodo |
| **Lock** | clave `lock:reserva:{id}` con TTL de 5000 ms | TP2, almacenado en Redis |

### 2.2 Inventario de funcionalidades y endpoints

| Funcionalidad / endpoint | Responsabilidad actual | Datos utilizados | Dependencias |
|--------------------------|------------------------|------------------|--------------|
| `GET /users` | Listar todos los usuarios | Colección de usuarios | MongoDB (Mongoose) |
| `GET /users/:id` | Consultar un usuario; 400 si el id es inválido, 404 si no existe | Usuario | MongoDB |
| `POST /users` | Alta de usuario. Solo la atiende el Leader (si no, 409 con `leaderId`); 400 por validación, 409 por email duplicado, 503 si no hay quórum | Usuario | Raft (`appendCommand`), State Machine, MongoDB |
| `PUT /users/:id` | Modificación de un usuario, con las mismas reglas de Leader y quórum | Usuario | Raft, State Machine, MongoDB |
| `DELETE /users/:id` | Baja física de un usuario, con las mismas reglas de Leader y quórum | Usuario | Raft, State Machine, MongoDB |
| `GET /reservas` | Consultar los recursos de reserva y sus `disponibles` | Reserva | MongoDB |
| `POST /reservas/:id/reservar` | Descontar un cupo: toma el lock, verifica `disponibles > 0`, descuenta, libera el lock. 404 si el recurso no existe, 409 si no hay cupos, 423 si está bloqueado. Incluye una espera de 2 s dentro de la sección crítica para demostrar la exclusión mutua | Reserva | Redis (lock con `NX` y TTL), MongoDB |
| `GET /raft/status`, `GET /raft/log` | Diagnóstico del nodo (identidad, rol, término, Leader conocido, commit index) y consulta del log | Estado Raft | Módulo Raft |
| `POST /raft/request-vote`, `POST /raft/append-entries` | RPC internos: elección de Leader, heartbeats y replicación del log | Término, voto, log | HTTP entre nodos |
| `POST /raft/command` | Incorporar una operación al log de Raft (solo Leader; 409 si no lo es, 503 sin quórum) | Operación | Raft, State Machine |
| `GET /api-docs`, `GET /api-docs.json` | Documentación OpenAPI/Swagger de la API | Especificación OpenAPI | swagger-ui-express |
| `GET /` | Mensaje de bienvenida | Ninguno | Ninguna |
| Logging (transversal) | Registro INFO/WARN/ERROR con rotación y retención de 7 días | Archivos `logs/` | Winston |
| HTTPS (transversal) | Cifrado de la API externa (puertos 3443 a 3445) | Certificado y clave de desarrollo | Variables de entorno y archivos en `certs/` |

### 2.3 Reglas de negocio y validaciones existentes

- Usuario: `nombre` y `apellido` (mínimo 2 caracteres), `email` con formato válido y `edad` entera mayor a 0 son obligatorios (400 ante error de validación).
- Usuario: el `email` debe ser único (409 ante duplicado). No existe unicidad de DNI porque la aplicación base no tiene ese campo.
- Usuario: el `id` debe tener formato válido (400) y existir (404).
- Usuario: toda escritura se atiende solo en el Leader y se aplica cuando está confirmada por mayoría (503 si no hay quórum).
- Reserva: no se descuenta un cupo si `disponibles <= 0` (409).
- Reserva: un solo proceso a la vez puede modificar un mismo recurso (lock por recurso; 423 si está ocupado).
- Reserva: el lock tiene TTL de 5 s para no bloquear indefinidamente ante una falla, y solo lo libera quien lo tomó (se compara el valor).
- Raft: una escritura no se aplica hasta estar *committed* por mayoría; una escritura recibida por un follower no se aplica localmente.

### 2.4 Módulos, persistencia e información compartida

| Aspecto | Situación actual |
|---------|------------------|
| Módulos | `src/server.js` (arranque: HTTPS, API interna de Raft, conexión a Mongo y Redis, temporizador de elecciones), `src/app.js` (monta las rutas de usuarios, reservas, Raft y Swagger), `src/routes/` (`users`, `reservas`, `raft`), `src/models/` (`User`, `Reserva`), `src/raft/` (elección, replicación, estado y State Machine), `src/config/cluster.js`, `src/logger.js` |
| Persistencia | MongoDB para usuarios, reservas y estado de Raft (una base por nodo: `user-api-node1`, `node2`, `node3`); Redis solo para locks |
| Información compartida | El modelo `User` lo usan el CRUD y la State Machine de Raft. El handler de usuarios importa el estado y la replicación de Raft. La reserva y su lock se manejan dentro del mismo handler. El mismo `app` de Express atiende la API pública y el puerto interno de Raft |

---

## 3. Identificación de responsabilidades
*(Sección 6 de la consigna)*

Las funcionalidades se agrupan por la responsabilidad funcional que cumplen, no por archivos ni controladores.

### Grupo A: Gestión de la identidad de las personas

| Pregunta | Respuesta |
|----------|-----------|
| 1. ¿Qué problema resuelve? | Saber quiénes son las personas que usan el sistema y mantener sus datos personales sin duplicados. |
| 2. ¿Qué operaciones realiza? | Alta, consulta, modificación y baja de usuarios. |
| 3. ¿Qué reglas contiene? | Campos obligatorios y con formato válido, unicidad de email. |
| 4. ¿Qué información necesita? | Solo los datos de la persona. |
| 5. ¿Qué crea o modifica? | Perfil de usuario. |
| 6. ¿Qué otras funcionalidades necesita conocer? | Ninguna. |
| 7. ¿Qué cambios suelen ocurrir juntos? | Nuevos datos del perfil y sus validaciones (por ejemplo, DNI, fecha de nacimiento o estado activo/inactivo). |
| 8. ¿Podría evolucionar independiente? | **Sí.** Es la parte más autónoma de la aplicación. |

### Grupo B: Venta de lugares sobre un recurso con capacidad limitada
*(hoy llamado "reserva de cupo")*

| Pregunta | Respuesta |
|----------|-----------|
| 1. ¿Qué problema resuelve? | Evitar que se entreguen más lugares que la capacidad disponible, aun con pedidos simultáneos. |
| 2. ¿Qué operaciones realiza? | Consultar disponibilidad y descontar un lugar. |
| 3. ¿Qué reglas contiene? | No hay venta sin disponibilidad; exclusión mutua por recurso; TTL del lock. |
| 4. ¿Qué información necesita? | Recurso (nombre, disponibles) y el lock en Redis. |
| 5. ¿Qué crea o modifica? | El contador `disponibles`. |
| 6. ¿Qué otras funcionalidades necesita conocer? | Hoy ninguna, pero **no sabe quién reserva ni para qué evento**. |
| 7. ¿Qué cambios suelen ocurrir juntos? | Reglas de capacidad (aforo, overbooking, estados del recurso) cambian juntas. En cambio, las reglas de "quién puede comprar y cuántas veces" cambian por otro motivo. |
| 8. ¿Podría evolucionar independiente? | **Parcialmente.** Mezcla dos responsabilidades: controlar la capacidad del recurso y registrar la operación de cada persona. Conviene separarlas. |

### Grupo C: Consenso y replicación del estado

| Pregunta | Respuesta |
|----------|-----------|
| 1. ¿Qué problema resuelve? | Que varias réplicas acuerden un orden único de operaciones y toleren la caída de un nodo. |
| 2. ¿Qué operaciones realiza? | Elección de Leader, heartbeats, replicación del log, commit, aplicación en la State Machine. |
| 3. ¿Qué reglas contiene? | Quórum por mayoría, un voto por término, commit solo con mayoría. |
| 4. ¿Qué información necesita? | Término, voto, log, lista de peers. |
| 5. ¿Qué crea o modifica? | Log replicado y estado confirmado. |
| 6. ¿Qué otras funcionalidades necesita conocer? | Hoy su State Machine aplica comandos (`CREATE_USER`, `UPDATE_USER`, `DELETE_USER`) directamente sobre el modelo de Usuario. |
| 7. ¿Qué cambios suelen ocurrir juntos? | Protocolo y State Machine. |
| 8. ¿Podría evolucionar independiente? | **Sí, como mecanismo.** No es una responsabilidad de negocio: es una técnica de replicación que se aplica a algún servicio, no un servicio de negocio. |

### Grupo D: Servicios transversales (seguridad, logs, documentación)

| Pregunta | Respuesta |
|----------|-----------|
| 1. ¿Qué problema resuelve? | Seguridad del transporte, trazabilidad y documentación de la API. |
| 2. ¿Qué operaciones realiza? | Cifrado HTTPS, registro de eventos con rotación, publicación de Swagger. |
| 3. ¿Qué reglas contiene? | No registrar secretos; niveles INFO/WARN/ERROR; retención limitada. |
| 4. ¿Qué información necesita? | Certificado, configuración de entorno, especificación OpenAPI. |
| 5. ¿Qué crea o modifica? | Archivos de log. |
| 6. ¿Qué otras funcionalidades necesita conocer? | Todas (las atraviesa). |
| 7. ¿Qué cambios suelen ocurrir juntos? | Formato de logs y su configuración; documentación de cada endpoint cuando este cambia. |
| 8. ¿Podría evolucionar independiente? | Es **infraestructura compartida**: cada servicio la incorpora, no se convierte en un servicio propio. |

### Conclusión del análisis

| Grupo actual | Destino en la arquitectura propuesta |
|--------------|--------------------------------------|
| A: Identidad de personas | **Servicio Usuarios** |
| B: Venta de lugares | Se **divide**: control de capacidad en el **servicio Eventos**; compra y ticket de cada persona en el **servicio Entradas** |
| C: Consenso y replicación | No es un servicio; se conserva como mecanismo a aplicar sobre el servicio que requiera consistencia fuerte (candidato: Eventos) |
| D: Transversales | Cada servicio incorpora HTTPS, Winston y Swagger |

---

## 4. Identificación de acoplamientos
*(Sección 7 de la consigna)*

| Caso | Acoplamiento detectado | Problema generado | Propuesta de desacople |
|------|------------------------|-------------------|------------------------|
| **1** | **Aplicación monolítica en un solo proceso:** `src/server.js` arranca el servidor HTTPS, el servidor interno de Raft, conecta a MongoDB y a Redis, y `src/app.js` monta en la misma aplicación las rutas de usuarios, reservas, Raft y Swagger. Existe porque se fue agregando funcionalidad sobre el proyecto del TP1. | Un cambio en reservas obliga a redesplegar y reprobar también usuarios; una falla de Redis afecta el arranque de toda la aplicación (`server.js` conecta a Redis antes de abrir los puertos); no se puede escalar una parte sin la otra. Además, las rutas internas de Raft quedan publicadas en el mismo `app` que la API pública. | Un proceso por responsabilidad (Usuarios, Eventos, Entradas), cada uno con su configuración y su base. |
| **2** | **Regla de negocio, lock y respuesta HTTP en el mismo handler de `POST /reservas/:id/reservar` (`src/routes/reservas.routes.js`):** la decisión "no hay cupos", la coordinación con Redis y el armado de la respuesta están mezcladas. Existe porque la protección contra la condición de carrera se agregó dentro del handler del TP2. | La regla de capacidad no se puede reutilizar ni probar sin HTTP y Redis; cualquier nuevo caso que consuma lugares (cancelar, vender varios) duplica la lógica. | Concentrar la capacidad y el lock en un único servicio (**Eventos**), con operaciones internas `reservar-aforo` y `liberar-aforo`. Quien quiera consumir lugares lo pide por API. |
| **3** | **State Machine de Raft aplicando comandos directamente sobre el modelo de Usuario (Mongoose):** `src/raft/stateMachine.js` importa `User` y resuelve `CREATE_USER`, `UPDATE_USER` y `DELETE_USER`; a su vez `src/routes/users.routes.js` importa el estado y la replicación de Raft. Existe porque en el TP4 se integró el CRUD existente al log. | Agregar un recurso nuevo exige modificar el módulo de consenso; no se puede cambiar el modelo sin tocar la replicación; los handlers HTTP no se pueden probar sin Raft. | Que el consenso sea un mecanismo genérico (comandos opacos) y que cada servicio aporte su propia State Machine. Raft no se publica como servicio de negocio. |
| **4** | **Recurso de reserva sin dueño ni contexto:** el cupo no sabe qué evento representa ni quién lo reservó; la operación de la persona y el contador viven juntos. Existe porque el TP2 tenía un único recurso de demostración. | No se puede saber quién tiene lugar, ni impedir que una persona tome muchos lugares, ni cancelar correctamente; cualquier regla de "por persona" obliga a modificar el contador. | Separar **capacidad del evento** (Eventos) de **orden y ticket de la persona** (Entradas). Entradas guarda el `usuarioId` y valida al usuario consultando a Usuarios. |
| **5** | **Información de usuario compartida implícitamente:** el recurso de reserva no tiene ningún vínculo con el usuario; si otro módulo necesita saber si un usuario existe o está habilitado, hoy lo resolvería leyendo el modelo `User` directamente. | Acceso directo a datos ajenos: un cambio en el esquema rompe a los consumidores. | Consultar al servicio Usuarios por su API pública (`GET /usuarios/:id`) y usar solo `id` y `activo`. |

---

## 5. Propuesta de microservicios
*(Sección 8 de la consigna)*

Se proponen **tres servicios de negocio**, cada uno con una responsabilidad distinta, sus propios datos y una interfaz pública. No se crea un servicio por entidad: **Eventos** concentra las reglas de capacidad, y **Entradas** concentra el ciclo de vida de la compra y del ticket de cada persona.

### 5.1 Fichas de definición

#### Servicio 1: `usuarios-service`

| Elemento | Definición |
|----------|------------|
| **Nombre** | `usuarios-service` |
| **Responsabilidad principal** | Mantener la identidad y los datos personales de las personas registradas. |
| **Operaciones** | Alta, consulta individual, listado, modificación y baja de usuarios; informar si un usuario existe y está activo. |
| **Reglas de negocio** | Campos obligatorios y con formato válido; `email` único (409), y `dni` único cuando se incorpore ese campo; fecha de nacimiento con formato y calendario válidos; la baja es **lógica** (`activo = false`) para no dejar entradas de otros servicios apuntando a un usuario inexistente. |
| **Datos propios** | `usuarios`. Campos existentes: `id`, `nombre`, `apellido`, `email`. Campos **nuevos** que se incorporan en la migración: `dni`, `fechaNacimiento` (reemplaza a `edad`, que pasa a calcularse), `direccion` y `activo`. |
| **Endpoints** | **Migran del servicio actual** (con el prefijo renombrado de `/users` a `/usuarios`): `GET /usuarios`, `GET /usuarios/:id`, `POST /usuarios`, `PUT /usuarios/:id`, `DELETE /usuarios/:id` (pasa a baja lógica). **Nuevos:** `GET /health`. |
| **Dependencias** | Ninguna. No invoca a otros servicios. |
| **Fuera de alcance** | Qué entradas compró cada usuario; eventos; autenticación y contraseñas (no existen hoy en la aplicación). |
| **Justificación** | Es el grupo A del análisis: la parte más autónoma. Sus reglas (unicidad, validación de datos personales) cambian por motivos propios y no dependen de ningún otro dato. Al convertirse en la única autoridad sobre la identidad, los demás servicios dejan de leer su colección. |

#### Servicio 2: `eventos-service`

| Elemento | Definición |
|----------|------------|
| **Nombre** | `eventos-service` |
| **Responsabilidad principal** | Gestionar los eventos y garantizar que nunca se entreguen más lugares que su aforo. |
| **Operaciones** | Crear, consultar, modificar y cancelar eventos; reservar aforo; liberar aforo; informar disponibilidad y vigencia. |
| **Reglas de negocio** | Estados `PUBLICADO`, `AGOTADO`, `CANCELADO`, `FINALIZADO`. No se reserva aforo si el evento no está `PUBLICADO` o ya pasó. `0 ≤ disponibles ≤ aforoTotal`. Al llegar a 0 pasa a `AGOTADO`; al liberar vuelve a `PUBLICADO`. El aforo total no puede bajar de lo ya vendido. Exclusión mutua **por evento** con lock en Redis y TTL. Reservar y liberar son **idempotentes** por `referencia`. |
| **Datos propios** | `eventos`: `id`, `nombre`, `fecha`, `lugar`, `precio`, `aforoTotal`, `disponibles`, `estado`. `movimientosAforo`: `referencia`, `tipo` (reserva/liberación), `cantidad` (para la idempotencia). Claves de lock `lock:evento:{id}` en Redis. |
| **Endpoints** | **Migran del servicio actual:** `GET /reservas` → `GET /eventos` y `GET /eventos/:id`; `POST /reservas/:id/reservar` → `POST /eventos/:id/reservar-aforo` (lógica de lock y descuento). **Nuevos:** `POST /eventos`, `PUT /eventos/:id`, `PATCH /eventos/:id/cancelar`, `POST /eventos/:id/liberar-aforo` (interno), `GET /health`. |
| **Dependencias** | Ninguna. No invoca a otros servicios (usa Redis como infraestructura propia). |
| **Fuera de alcance** | Quién compró; tickets; órdenes; precio histórico de una compra; reembolsos; datos del usuario. |
| **Justificación** | Es el dueño de la regla de capacidad (grupo B). Concentrar ahí el contador y su lock deja **una sola autoridad** sobre la disponibilidad, con la sección crítica del TP2 en un único lugar. Tiene reglas propias (estados, fechas, cancelación del evento) por lo que no es un simple contador. |

#### Servicio 3: `entradas-service`

| Elemento | Definición |
|----------|------------|
| **Nombre** | `entradas-service` |
| **Responsabilidad principal** | Gestionar la compra de entradas de cada usuario y el ciclo de vida de cada ticket. |
| **Operaciones** | Crear orden de compra, consultar orden, cancelar orden, listar entradas de un usuario, validar un ticket en el ingreso. |
| **Reglas de negocio** | Máximo de N entradas por usuario por evento (configurable, por defecto 4). Solo compran usuarios activos. Estados de orden `PENDIENTE`, `CONFIRMADA`, `CANCELADA`, `RECHAZADA`; estados de ticket `VALIDO`, `USADO`. Ticket de **uso único** mediante actualización condicional `VALIDO → USADO`. Cancelación permitida hasta cierto plazo antes del evento (por defecto 24 h). El `ordenId` es la clave de idempotencia. El `precioUnitario` se **congela** al comprar. |
| **Datos propios** | `ordenes`: `id`, `usuarioId`, `eventoId`, `cantidad`, `precioUnitario`, `estado`, `fechaCreacion`. `tickets`: `codigo` (único), `ordenId`, `estado`. |
| **Endpoints** | **Nuevos:** `POST /ordenes`, `GET /ordenes/:id`, `DELETE /ordenes/:id` (cancelar), `GET /entradas?usuarioId=`, `POST /entradas/validar`, `GET /health`. **Cambio de contrato:** la operación de "reservar" que hoy el cliente pide a `POST /reservas/:id/reservar` pasa a ser `POST /ordenes`; el cliente ya no habla con el contador de aforo. |
| **Dependencias** | `usuarios-service` (`GET /usuarios/:id`); `eventos-service` (`GET /eventos/:id`, `POST /eventos/:id/reservar-aforo`, `POST /eventos/:id/liberar-aforo`). |
| **Fuera de alcance** | Contar el aforo y decidir si el evento admite venta (de Eventos); datos personales (de Usuarios); cobro real y reembolsos. |
| **Justificación** | Resuelve la carencia del grupo B: separa **la capacidad** (que es del evento) de **la operación de cada persona**. Sus reglas (máximo por usuario, uso único, plazo de cancelación) cambian por motivos de política de venta, sin tocar la capacidad. Guardar `usuarioId` y `precioUnitario` propios evita copiar el perfil del usuario y protege el histórico si el precio del evento cambia. |

### 5.2 Tabla general de responsabilidades

*(Sección 8.2 de la consigna)*

| Microservicio | Responsabilidad | Datos administrados | Funciones principales | Dependencias |
|---------------|-----------------|---------------------|-----------------------|--------------|
| `usuarios-service` | Identidad y datos personales | `usuarios` | CRUD de usuarios, baja lógica, informar existencia y estado | Ninguna |
| `eventos-service` | Eventos y control de aforo | `eventos`, `movimientosAforo`, locks en Redis | Gestión de eventos, reservar y liberar aforo, cancelar evento | Ninguna |
| `entradas-service` | Compra y tickets | `ordenes`, `tickets` | Comprar, cancelar, listar, validar ticket | `usuarios-service`, `eventos-service` |

---

## 6. Propiedad y acceso a los datos
*(Sección 9 de la consigna)*

| Dato / recurso | Servicio propietario | Quién puede consultarlo | Quién puede modificarlo | Forma de acceso |
|----------------|----------------------|-------------------------|-------------------------|-----------------|
| Perfil de usuario | `usuarios-service` | Cliente; `entradas-service` (solo existencia y estado) | Solo `usuarios-service` | API REST `GET /usuarios/:id` |
| Estado activo/inactivo del usuario | `usuarios-service` | `entradas-service` | Solo `usuarios-service` (baja lógica) | API REST `GET /usuarios/:id` |
| Datos del evento (nombre, fecha, lugar, precio) | `eventos-service` | Cliente; `entradas-service` | Solo `eventos-service` | API REST `GET /eventos/:id` |
| Estado y vigencia del evento | `eventos-service` | Cliente; `entradas-service` | Solo `eventos-service` | API REST `GET /eventos/:id` (campo `vigente`) |
| Aforo disponible | `eventos-service` | Cliente; `entradas-service` | Solo `eventos-service`, ante pedido de `entradas-service` | Lectura por `GET /eventos/:id`; escritura mediante `POST /eventos/:id/reservar-aforo` y `liberar-aforo` |
| Movimientos de aforo (idempotencia) | `eventos-service` | Solo `eventos-service` | Solo `eventos-service` | Interno |
| Lock de aforo (Redis) | `eventos-service` | Solo `eventos-service` | Solo `eventos-service` | Interno (claves `lock:evento:{id}`) |
| Orden de compra | `entradas-service` | Cliente | Solo `entradas-service` | API REST `GET /ordenes/:id` |
| Ticket | `entradas-service` | Cliente; control de ingreso | Solo `entradas-service` | `POST /entradas/validar`, `GET /entradas?usuarioId=` |
| Precio histórico de una orden | `entradas-service` | Cliente | Solo `entradas-service` (se fija al crear) | `GET /ordenes/:id` |

> **Regla de diseño aplicada:** ningún servicio modifica datos de otro ni accede a su base. Cada servicio usa su **propia base** (`usuarios_db`, `eventos_db`, `entradas_db`). Redis lo usa únicamente `eventos-service` y sus claves no se comparten.

---

## 7. Comunicación entre microservicios
*(Sección 10 de la consigna)*

Las comunicaciones son HTTP/REST. Solo `entradas-service` invoca a otros servicios; **Usuarios y Eventos no se invocan entre sí ni invocan a Entradas**.

### 7.1 Matriz de comunicaciones

| # | Origen | Destino | Necesidad | Método / endpoint | Datos intercambiados | Respuesta esperada |
|---|--------|---------|-----------|-------------------|----------------------|--------------------|
| 1 | `entradas-service` | `usuarios-service` | Verificar que el comprador existe y está activo | `GET /usuarios/:id` | Envía `usuarioId` en la ruta | `200` con el usuario (se usan `id` y `activo`); `404` si no existe |
| 2 | `entradas-service` | `eventos-service` | Obtener precio, fecha y vigencia del evento | `GET /eventos/:id` | Envía `eventoId` | `200` con `nombre`, `fecha`, `precio`, `vigente`, `disponibles`; `404` si no existe |
| 3 | `entradas-service` | `eventos-service` | Reservar lugares del aforo | `POST /eventos/:id/reservar-aforo` | Envía `{ cantidad, referencia: ordenId }` | `200` con `{ reservado: true, disponibles }`; `409` sin aforo o evento no vendible; `423` lock ocupado (reintentar) |
| 4 | `entradas-service` | `eventos-service` | Devolver lugares al cancelar o compensar | `POST /eventos/:id/liberar-aforo` | Envía `{ cantidad, referencia: ordenId }` | `200` con `{ liberado: true, disponibles }`; repetir con la misma referencia no vuelve a sumar |

La validación de un ticket en el ingreso reutiliza la comunicación **#2** (consulta de `vigente`).

> Los endpoints `reservar-aforo` y `liberar-aforo` son **internos**: están documentados en el contrato de `eventos-service`, pero no están pensados para que los use el cliente final.

### 7.2 Análisis de cada comunicación

| Comunicación | ¿Es necesario que conozca al otro? | ¿Duplica una regla con un único propietario? | ¿La información podría pertenecer a quien la pide? | ¿El contrato oculta detalles internos? | Si el destino no está disponible |
|--------------|-----------------------------------|----------------------------------------------|----------------------------------------------------|---------------------------------------|----------------------------------|
| #1 Entradas → Usuarios | Sí: no debe vender a quien no existe o está inactivo. | No: la regla de "usuario activo" sigue siendo de Usuarios; Entradas solo la consulta. | No: copiar el perfil duplicaría datos que pueden cambiar. | Sí: se usa la API pública, no su colección. | Entradas responde `503` y la orden queda `RECHAZADA`. No se descuenta aforo. |
| #2 Entradas → Eventos (consulta) | Sí: necesita precio y fecha para crear la orden y calcular el plazo de cancelación. | No: la decisión de si el evento admite ventas o ingreso la toma Eventos (campo `vigente`). | El precio se **copia al momento de comprar** a propósito, como dato histórico propio de la orden. | Sí. | Al comprar: `503`, orden `RECHAZADA`. Al validar un ticket: se rechaza el ingreso con `503` (decisión conservadora). |
| #3 Entradas → Eventos (reservar) | Sí: solo Eventos puede modificar el aforo. | No: la regla de capacidad vive únicamente en Eventos. | No: el aforo es del evento. | Sí: se pide una acción (`cantidad`), no se accede a la base ni al lock. | Entradas responde `503`; la orden queda `PENDIENTE` o `RECHAZADA`. Como el pedido es idempotente, un reintento no duplica el descuento. |
| #4 Entradas → Eventos (liberar) | Sí: para cancelar o compensar. | No. | No. | Sí. | La cancelación queda pendiente de reintento. Es idempotente por `referencia`. |

### 7.3 Comunicaciones que se decidió **no** crear

- **Eventos → Entradas** (para avisar la cancelación de un evento): crearía dependencia circular. En su lugar, Entradas consulta `vigente` al validar el ticket.
- **Usuarios → Entradas** (para avisar una baja): Entradas consulta a Usuarios al comprar; las entradas ya vendidas a un usuario dado de baja lógica siguen siendo válidas.
- **Usuarios ↔ Eventos:** no existe necesidad de negocio.

---

## 8. Trazado de casos de uso
*(Sección 10.1 de la consigna)*

### 8.1 Caso de uso 1: Comprar entradas

```
Cliente
  │  POST /ordenes { usuarioId, eventoId, cantidad }
  ▼
entradas-service ── crea orden PENDIENTE (ordenId = clave de idempotencia)
  │
  ├── HTTP GET /usuarios/:id ───────────► usuarios-service      (existe y está activo)
  ├── HTTP GET /eventos/:id ────────────► eventos-service       (precio, fecha, vigente)
  │
  ├── verifica su regla propia: máximo N entradas por usuario y evento
  │
  ├── HTTP POST /eventos/:id/reservar-aforo { cantidad, referencia = ordenId }
  │        ▼
  │   eventos-service ── toma lock Redis lock:evento:{id}
  │                   ── verifica evento PUBLICADO y disponibles ≥ cantidad
  │                   ── descuenta, registra movimiento, libera lock
  │        ▲  200 { reservado, disponibles }   |   409 sin aforo   |   423 lock ocupado
  │
  ├── genera tickets y pasa la orden a CONFIRMADA   (o RECHAZADA si hubo 409)
  ▼
Respuesta al cliente: 201 con la orden y sus tickets   |   409 sin lugares   |   503 servicio no disponible
```

| Aspecto | Detalle |
|---------|---------|
| **Quién inicia** | El cliente, hacia `entradas-service`. |
| **Quién decide qué** | Usuarios decide si el usuario existe y está activo. Eventos decide si el evento admite venta y si hay aforo. Entradas decide el máximo por persona. |
| **Qué datos se consultan** | Usuario (existencia y estado), evento (precio, fecha, vigencia). |
| **Quién modifica el estado** | Eventos modifica `disponibles`. Entradas modifica `ordenes` y `tickets`. Usuarios no modifica nada. |
| **Si algo falla en el medio** | Si Eventos descontó pero Entradas se cayó, la orden queda `PENDIENTE`: un proceso de reintento vuelve a pedir `reservar-aforo` (idempotente) o `liberar-aforo` para compensar. Nunca se descuenta dos veces la misma `referencia`. |

### 8.2 Caso de uso 2: Validar una entrada en el ingreso

```
Control de ingreso (cliente)
  │  POST /entradas/validar { codigo }
  ▼
entradas-service ── busca el ticket por código
  │
  ├── HTTP GET /eventos/:id ──► eventos-service     (¿vigente?)
  │
  ├── actualización condicional atómica: estado VALIDO → USADO
  │        (si dos personas escanean el mismo código a la vez, solo una pasa)
  ▼
Respuesta: 200 ingreso permitido   |   409 ticket ya usado   |   404 código inexistente   |   422 evento no vigente
```

| Aspecto | Detalle |
|---------|---------|
| **Quién inicia** | El control de ingreso, hacia `entradas-service`. |
| **Quién decide qué** | Eventos decide si el evento está vigente (campo `vigente`). Entradas decide si el ticket es válido y de uso único. |
| **Qué datos se consultan** | Ticket (propio de Entradas) y vigencia del evento. |
| **Quién modifica el estado** | Solo Entradas (pasa el ticket a `USADO`). |
| **Si Eventos no responde** | Se rechaza el ingreso con `503`. Se eligió esa conducta conservadora para no admitir entradas de un evento posiblemente cancelado. |

### 8.3 Caso de uso adicional: Cancelar una orden

```
Cliente ── DELETE /ordenes/:id ──► entradas-service
   ├── verifica estado CONFIRMADA y plazo (fecha del evento − PLAZO_CANCELACION_HORAS)
   ├── HTTP POST /eventos/:id/liberar-aforo { cantidad, referencia = ordenId } ──► eventos-service
   └── orden → CANCELADA, tickets → anulados
```

---

## 9. Diagrama de arquitectura
*(Sección 11 de la consigna)*

![Diagrama de arquitectura](diagrama-arquitectura.svg)

Versión editable (se renderiza automáticamente en GitHub):

```mermaid
flowchart TB
    C([Cliente / Control de ingreso])

    subgraph US["usuarios-service :3001 · Identidad de personas"]
        U[API de usuarios]
    end
    subgraph ES["eventos-service :3002 · Eventos y control de aforo"]
        E[API de eventos]
    end
    subgraph NS["entradas-service :3003 · Compras y tickets"]
        N[API de ordenes y entradas]
    end

    UD[(usuarios_db)]
    ED[(eventos_db)]
    ND[(entradas_db)]
    R[(Redis<br/>lock por evento)]

    C -- "HTTPS /usuarios" --> U
    C -- "HTTPS /eventos" --> E
    C -- "HTTPS /ordenes, /entradas" --> N

    N -- "GET /usuarios/:id" --> U
    N -- "GET /eventos/:id" --> E
    N -- "POST reservar-aforo / liberar-aforo" --> E

    U --- UD
    E --- ED
    E --- R
    N --- ND
```

**Qué muestra el diagrama:**

- Los **tres microservicios** con su responsabilidad general.
- Los **puntos de entrada del cliente**: el cliente se conecta a cada servicio por sus rutas públicas. Se decidió no introducir un API Gateway en esta etapa para no sumar un componente que no resuelve una responsabilidad de negocio; queda como evolución posible.
- Las **comunicaciones y su sentido**: todas parten de `entradas-service`; ninguna es circular.
- La **persistencia** de cada servicio: una base independiente por servicio y Redis usado solo por Eventos.

---

## 10. Validación de los límites propuestos (checklist)
*(Sección 12 de la consigna)*

| Criterio | `usuarios-service` | `eventos-service` | `entradas-service` |
|----------|--------------------|-------------------|--------------------|
| Su responsabilidad principal se explica en una frase clara | ✅ Mantener la identidad de las personas | ✅ Controlar eventos y que nunca se supere el aforo | ✅ Gestionar la compra y el ticket de cada persona |
| Agrupa reglas de negocio relacionadas entre sí | ✅ Validez y unicidad de los datos personales | ✅ Estados, fechas y capacidad | ✅ Máximo por persona, uso único, plazo de cancelación |
| Posee datos o decisiones de las que es responsable | ✅ `usuarios` | ✅ `eventos`, aforo, locks | ✅ `ordenes`, `tickets` |
| No fue creado solo porque existe una tabla, entidad o controlador | ✅ Es una responsabilidad de identidad, con reglas propias | ✅ Contiene reglas y lock, no solo un CRUD de eventos | ✅ Agrupa dos entidades (orden y ticket) por su ciclo de vida común |
| Su interfaz pública se define sin exponer detalles internos | ✅ | ✅ El lock y los movimientos no se exponen | ✅ |
| Puede modificarse internamente sin cambios simultáneos en los demás | ✅ | ✅ Mientras se mantengan los contratos `reservar-aforo`/`liberar-aforo` | ✅ |
| No duplica reglas cuya autoridad es de otro servicio | ✅ | ✅ | ✅ Consulta `vigente` y `activo`, no los recalcula |
| Sus dependencias son necesarias y están justificadas | ✅ No tiene | ✅ No tiene | ✅ Usuarios (comprador válido) y Eventos (aforo y datos), justificado en 7.2 |
| Se pueden explicar las responsabilidades que quedan fuera | ✅ | ✅ | ✅ |

### Señales de alerta revisadas

- **¿Comparten continuamente datos internos?** No: cada servicio tiene su base y solo se hablan por API.
- **¿Modifican las mismas entidades?** No: cada dato tiene un único propietario (sección 6).
- **¿Coordinan casi todas sus operaciones?** `entradas-service` necesita a los otros dos para **comprar**, pero no para validar un ticket (solo consulta `vigente`) ni para listar sus órdenes. Usuarios y Eventos son totalmente independientes entre sí. El riesgo de que Entradas dependa demasiado de Eventos se mitiga porque las reglas de capacidad (Eventos) y de política de venta (Entradas) cambian por motivos distintos.

### Decisiones descartadas

| Alternativa | Motivo del descarte |
|-------------|---------------------|
| Un servicio por entidad (usuario, evento, orden, ticket) | Generaría comunicaciones constantes sin ganar cohesión; orden y ticket comparten ciclo de vida. |
| `raft-service`, `logging-service`, `swagger-service` | Son mecanismos técnicos transversales, no responsabilidades de negocio. |
| Servicio de Pagos o de Notificaciones | No son necesarios para el alcance actual; se pueden agregar en TPs posteriores si el enunciado lo requiere. |
| API Gateway | No resuelve una responsabilidad de negocio en esta etapa. |
| Eventos notificando a Entradas la cancelación | Introduciría dependencia circular. |

### Supuestos y limitaciones conocidas

- Se agregan a Usuarios los campos `activo`, `dni`, `fechaNacimiento` y `direccion` (hoy no existen en la app base, que tiene `nombre`, `apellido`, `email` y `edad`), y la baja pasa a ser lógica.
- Los valores `MAX_ENTRADAS_POR_USUARIO=4` y `PLAZO_CANCELACION_HORAS=24` son propuestas configurables.
- No se modela el cobro real ni los reembolsos de eventos cancelados.
- Las compras simultáneas de un mismo usuario para un mismo evento podrían superar el máximo si no se serializan por (usuario, evento). En la implementación del TP6 se mitiga creando la orden `PENDIENTE` antes de contar y contando también las pendientes de otros pedidos, de modo que cada pedido ve a los demás y, ante la duda, se rechaza de más y no de menos. No es una serialización estricta.
- La conservación de Raft sobre algún servicio (candidato: Eventos) se decidía en la implementación. **Decisión del TP6: no se migra** (ver [§11.2](#112-cambios-respecto-del-tp5)).
- La espera de 2 s dentro del lock de reservas es una demostración del TP2: no se migra a Eventos.

---

## 11. TP6: arquitectura implementada y cambios respecto del TP5
*(Sección 21, punto 3 de la consigna del TP6)*

Los tres servicios aprobados en el TP5 se implementaron con sus límites originales. Esta sección resume lo que quedó en funcionamiento, lo que cambió respecto del diseño y el análisis del fallo parcial.

### 11.1 Arquitectura implementada

| Servicio | Puerto interno | Publicado en la PC | Nombre DNS interno | Base propia | Depende de |
|---|---|---|---|---|---|
| `usuarios-service` | 3000 | 3001 | `usuarios-service` | `usuarios-db` (MongoDB) | Nada |
| `eventos-service` | 3000 | 3002 | `eventos-service` | `eventos-db` (MongoDB) y `redis` | Nada |
| `entradas-service` | 3000 | 3003 | `entradas-service` | `entradas-db` (MongoDB) | `usuarios-service`, `eventos-service` |

La solución completa se levanta con `docker compose up --build -d` (7 contenedores). Las bases y Redis no se publican hacia la PC. Cada servicio está en una red privada con su base, y `tp6-net` conecta a los tres servicios entre sí.

### 11.2 Cambios respecto del TP5

| Cambio | Motivo |
|---|---|
| **Raft no se migra.** En el TP5 era "candidato" para Eventos | Es un mecanismo técnico y no una responsabilidad de negocio. El TP6 pide conservar la exclusión mutua (el lock de Redis), no el consenso. Cada servicio corre una sola instancia |
| **HTTP en lugar de HTTPS.** El TP5 asumía HTTPS en cada servicio y el diagrama rotula HTTPS en el acceso del cliente | El TP6 permite HTTP entre contenedores. En el laboratorio los servicios escuchan HTTP también hacia el cliente, sin certificados. Si se quisiera HTTPS externo, iría en un proxy delante de los servicios |
| **Usuarios:** campos nuevos `dni`, `fechaNacimiento`, `direccion` y `activo`; la edad se calcula; baja lógica; prefijo `/usuarios` en lugar de `/users` | El sistema de entradas necesita identificar personas y saber si están habilitadas. La baja lógica evita órdenes que apunten a usuarios inexistentes |
| **Eventos:** `GET /eventos/:id` devuelve además `estado` y `vendible` | Que Entradas no replique la regla "PUBLICADO y futuro". Es un agregado compatible con el contrato del TP5 |
| **Eventos:** nuevo `PATCH /eventos/:id/finalizar` | Sin él, el estado `FINALIZADO` no se podría alcanzar |
| **Eventos:** nuevo `GET /ready` | Distinguir "proceso activo" (`/health`) de "dependencias disponibles" (Mongo y Redis) |
| **Eventos:** `reservar-aforo` y `liberar-aforo` registran cada movimiento y son idempotentes por `referencia` (el `ordenId`) | Permite reintentar sin descontar ni devolver dos veces |
| **Eventos:** el lock se libera con un script Lua que compara el token | El `GET` + `DEL` del TP4 podía borrar el lock de otro pedido si el propio había expirado |
| **Entradas:** el ticket tiene un estado más, `ANULADO` | Las órdenes canceladas dejan tickets que no deben poder usarse. El TP5 solo definía `VÁLIDO` y `USADO` |
| **Entradas:** una orden queda `PENDIENTE` cuando no se sabe si Eventos descontó el aforo | Deja evidencia para recuperar o compensar sin perder ni duplicar lugares |
| **Entradas:** reintenta solo cuando Eventos responde `423` (lock ocupado) | En ese caso no se aplicó nada, así que reintentar es seguro |
| **Entradas no espera a Usuarios ni a Eventos en `depends_on`** | Debe poder arrancar y responder `503` si alguno falta (prueba de indisponibilidad 15.1) |
| **Infraestructura:** una base por servicio, redes segmentadas, healthchecks y volúmenes nombrados | Hace cumplir la propiedad de los datos también a nivel de red |
| La espera de 2 s dentro del lock del TP2 no se migra | Era solo una demostración de la exclusión mutua |

El diagrama de la [§9](#9-diagrama-de-arquitectura) sigue siendo válido en cuanto a servicios, responsabilidades, sentido de las llamadas y persistencia. Lo único que difiere de la implementación es el rótulo "HTTPS" del acceso del cliente (ver el segundo cambio de la tabla).

### 11.3 Análisis del fallo parcial: compra de entradas

**1. Servicios que participan y orden de las operaciones**

| Etapa | Servicio | Operación | Cambio de estado |
|---|---|---|---|
| 1 | `entradas-service` | Crea la orden | Orden `PENDIENTE` |
| 2 | `usuarios-service` y `eventos-service` | Consultas de usuario y evento | Ninguno (solo lecturas) |
| 3 | `eventos-service` | `reservar-aforo` | Descuenta `disponibles` y registra el movimiento |
| 4 | `entradas-service` | Emite los tickets y confirma | Tickets `VALIDO` y orden `CONFIRMADA` |

**2. Qué pasa si falla cada etapa posterior a una operación ya confirmada**

| Falla | Resultado | Estado en que queda el sistema |
|---|---|---|
| Etapa 2: Usuarios o Eventos no responden | `503 DEPENDENCIA_NO_DISPONIBLE` | Orden `RECHAZADA`; no se tocó el aforo |
| Etapa 3 con respuesta clara (`409` sin lugar, `404`, o `423` tras los reintentos) | Se propaga el error | Orden `RECHAZADA` con su motivo; el aforo no cambió |
| Etapa 3 incierta (timeout, `5xx` o Redis caído): no se sabe si Eventos llegó a descontar | `503 ORDEN_PENDIENTE` | Orden `PENDIENTE` sin tickets. El aforo puede o no haberse descontado |
| Etapa 4: falla la emisión de tickets, y se puede compensar | `500 ERROR_INTERNO` | Se borran los tickets parciales, se llama a `liberar-aforo` con la misma referencia y la orden queda `RECHAZADA` (`ERROR_EMISION_TICKETS`) |
| Etapa 4: falla la emisión y también la compensación | `500 ORDEN_PENDIENTE` | Orden `PENDIENTE` con el aforo **descontado** y sin tickets |
| Caída del propio `entradas-service` entre etapas | Sin respuesta al cliente | Orden `PENDIENTE` (la etapa 1 ya se había guardado) |

**3. ¿Puede quedar el sistema parcialmente actualizado?** Sí. El caso más claro es una orden `PENDIENTE` sin tickets y con el aforo posiblemente descontado: no hay datos corruptos, pero sí lugares "perdidos" y una orden colgada. El diseño falla del lado seguro: se puede vender de menos, nunca de más. Mientras exista, esa orden cuenta para el máximo de entradas del usuario.

**4. Qué haría falta para detectar, recuperar o compensar en una evolución futura**

- Un proceso que recorra las órdenes `PENDIENTE` vencidas (la orden ya guarda `fechaCreacion`) y reintente `reservar-aforo` con el mismo `ordenId`, que es idempotente, para confirmarlas, o `liberar-aforo` para anularlas.
- Un endpoint en Eventos para consultar si existe un movimiento de aforo para una referencia, así no hace falta reintentar a ciegas.
- Contador de intentos y tiempo máximo de vida de una orden pendiente.

**Evidencia reproducible:** `node scripts/tp6/pruebas.js fallo-parcial` detiene Redis, hace una compra, muestra la orden `PENDIENTE` y comprueba que una compra nueva funciona al recuperarse la dependencia (salida en `docs/evidencias/tp6/fallo-parcial.txt`).
