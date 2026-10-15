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

---

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

---

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

---

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


