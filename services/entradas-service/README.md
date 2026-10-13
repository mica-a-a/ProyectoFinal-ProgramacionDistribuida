# entradas-service

> **Estado:** no implementado. Reservado para el trabajo futuro (TPs siguientes).

**Responsabilidad:** gestionar la compra de entradas de cada usuario y el ciclo de vida de cada ticket.

**Datos propios:** `ordenes`, `tickets`.

**Endpoints previstos:** `POST /ordenes`, `GET /ordenes/:id`, `DELETE /ordenes/:id`, `GET /entradas?usuarioId=`, `POST /entradas/validar`, `GET /health`.

**Dependencias:** `usuarios-service` y `eventos-service`.

Ficha completa: [`docs/arquitectura.md` §5.1](../../docs/arquitectura.md#5-propuesta-de-microservicios).
