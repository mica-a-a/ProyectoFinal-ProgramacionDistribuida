# usuarios-service

> **Estado:** no implementado. Reservado para el trabajo futuro (TPs siguientes).

**Responsabilidad:** mantener la identidad y los datos personales de las personas registradas.

**Datos propios:** `usuarios` (`id`, `dni`, `nombreApellido`, `fechaNacimiento`, `email`, `direccion`, `activo`).

**Endpoints previstos:** `GET /usuarios`, `GET /usuarios/:id`, `POST /usuarios`, `PUT /usuarios/:id`, `DELETE /usuarios/:id` (baja lógica), `GET /health`.

**Dependencias:** ninguna.

Ficha completa: [`docs/arquitectura.md` §5.1](../../docs/arquitectura.md#5-propuesta-de-microservicios).
