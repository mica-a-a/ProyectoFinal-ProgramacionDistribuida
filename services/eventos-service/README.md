# eventos-service

> **Estado:** no implementado. Reservado para el trabajo futuro (TPs siguientes).

**Responsabilidad:** gestionar los eventos y garantizar que nunca se entreguen más lugares que su aforo.

**Datos propios:** `eventos`, `movimientosAforo`, locks `lock:evento:{id}` en Redis.

**Endpoints previstos:** `GET /eventos`, `GET /eventos/:id`, `POST /eventos`, `PUT /eventos/:id`, `PATCH /eventos/:id/cancelar`, `POST /eventos/:id/reservar-aforo` (interno), `POST /eventos/:id/liberar-aforo` (interno), `GET /health`.

**Dependencias:** ninguna.

Ficha completa: [`docs/arquitectura.md` §5.1](../../docs/arquitectura.md#5-propuesta-de-microservicios).
