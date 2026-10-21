const config = require('../config/config');
const logger = require('../config/logger');

// Error de una llamada a otro servicio. `kind` permite a la capa de negocio decidir:
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
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 423) return 'LOCKED';
  if (status >= 500) return 'REMOTE_ERROR';
  return 'REMOTE_REJECTED';
}

async function request(service, baseUrl, path, { method = 'GET', body } = {}) {
  const url = `${baseUrl}${path}`;
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
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
  });
  throw new RemoteServiceError({
    service, kind, status: res.status, body: data,
    message: `${service} respondió ${res.status}`,
  });
}

module.exports = { request, RemoteServiceError };
