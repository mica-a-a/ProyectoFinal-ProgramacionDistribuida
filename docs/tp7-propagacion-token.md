# TP7 · Integración entre microservicios y propagación del token

Implementación del apartado 5 del checklist (sección 13 de la consigna). Complementa `docs/tp7-hito1-seguridad.md` (secciones 7 y 8), que define la estrategia; acá se documenta cómo quedó implementada, cómo falla y cómo probarla.

## 1. Estrategia

**Entradas valida el token del cliente y se lo reenvía, tal cual, a Usuarios y a Eventos.**

```text
Cliente ──Authorization: Bearer JWT──► entradas-service
                                         │  1. verifica firma, algoritmo, emisor y vencimiento (localmente)
                                         │  2. aplica sus reglas: rol y propiedad del recurso
                                         │
                                         ├──Authorization: Bearer JWT──► usuarios-service   GET  /usuarios/:id
                                         └──Authorization: Bearer JWT──► eventos-service    GET  /eventos/:id
                                                                                            POST /eventos/:id/reservar-aforo
                                                                                            POST /eventos/:id/liberar-aforo
```

| Decisión | Por qué |
|---|---|
| Se reenvía el token **del cliente**, no uno propio de Entradas | Es lo que admite la consigna (sección 13) y evita inventar un mecanismo nuevo. El servicio remoto ve la misma identidad que originó la operación, y su propia regla de autorización (rol, propiedad) se aplica sobre ella |
| Solo viaja el encabezado `Authorization` (normalizado a `Bearer <token>`) | No se reenvían cookies ni otros encabezados del cliente. Un test lo verifica |
| El contexto se pasa **explícito** (`ctx = { authorization }`) de controlador a servicio a cliente HTTP | Sin estado oculto: se ve en la firma de cada función qué viaja y es fácil de testear. La consigna pide evitar distribuir detalles de HTTP por los controladores: el reenvío vive en `clients/httpClient.js` |
| Se reenvía también en `GET /eventos/:id`, aunque es público | Una sola regla ("toda llamada de Entradas lleva la identidad"). No cuesta nada y Eventos la ignora en los endpoints públicos |
| Lo que Entradas rechaza **nunca se propaga** | Sin token, vencido, alterado, o un USER comprando para otro: se corta con 401/403 antes de llamar a nadie |
| Usuarios no consulta ni se consulta para validar el token | La verificación de la firma es local en cada servicio (`JWT_SECRET` compartido). El principio de la sección 12 |

## 2. Qué usa cada servicio del token

| Servicio | Claims que usa | Para qué |
|---|---|---|
| `usuarios-service` | `sub`, `role` | Propiedad del perfil (`sub` = `:id`) y operaciones de ADMIN. Es el único que **emite** tokens |
| `eventos-service` | `role` | Exige ADMIN para gestionar eventos; en `reservar-aforo`/`liberar-aforo` solo exige un token válido |
| `entradas-service` | `sub`, `role` | Dueño de la orden o de las entradas; ADMIN puede con todo. Además **propaga** el token |

## 3. Qué pasa cuando el servicio remoto rechaza la identidad propagada

Entradas ya validó el token antes de llamar, así que un 401 o 403 remoto tiene una causa concreta. Se traduce según quién tiene la culpa (`services/remoteErrors.js`):

| Responde el servicio remoto | Entradas responde al cliente | Motivo |
|---|---|---|
| `401` con `code: TOKEN_VENCIDO` | `401 TOKEN_VENCIDO` | El token venció **durante** la operación: el cliente debe volver a iniciar sesión |
| Cualquier otro `401` | `502 DEPENDENCIA_AUTENTICACION` | El token del cliente es válido (Entradas lo verificó): el problema es de configuración nuestra, típicamente `JWT_SECRET` o `JWT_ISSUER` distintos entre servicios. No se le echa la culpa al cliente |
| `403` | `403 PERMISOS_INSUFICIENTES` | El servicio dueño del recurso aplicó **su** regla; Entradas la respeta y no la reinterpreta |

En una compra, en los tres casos la orden queda `RECHAZADA` (nunca se descontó aforo); al cancelar, la orden sigue `CONFIRMADA`. El log de Entradas guarda la dependencia, el `status` y el `remoteCode`.

## 4. Si Usuarios cae después de haber emitido un token

Responde la pregunta de la sección 12 de la consigna. Se probó con `scripts/tp7/propagacion.js disponibilidad`:

| Operación con un token ya emitido | Resultado | Por qué |
|---|---|---|
| ADMIN crea un evento | **201** | Eventos valida el token por sí mismo |
| Un USER consulta su orden | **200** | Entradas valida el token por sí mismo |
| Catálogo público | **200** | No requiere identidad |
| Comprar entradas | **503** `DEPENDENCIA_NO_DISPONIBLE` | Entradas necesita consultar a Usuarios |
| Login y registro | Sin respuesta | El emisor está caído |
| Después de reiniciar Usuarios | El **mismo token** sigue valiendo | No hay sesiones del lado del servidor |

## 5. Observabilidad

Cada log de `request` de los tres servicios incluye `sub` y `role` cuando el pedido está autenticado. Así `docker compose logs` muestra **quién** hizo cada operación en cada servicio, y es la evidencia de que la identidad viajó:

```json
{"service":"usuarios-service","message":"request","method":"GET","path":"/usuarios/<id>","status":200,"sub":"<id>","role":"USER"}
{"service":"eventos-service","message":"request","method":"POST","path":"/eventos/<id>/reservar-aforo","status":200,"sub":"<id>","role":"USER"}
```

Nunca se loguea el token, solo su `sub` y `role` (sección 17). Un test unitario y la prueba `logs-seguridad` lo comprueban.

## 6. Configuración

El `docker-compose.yml` entrega `JWT_SECRET` (obligatorio, sin valor por defecto) y `JWT_ISSUER` a los **tres** servicios. Si falta, `docker compose up` falla con un mensaje claro. `JWT_EXPIRES_IN` y `BCRYPT_ROUNDS` solo los necesita el emisor.

## 7. Limitaciones asumidas

| Limitación | Consecuencia | Mejora posible |
|---|---|---|
| El token propagado puede vencer antes de terminar una compensación (por ejemplo, `liberar-aforo` tras fallar la emisión de tickets) | La orden queda `PENDIENTE` para recuperación, igual que ante cualquier fallo incierto | Un token de servicio con rol propio (`SERVICE`) para las llamadas de compensación |
| `reservar-aforo` y `liberar-aforo` aceptan a cualquier USER autenticado (documentado en el Hito 1) | Un usuario podría llamar a Eventos directamente, sin pasar por Entradas | Rol `SERVICE`, o no publicar el puerto de Eventos |
| Clave simétrica (HS256) compartida | Cualquier servicio con `JWT_SECRET` podría firmar tokens | RS256: solo Usuarios tendría la clave privada |
| Sin revocación | Una cuenta dada de baja conserva su token hasta que vence | Vida corta (1 h) y, a futuro, lista de revocación |

## 8. Pruebas

### Automáticas, sin Docker

```bash
cd services/entradas-service && npm test      # 52 tests (14 nuevos: 11 de propagación y 3 de traducción de errores)
```

| Test | Qué demuestra |
|---|---|
| Reenvía a Usuarios el mismo token | Propagación en `GET /usuarios/:id` |
| Reenvía a Eventos en todas las llamadas | Propagación en consulta y `reservar-aforo` |
| Cancelar propaga a consulta y `liberar-aforo` | Propagación en el segundo caso de uso |
| El contexto es el del cliente (USER y ADMIN) | No se usa una identidad propia de Entradas |
| Solo viaja `Authorization` | No hay fuga de cookies ni otros encabezados |
| Sin token, vencido o alterado: 401 y 0 llamadas | Lo rechazado no se propaga |
| USER para otro usuario: 403 y 0 llamadas | Propiedad antes de propagar |
| 401 `TOKEN_VENCIDO` remoto → 401; otro 401 → 502; 403 → 403 | Traducción de errores (sección 3) |
| El token no aparece en ningún log | Sección 17 |

Los simulados de Usuarios y Eventos de los tests **validan el token como los servicios reales**: si Entradas dejara de propagarlo, 27 de los 38 tests anteriores fallan (se comprobó quitando el reenvío a propósito).

### Con la solución completa (evidencia del escenario J)

```bash
cp .env.example .env            # completar JWT_SECRET (instrucciones dentro del archivo)
docker compose up --build -d
docker compose exec -T usuarios-service npm run seed
docker compose exec -T eventos-service npm run seed
node scripts/tp7/propagacion.js todo
```

| Prueba | Qué demuestra | Escenario |
|---|---|---|
| `j` | Compra de USER y de ADMIN que atraviesa Entradas → Usuarios/Eventos con la identidad en los logs de cada servicio; propiedad del recurso; cancelar; tokens inválidos que no se propagan | **J** (y E, F, G, H) |
| `disponibilidad` | Usuarios caído después de emitir el token (sección 4) | Sección 12 |
| `logs-seguridad` | Ningún JWT, contraseña ni hash en los logs; login fallido y exitoso registrados | Sección 17 |

Cada prueba guarda su salida en `docs/evidencias/tp7/<prueba>.txt`. **Los tokens y las contraseñas salen enmascarados**, así que esos archivos se pueden adjuntar y versionar (sección 15).

## 9. Trazabilidad Git sugerida

Rama `feature/token-propagation`, con commits separados para que se vea el aporte:

1. `feat(entradas): propagar el Authorization a Usuarios y Eventos`
2. `feat(entradas): traducir 401 y 403 de los servicios remotos`
3. `test(entradas): tests de propagación y simulados que validan el token`
4. `feat: registrar sub y role en el log de request de los tres servicios`
5. `fix(compose): entregar JWT_SECRET a eventos y entradas`
6. `feat(scripts): pruebas de propagación y disponibilidad del TP7`
7. `docs(tp7): propagación del token`
