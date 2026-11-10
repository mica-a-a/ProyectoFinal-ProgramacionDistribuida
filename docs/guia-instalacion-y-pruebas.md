# Guía de instalación y pruebas

Cómo instalar y levantar el sistema de venta de entradas (3 microservicios + 3 bases MongoDB + Redis), y cómo comprobar que funciona: tests unitarios, pruebas manuales paso a paso y pruebas automáticas con evidencias. Todo con los resultados que tenés que ver en cada paso.

**Camino recomendado: Docker Compose (sección 2).** Es el mismo entorno que se entrega y el único donde se pueden correr todas las pruebas. La sección 3 explica cómo correr los servicios sin Docker.

## Índice

1. [Requisitos](#1-requisitos)
2. [Instalación con Docker Compose (recomendada)](#2-instalación-con-docker-compose-recomendada)
3. [Instalación sin Docker (alternativa)](#3-instalación-sin-docker-alternativa)
4. [Pruebas](#4-pruebas)
5. [Solución de problemas](#5-solución-de-problemas)
6. [Detener y limpiar](#6-detener-y-limpiar)

---

## 1. Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| **Git** | cualquiera reciente | Clonar el repositorio |
| **Docker** | Docker Desktop (Windows: con WSL 2) o Docker Engine + plugin Compose (Linux) | Levantar la solución |
| **Node.js** | **20.19 o superior** | Tests unitarios, scripts de pruebas y ejecución sin Docker (Entradas lo exige) |
| Puertos libres | 3001, 3002 y 3003 | Servicios publicados hacia tu PC (se pueden cambiar) |

Verificación (los cuatro comandos deben funcionar; `hello-world` debe imprimir "Hello from Docker!"):

```bash
git --version
node --version            # debe ser v20.19.0 o superior
docker --version
docker compose version
docker run --rm hello-world
```

Si `docker run` falla, Docker Desktop no está iniciado o WSL 2 no está habilitado: resolvelo antes de seguir.

---

## 2. Instalación con Docker Compose (recomendada)

### Paso 1 · Clonar el repositorio

```bash
git clone <URL del repositorio>
cd ProyectoFinal-ProgramacionDistribuida
```

### Paso 2 · Crear el `.env` con el secreto del JWT

El `.env` va en la **raíz del repositorio** (junto a `docker-compose.yml`), no dentro de un servicio.

```bash
cp .env.example .env        # Windows (cmd): copy .env.example .env
```

Tenés que completar dos secretos distintos (ambos mínimo 32 caracteres): `JWT_SECRET` para los tokens de usuario y `EVENTOS_SERVICE_TOKEN_SECRET` para la identidad técnica exclusiva de Entradas ante Eventos. Vienen vacíos a propósito y `docker compose up` no arranca si falta alguno.

**Linux / macOS / Git Bash**

```bash
SECRETO=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=$SECRETO/" .env && rm .env.bak
grep -Eq '^JWT_SECRET=.{32,}' .env && echo "JWT_SECRET configurado"
```

**Windows PowerShell**

```powershell
$secreto = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
(Get-Content .env) -replace '^JWT_SECRET=.*', "JWT_SECRET=$secreto" | Set-Content .env
(Select-String '^JWT_SECRET=.{32,}' .env) -ne $null      # debe imprimir True
$secretoServicio = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
(Get-Content .env) -replace '^EVENTOS_SERVICE_TOKEN_SECRET=.*', "EVENTOS_SERVICE_TOKEN_SECRET=$secretoServicio" | Set-Content .env
```

> **No compartas ni subas el `.env` ni lo muestres en capturas.** Está en `.gitignore`. Los secretos deben tener valores diferentes. Las demás variables tienen valores por defecto o ficticios que sirven tal cual (puertos 3001–3003, contraseñas del seed `Cambiar-Esta-Clave-1` y `Cambiar-Esta-Clave-Admin-1`).

### Paso 3 · Construir e iniciar

```bash
docker compose up --build -d
```

La primera vez descarga `mongo:7`, `redis:7-alpine` y la imagen base de Node, y construye las 3 imágenes: puede tardar varios minutos.

### Paso 4 · Comprobar que todo está sano

```bash
docker compose ps
```

Tienen que aparecer **7 contenedores** `Up ... (healthy)`: `usuarios-db`, `usuarios-service`, `eventos-db`, `redis`, `eventos-service`, `entradas-db` y `entradas-service`. Si alguno dice `starting`, esperá medio minuto y repetí el comando. Si dice `unhealthy` o `Exit`, mirá la [sección 5](#5-solución-de-problemas).

Solo los tres servicios publican puertos hacia tu PC; las bases y Redis no.

### Paso 5 · Cargar los datos de prueba (seed)

```bash
docker compose exec -T usuarios-service npm run seed
docker compose exec -T eventos-service npm run seed
```

Salida esperada:

```text
Seed OK: 5 usuarios USER (1 inactivo: Diego Paz) + 1 ADMIN (admin@example.com)
Seed aplicado: 5 eventos en eventos
```

**Atención:** el seed **borra y recrea** los usuarios y los eventos. Las contraseñas que deja son las de `SEED_USER_PASSWORD` (los 5 usuarios) y `SEED_ADMIN_PASSWORD` (el administrador), tal como estaban en tu `.env` cuando lo ejecutaste.

| Dato de prueba | Detalle |
|---|---|
| Administrador | `admin@example.com`, rol `ADMIN` |
| Usuarios `USER` | `lucia.fernandez@example.com`, `martin.gomez@example.com`, `sofia.rossi@example.com`, `valentina.sosa@example.com` y `diego.paz@example.com` (este último está **inactivo**) |
| Eventos | Taller de Node.js (5 lugares), Recital de Aniversario (100), Charla de Microservicios (agotado), Meetup cancelado, Jornada ya realizada |

### Paso 6 · Verificar que responden

| Servicio | Health | Swagger UI |
|---|---|---|
| usuarios | http://localhost:3001/health | http://localhost:3001/api-docs |
| eventos | http://localhost:3002/health y `/ready` (muestra Mongo y Redis) | http://localhost:3002/api-docs |
| entradas | http://localhost:3003/health | http://localhost:3003/api-docs |

Cada `/health` responde `{"service":"<nombre>","status":"ok"}`. Abrí los tres Swagger en el navegador: tienen que cargar y mostrar el botón **Authorize**. Los POST internos de reservar/liberar aforo en Eventos no se prueban con el token de usuario: deben responder 401; el flujo autorizado se comprueba comprando y cancelando desde Entradas.

### Paso 7 · Primer uso: registrarse, iniciar sesión y usar el token

Casi todos los endpoints exigen un token. El flujo es: **registrar → login → usar el token**.

**Linux / macOS / Git Bash**

```bash
# 1) Registro (público): siempre crea un USER
curl -s -X POST http://localhost:3001/auth/register -H 'content-type: application/json' \
  -d '{"nombre":"Ana","apellido":"Lopez","email":"ana@example.com","dni":"31222333","fechaNacimiento":"1992-07-21","password":"Clave-Segura-1"}'

# 2) Login: devuelve {"token":"...","tokenType":"Bearer","expiresIn":3600}
curl -s -X POST http://localhost:3001/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"Clave-Segura-1"}'

# 3) Usar el token (reemplazá <id> por el "id" de la respuesta del registro)
curl -s http://localhost:3001/usuarios/<id> -H 'Authorization: Bearer <token>'
```

**Windows PowerShell**

```powershell
$ana = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/register -ContentType 'application/json' `
  -Body (@{ nombre='Ana'; apellido='Lopez'; email='ana@example.com'; dni='31222333'; fechaNacimiento='1992-07-21'; password='Clave-Segura-1' } | ConvertTo-Json)
$token = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login -ContentType 'application/json' `
  -Body (@{ email='ana@example.com'; password='Clave-Segura-1' } | ConvertTo-Json)).token
Invoke-RestMethod -Uri "http://localhost:3001/usuarios/$($ana.id)" -Headers @{ Authorization = "Bearer $token" }
```

> En PowerShell, `curl` es un alias de otro comando: usá `Invoke-RestMethod` (como arriba) o `curl.exe`.

El token vence a la hora (`JWT_EXPIRES_IN`). Si empezás a recibir `401 TOKEN_VENCIDO`, volvé a iniciar sesión.

---

## 3. Instalación sin Docker (alternativa)

Sirve para desarrollar y depurar un servicio. **No** permite correr los escenarios K y L ni las pruebas que detienen contenedores.

### 3.1 Necesitás MongoDB y Redis en tu máquina

Lo más simple, si tenés Docker, es levantar solo la infraestructura:

```bash
docker run -d --name mongo-tp -p 27017:27017 mongo:7
docker run -d --name redis-tp -p 6379:6379 redis:7-alpine
```

O instalarlos nativos (en Windows: MongoDB Community Server y Memurai como reemplazo de Redis). Una sola instancia de MongoDB alcanza: cada servicio usa su propia base (`usuarios`, `eventos`, `entradas`).

### 3.2 Configurar y arrancar cada servicio

Repetí para los tres, **cada uno en su propia terminal**:

```bash
cd services/usuarios-service        # luego: services/eventos-service y services/entradas-service
cp .env.example .env                # Windows (cmd): copy .env.example .env
# Editar el .env y completar JWT_SECRET
npm install
npm start
```

Reglas importantes:

- **`JWT_SECRET` tiene que ser exactamente el mismo valor en los tres `.env`.** Si difiere, un servicio rechaza los tokens que emitió Usuarios (`401 TOKEN_INVALIDO`) y las compras fallan con `502 DEPENDENCIA_AUTENTICACION`.
- Para ejecución local sin Docker, `entradas-service` y `eventos-service` también necesitan compartir `EVENTOS_SERVICE_TOKEN_SECRET`, distinto de `JWT_SECRET`.
- Si falta en Eventos o en Entradas, sus endpoints protegidos responden `500`.
- Los `.env.example` ya traen los puertos locales: usuarios `3001`, eventos `3002`, entradas `3003`.
- Entradas necesita que Usuarios y Eventos estén corriendo para poder comprar.

Datos de prueba (con la base de cada servicio ya levantada):

```bash
cd services/usuarios-service && npm run seed      # usa SEED_USER_PASSWORD y SEED_ADMIN_PASSWORD de su .env
cd services/eventos-service  && npm run seed
```

Las URLs son las mismas de la sección 2 (`http://localhost:3001`, `:3002`, `:3003`). No corras este modo y Docker Compose a la vez: se pelean por los puertos.

---

## 4. Pruebas

### 4.1 Tests unitarios y de API (no necesitan Docker ni MongoDB)

Usan modelos en memoria y simulan los otros servicios. No requieren `JWT_SECRET` (los tests fijan uno propio).

```bash
cd services/usuarios-service && npm ci && npm test
cd services/eventos-service  && npm ci && npm test
cd services/entradas-service && npm ci && npm test
```

| Servicio | Resultado esperado |
|---|---|
| usuarios | **69** tests, 0 fallos |
| entradas | **57** tests, 0 fallos |
| eventos | **44** tests: 40 pasan y **4 se omiten** porque no hay Redis |

Para que corran también esos 4 tests de Eventos, hace falta un Redis accesible en tu PC (el Compose no publica el de la solución):

```bash
docker run --rm -d --name redis-test -p 6379:6379 redis:7-alpine
cd services/eventos-service
REDIS_URL=redis://localhost:6379 npm test              # PowerShell: $env:REDIS_URL='redis://localhost:6379'; npm test
docker stop redis-test
```

Con Redis, Eventos da **44 de 44**.

Qué cubren: reglas de negocio, validaciones, manejo de errores, autenticación y autorización (401/403, propiedad del recurso), propagación del token entre servicios y que la documentación Swagger coincida con el comportamiento real.

### 4.2 Prueba manual guiada (unos 5 minutos)

Requiere la solución levantada y con seeds (sección 2). Recorre el flujo completo y los rechazos de seguridad más importantes. Reemplazá `<SEED_ADMIN_PASSWORD>` por la contraseña del administrador de tu `.env`.

**Linux / macOS / Git Bash**

```bash
U=localhost:3001; E=localhost:3002; N=localhost:3003
tok() { python3 -c "import json,sys; print(json.load(sys.stdin)['token'])"; }
campo() { python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }

curl -s -w " [HTTP %{http_code}]\n" $U/usuarios                                          # 1
TA=$(curl -s -X POST $U/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"<SEED_ADMIN_PASSWORD>"}' | tok)           # 2
curl -s $U/usuarios -H "Authorization: Bearer $TA" | python3 -c "import json,sys; print(len(json.load(sys.stdin)),'usuarios')"   # 3
ANA=$(curl -s -X POST $U/auth/register -H 'content-type: application/json' \
  -d '{"nombre":"Ana","apellido":"Lopez","email":"ana.manual@example.com","dni":"31222444","fechaNacimiento":"1992-07-21","password":"Clave-Segura-1"}' | campo id)   # 4
TU=$(curl -s -X POST $U/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana.manual@example.com","password":"Clave-Segura-1"}' | tok)              # 5
curl -s -w " [HTTP %{http_code}]\n" $U/usuarios -H "Authorization: Bearer $TU"            # 6
curl -s -w " [HTTP %{http_code}]\n" -X POST $E/eventos -H "Authorization: Bearer $TU" -H 'content-type: application/json' \
  -d '{"nombre":"X","fecha":"2030-01-01T20:00:00Z","lugar":"Sala","precio":1,"aforoTotal":1}'   # 7
EID=$(curl -s -X POST $E/eventos -H "Authorization: Bearer $TA" -H 'content-type: application/json' \
  -d '{"nombre":"Evento manual","fecha":"2030-01-01T20:00:00Z","lugar":"Sala","precio":2500,"aforoTotal":5}' | campo id)   # 8
curl -s -o /dev/null -w "GET /eventos sin token [HTTP %{http_code}]\n" $E/eventos         # 9
curl -s -X POST $N/ordenes -H "Authorization: Bearer $TU" -H 'content-type: application/json' \
  -d "{\"usuarioId\":\"$ANA\",\"eventoId\":\"$EID\",\"cantidad\":2}"; echo                # 10
curl -s $E/eventos/$EID | python3 -c "import json,sys; print('disponibles:', json.load(sys.stdin)['disponibles'])"   # 11
curl -s -w " [HTTP %{http_code}]\n" -X POST $N/ordenes -H "Authorization: Bearer $TU" -H 'content-type: application/json' \
  -d "{\"usuarioId\":\"64b000000000000000000001\",\"eventoId\":\"$EID\",\"cantidad\":1}"   # 12
C=${TU:60:1}; X=A; [ "$C" = A ] && X=B; TB="${TU:0:60}${X}${TU:61}"
curl -s -w " [HTTP %{http_code}]\n" $U/usuarios/$ANA -H "Authorization: Bearer $TB"       # 13
curl -s -o /dev/null -w "perfil propio [HTTP %{http_code}]\n" $U/usuarios/$ANA -H "Authorization: Bearer $TU"   # 14
```

**Windows PowerShell**

```powershell
$U='http://localhost:3001'; $E='http://localhost:3002'; $N='http://localhost:3003'

function Llamar($metodo, $url, $cuerpo = $null, $token = $null) {     # imprime "[HTTP código] cuerpo", también en errores
  $p = @{ Method = $metodo; Uri = $url; ContentType = 'application/json'; UseBasicParsing = $true }
  if ($token)  { $p.Headers = @{ Authorization = "Bearer $token" } }
  if ($cuerpo) { $p.Body = ($cuerpo | ConvertTo-Json -Compress) }
  try   { $r = Invoke-WebRequest @p; "[HTTP $($r.StatusCode)] $($r.Content)" }
  catch { "[HTTP $([int]$_.Exception.Response.StatusCode)] $($_.ErrorDetails.Message)" }
}
function Token($email, $password) {
  (Invoke-RestMethod -Method Post -Uri "$U/auth/login" -ContentType 'application/json' `
    -Body (@{ email = $email; password = $password } | ConvertTo-Json)).token
}

Llamar GET "$U/usuarios"                                                                   # 1
$ta = Token 'admin@example.com' '<SEED_ADMIN_PASSWORD>'                                    # 2
(Invoke-RestMethod -Uri "$U/usuarios" -Headers @{ Authorization = "Bearer $ta" }).Count    # 3
$ana = Invoke-RestMethod -Method Post -Uri "$U/auth/register" -ContentType 'application/json' -Body (@{
  nombre='Ana'; apellido='Lopez'; email='ana.manual@example.com'; dni='31222444'; fechaNacimiento='1992-07-21'; password='Clave-Segura-1' } | ConvertTo-Json)   # 4
$tu = Token 'ana.manual@example.com' 'Clave-Segura-1'                                      # 5
Llamar GET "$U/usuarios" $null $tu                                                         # 6
Llamar POST "$E/eventos" @{ nombre='X'; fecha='2030-01-01T20:00:00Z'; lugar='Sala'; precio=1; aforoTotal=1 } $tu   # 7
$ev = Invoke-RestMethod -Method Post -Uri "$E/eventos" -Headers @{ Authorization = "Bearer $ta" } -ContentType 'application/json' `
  -Body (@{ nombre='Evento manual'; fecha='2030-01-01T20:00:00Z'; lugar='Sala'; precio=2500; aforoTotal=5 } | ConvertTo-Json)   # 8
Llamar GET "$E/eventos"                                                                    # 9
Llamar POST "$N/ordenes" @{ usuarioId=$ana.id; eventoId=$ev.id; cantidad=2 } $tu          # 10
(Invoke-RestMethod "$E/eventos/$($ev.id)").disponibles                                     # 11
Llamar POST "$N/ordenes" @{ usuarioId='64b000000000000000000001'; eventoId=$ev.id; cantidad=1 } $tu   # 12
$c = if ($tu[60] -eq 'A') { 'B' } else { 'A' }; $tb = $tu.Substring(0,60) + $c + $tu.Substring(61)
Llamar GET "$U/usuarios/$($ana.id)" $null $tb                                              # 13
Llamar GET "$U/usuarios/$($ana.id)" $null $tu                                              # 14
```

**Resultados esperados**

| # | Qué se prueba | Resultado |
|---|---|---|
| 1 | Pedir `/usuarios` sin token | **401** `TOKEN_AUSENTE` |
| 2 | Login del administrador | Devuelve un token |
| 3 | El ADMIN lista los usuarios | **6** en una base recién sembrada (5 `USER` + 1 `ADMIN`), más los usuarios que hayas registrado antes (por ejemplo, el del Paso 7) |
| 4 | Registro de un usuario | **201**, con `"role":"USER"` y sin contraseña ni hash |
| 5 | Login del nuevo usuario | Devuelve un token |
| 6 | Un USER intenta listar usuarios | **403** `PERMISOS_INSUFICIENTES` (el token es válido, pero no alcanza el rol) |
| 7 | Un USER intenta crear un evento | **403** |
| 8 | El ADMIN crea un evento | **201**, con `disponibles: 5` |
| 9 | Catálogo de eventos sin token | **200** (es público) |
| 10 | El USER compra 2 entradas para sí | **201**, orden `CONFIRMADA` con 2 tickets |
| 11 | Aforo del evento después de la compra | `disponibles: 3` (Entradas le pidió a Eventos que descuente) |
| 12 | El USER compra a nombre de otra persona | **403** `PERMISOS_INSUFICIENTES` |
| 13 | Token con un carácter modificado | **401** `TOKEN_INVALIDO` (la firma ya no valida) |
| 14 | Perfil propio con el token original | **200** |

**Caída de un servicio (opcional).** Detené Usuarios y repetí la compra (paso 10) con otro usuario: Entradas responde **503** `DEPENDENCIA_NO_DISPONIBLE` y sigue viva. Al volver a iniciar Usuarios, todo vuelve a funcionar, y los tokens que ya tenías siguen valiendo.

```bash
docker compose stop usuarios-service
docker compose start usuarios-service
```

### 4.3 Probar desde Swagger

1. Abrí http://localhost:3001/api-docs.
2. `POST /auth/login` → **Try it out** → credenciales (por ejemplo, el administrador) → **Execute** → copiá el valor de `token`.
3. Botón **Authorize** (arriba a la derecha) → pegá **solo el token**, sin la palabra `Bearer` → **Authorize** → **Close**.
4. Probá `GET /usuarios` (candado 🔒): debe responder 200. Sin autorizar, 401.
5. Abrí http://localhost:3002/api-docs y http://localhost:3003/api-docs: el **mismo token** sirve en ambos (hay que autorizar en cada pestaña). Cada endpoint muestra el rol que exige y sus respuestas 401 y 403.

### 4.4 Pruebas automáticas con evidencias

Requieren Docker Compose, los seeds aplicados y `JWT_SECRET` y `SEED_ADMIN_PASSWORD` en el `.env` de la raíz. Cada una imprime los comandos que ejecuta y guarda su salida en `docs/evidencias/`. **Los tokens, las contraseñas y los hashes salen enmascarados**, así que se pueden adjuntar y versionar.

**Seguridad (TP7): escenarios A a L de la consigna**

```bash
node scripts/tp7/pruebas.js todo        # los 12 escenarios, con resumen. Guarda en docs/evidencias/tp7/
node scripts/tp7/pruebas.js C           # un escenario puntual (A..L)
```

| Escenario | Qué demuestra | Resultado esperado |
|---|---|---|
| **A** Registro | Usuario creado sin contraseña ni hash en la respuesta; el cliente no puede elegirse el rol | OK |
| **B** Duplicado | Email o DNI repetido | `409` |
| **C** Login válido | JWT HS256 con `sub`, `role`, `iat`, `exp`, `iss` y vencimiento | OK |
| **D** Login inválido | Password incorrecta o usuario inexistente (mismo mensaje), datos inválidos, cuenta deshabilitada | `401`, `400`, `403` |
| **E** Sin token | En los tres servicios | `401` |
| **F** Token modificado | Payload alterado, otra clave, `alg: none`, algoritmo no esperado | `401` |
| **G** Token vencido | Token vencido y token sin `exp` | `401` |
| **H** Sin rol suficiente | USER en operaciones de ADMIN o sobre recursos ajenos | `403` |
| **I** Rol autorizado | Operaciones de USER y de ADMIN | OK |
| **J** Dos servicios | La identidad viaja Entradas → Usuarios/Eventos | OK |
| **K** Reinicio | `docker compose down` + `up`: usuarios y contraseñas persisten | OK |
| **L** Persistencia | La contraseña está guardada como hash bcrypt (no en texto plano) | OK |

Resultado esperado: **12 escenarios en `OK`**. El escenario **K reinicia los contenedores** (conserva los volúmenes), así que tarda más que los demás.

```bash
node scripts/tp7/propagacion.js todo    # propagación del token, disponibilidad y logs sin secretos
```

Resultado esperado: `j` (24 verificaciones), `disponibilidad` (12) y `logs-seguridad` (13), todas en `OK`.

**Funcionalidad y resiliencia (TP6)**

```bash
node scripts/tp6/pruebas.js todo        # 13 pruebas. Guarda en docs/evidencias/tp6/
node scripts/tp6/concurrencia.js        # 10 compras simultáneas sobre 3 lugares
```

Estas pruebas operan como el administrador del seed. Todas deben terminar en `OK`. La de concurrencia debe mostrar **exactamente 3 respuestas `201`**, el resto `409 SIN_AFORO` (o `423 EVENTO_OCUPADO`), `disponibles final=0` y `OK: sin sobreventa`.

> Las pruebas del TP6 detienen y reinician contenedores, y su paso `datos` vuelve a ejecutar los seeds (borra y recrea los usuarios y los eventos). Los escenarios del TP7 vuelven a crear sus propios usuarios y eventos, así que se pueden correr en cualquier orden.

### 4.5 Qué evidencias guardar para el informe

- Salida de `docker compose ps` con los 7 contenedores `healthy`.
- Los archivos de `docs/evidencias/tp7/` (`A-registro.txt` … `L-persistencia.txt`, `resumen.txt`) y de `docs/evidencias/tp6/`.
- Capturas de los tres Swagger con el candado y el flujo de login y **Authorize**.
- Verificación de que no se filtró ningún token en las evidencias:

```powershell
Select-String -Path docs\evidencias\tp7\*.txt -Pattern 'eyJ'      # no debe devolver nada
```

---

## 5. Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `required variable ... is missing a value` | No hay `.env` en la raíz, o está vacío `JWT_SECRET` o `EVENTOS_SERVICE_TOKEN_SECRET`. Repetí el [Paso 2](#paso-2--crear-el-env-con-el-secreto-del-jwt) |
| `Bind for 0.0.0.0:3001 failed: port is already allocated` | Otro programa usa el puerto (a menudo un servicio corriendo sin Docker). Detenelo, o cambiá `USUARIOS_HOST_PORT` / `EVENTOS_HOST_PORT` / `ENTRADAS_HOST_PORT` en el `.env` y repetí `docker compose up -d` |
| El seed dice `Definí SEED_USER_PASSWORD y SEED_ADMIN_PASSWORD` | Faltan en el `.env` raíz. Agregalas (mínimo 8 caracteres) y ejecutá `docker compose up -d` para recrear el contenedor con las variables; después repetí el seed |
| Login del administrador da `401` | La contraseña no es la que usó el seed. Cambiar el `.env` **no** cambia la base: volvé a ejecutar `docker compose exec -T usuarios-service npm run seed` |
| Un contenedor queda `starting` mucho tiempo o `unhealthy` | `docker compose logs --tail 50 <servicio>`. Detalle de la salud: `docker inspect --format '{{json .State.Health}}' <contenedor>` |
| `503` con `DB_NO_DISPONIBLE` | El servicio todavía no conectó a su base. Esperá unos segundos: reintenta solo |
| `401 TOKEN_INVALIDO` en Eventos o Entradas con un token válido de Usuarios | `JWT_SECRET` distinto entre servicios (solo ocurre sin Docker). Usá el mismo valor en los tres `.env` y reiniciá |
| `502 DEPENDENCIA_AUTENTICACION` al comprar | Es la misma causa: un servicio no acepta la firma del token que Entradas le reenvió |
| `500` en endpoints protegidos (sin Docker) | Falta `JWT_SECRET` en el `.env` de ese servicio |
| `401 TOKEN_VENCIDO` | El token duró más de `JWT_EXPIRES_IN` (1 h). Iniciá sesión de nuevo |
| En PowerShell `curl` da errores raros | `curl` es un alias de `Invoke-WebRequest`. Usá `curl.exe` o `Invoke-RestMethod` |
| En la consola aparecen símbolos como `â†’` | Es solo la codificación de la consola de Windows. Los archivos de `docs/evidencias/` están bien en UTF-8: abrilos en VS Code, o usá `Get-Content -Encoding UTF8 <archivo>` |
| Los tests de Entradas fallan o avisan por la versión | Verificá `node --version`: Entradas exige 20.19 o superior |
| Querés empezar de cero | [Sección 6](#6-detener-y-limpiar) (`down -v`) y repetí desde el Paso 3 |

---

## 6. Detener y limpiar

```bash
docker compose down        # detiene y elimina los contenedores; CONSERVA los datos (volúmenes)
docker compose down -v     # además BORRA los volúmenes: usuarios, eventos y órdenes
```

Después de `down -v`, hay que volver a cargar los datos de prueba (Paso 5) antes de usar la solución.
