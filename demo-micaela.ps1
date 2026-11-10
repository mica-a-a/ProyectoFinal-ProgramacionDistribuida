$ErrorActionPreference = "Stop"

function Titulo($t) {
    Write-Host ""
    Write-Host "=== $t ===" -ForegroundColor Cyan
}

function LeerEnv($nombre) {
    $linea = Select-String -Path ".env" -Pattern "^$nombre=" | Select-Object -First 1
    if (-not $linea) { throw "No encontre $nombre en el .env" }
    $valor = $linea.Line.Split('=', 2)[1].Trim().Trim('"')
    if (-not $valor) { throw "$nombre esta vacio en el .env" }
    return $valor
}

function MensajeError($e) {
    if ($e.ErrorDetails -and $e.ErrorDetails.Message) { return $e.ErrorDetails.Message }
    return $e.Exception.Message
}

function Validar($tokenAdmin, $codigo) {
    try {
        $x = Invoke-RestMethod -Method Post -Uri http://localhost:3003/entradas/validar `
            -Headers @{ Authorization = "Bearer $tokenAdmin" } -ContentType "application/json" `
            -Body (@{ codigo = $codigo } | ConvertTo-Json)
        Write-Host "HTTP 200 -> $($x.mensaje)" -ForegroundColor Green
    } catch {
        $status = [int]$_.Exception.Response.StatusCode
        Write-Host "HTTP $status -> $(MensajeError $_)" -ForegroundColor Yellow
    }
}

Titulo "0. Comprobando que los 3 servicios respondan"
foreach ($p in 3001, 3002, 3003) {
    try {
        $h = Invoke-RestMethod "http://localhost:$p/health"
        Write-Host "OK  puerto $p -> $($h.service)" -ForegroundColor Green
    } catch {
        throw "El puerto $p no responde. Corre: docker compose ps"
    }
}

Titulo "1. Concurrencia: 10 compras simultaneas sobre 3 lugares"
node scripts/tp6/concurrencia.js

Titulo "2. Login de Lucia (USER)"
$PASS_USER = LeerEnv "SEED_USER_PASSWORD"
try {
    $r = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
        -ContentType "application/json" `
        -Body (@{ email = "lucia.fernandez@example.com"; password = $PASS_USER } | ConvertTo-Json)
} catch {
    throw "El login de Lucia fallo: $(MensajeError $_)  --> Probablemente faltan los seeds."
}
$TOKEN = $r.token
Write-Host "Token recibido (largo $($TOKEN.Length)). No se muestra completo." -ForegroundColor Green

$p64 = $TOKEN.Split('.')[1].Replace('-', '+').Replace('_', '/')
while ($p64.Length % 4) { $p64 += '=' }
$USUARIO_ID = ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p64)) | ConvertFrom-Json).sub
Write-Host "Usuario (sub del token): $USUARIO_ID"

Titulo "3. Buscar el evento Taller de Node.js"
$lista = Invoke-RestMethod http://localhost:3002/eventos
$nombres = @($lista.nombre)
$idx = [array]::IndexOf($nombres, "Taller de Node.js")
if ($idx -lt 0) { throw "No existe el evento 'Taller de Node.js'. Falta correr el seed de eventos." }
$evento = @($lista)[$idx]
Write-Host "Evento: $($evento.nombre)  id=$($evento.id)  disponibles=$($evento.disponibles)  estado=$($evento.estado)"

Titulo "4. Comprar 2 entradas con el token de Lucia"
try {
    $orden = Invoke-RestMethod -Method Post -Uri http://localhost:3003/ordenes `
        -Headers @{ Authorization = "Bearer $TOKEN" } -ContentType "application/json" `
        -Body (@{ usuarioId = $USUARIO_ID; eventoId = $evento.id; cantidad = 2 } | ConvertTo-Json)
} catch {
    throw "La compra fallo: $(MensajeError $_)  --> Si dice MAXIMO_ENTRADAS_EXCEDIDO o SIN_AFORO, hace el reinicio limpio y los seeds."
}
$CODIGO = $orden.tickets[0].codigo
Write-Host "Orden $($orden.orden.estado) con $($orden.tickets.Count) tickets. Ticket a validar: $CODIGO" -ForegroundColor Green

Titulo "5. Login como ADMIN"
$PASS_ADMIN = LeerEnv "SEED_ADMIN_PASSWORD"
try {
    $ra = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
        -ContentType "application/json" `
        -Body (@{ email = "admin@example.com"; password = $PASS_ADMIN } | ConvertTo-Json)
} catch {
    throw "El login de ADMIN fallo: $(MensajeError $_)"
}
$TOKEN_ADMIN = $ra.token
Write-Host "Token ADMIN recibido (largo $($TOKEN_ADMIN.Length))." -ForegroundColor Green

Titulo "6. Validar el ticket - PRIMERA vez (debe dar 200)"
Validar $TOKEN_ADMIN $CODIGO

Titulo "7. Validar el MISMO ticket - SEGUNDA vez (debe dar 409)"
Validar $TOKEN_ADMIN $CODIGO

Write-Host ""
Write-Host "Demo terminada. Antes de la prueba real: docker compose down -v, up --build -d y los 2 seeds." -ForegroundColor Cyan