const config = require('../config/config');
const logger = require('../config/logger');

// Error de una llamada a otro servicio. `kind` permite a la capa de negocio decidir:
//   UNAUTHENTICATED 401  -> el servicio remoto no aceptó el token que se le propagó (TP7)
//   FORBIDDEN       403  -> el servicio remoto aplicó SU regla de autorización (TP7)
//   NOT_FOUND       404  -> error funcional (no convertir en 503)
//   CONFLICT        409  -> conflicto de negocio (propagar o traducir)
//   LOCKED          423  -> recurso ocupado (se puede reintentar)
//   REMOTE_REJECTED 4xx  -> pedido rechazado por el servicio remoto
//   REMOTE_ERROR    5xx  -> fallo inesperado del servicio remoto
//   UNAVAILABLE     sin respuesta válida (timeout, DNS, conexión rechazada)
class RemoteServiceError extends Error {
  constructor({ service, kind, status, body, message }) {
    super(message);
    this.service = service;
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

function kindFromStatus(status) {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 423) return 'LOCKED';
  if (status >= 500) return 'REMOTE_ERROR';
  return 'REMOTE_REJECTED';
}

// TP7 - Propagación del token (docs/tp7-hito1-seguridad.md, sección 7).
// `authorization` es el encabezado `Bearer <jwt>` que el cliente le envió a Entradas y que Entradas YA validó.
// Se reenvía tal cual para que el servicio remoto conozca la misma identidad. Nunca se loguea ni se modifica.
async function request(service, baseUrl, path, { method = 'GET', body, authorization } = {}) {
  const url = `${baseUrl}${path}`;
  const started = Date.now();
  const headers = { 'content-type': 'application/json' };
  if (authorization) headers.authorization = authorization;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    logger.error('dependencia no disponible', {
      dependency: service, method, path, ms: Date.now() - started,
      cause: err.cause?.code || err.name,
    });
    throw new RemoteServiceError({
      service, kind: 'UNAVAILABLE',
      message: `${service} no disponible (${err.cause?.code || err.name})`,
    });
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (res.ok) return data;

  const kind = kindFromStatus(res.status);
  logger.warn('respuesta no exitosa de dependencia', {
    dependency: service, method, path, status: res.status, kind, ms: Date.now() - started,
    ...(data && typeof data === 'object' && data.code ? { remoteCode: data.code } : {}),
  });
  throw new RemoteServiceError({
    service, kind, status: res.status, body: data,
    message: `${service} respondió ${res.status}`,
  });
}

module.exports = { request, RemoteServiceError };
