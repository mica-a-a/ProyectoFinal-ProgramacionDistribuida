const { AppError } = require('../config/errors');
const { RemoteServiceError } = require('../clients/httpClient');

// Traduce los errores del cliente HTTP a errores del servicio (tabla 15.2 del TP6):
//   NOT_FOUND       -> 404 funcional (no se convierte en 503)
//   CONFLICT        -> 409 se propaga
//   LOCKED          -> 423 recurso ocupado (reintentable)
//   UNAVAILABLE     -> 503 dependencia no disponible (timeout, DNS, conexión rechazada)
//   REMOTE_ERROR    -> 503 fallo inesperado del servicio remoto (5xx)
//   REMOTE_REJECTED -> 502 el servicio remoto rechazó nuestro pedido (contrato roto)
function mensajeRemoto(err) {
  return err.body && typeof err.body === 'object' ? err.body.message : undefined;
}

const codigoRemoto = (err) => (err.body && typeof err.body === 'object' ? err.body.code : undefined);

function toAppError(err, overrides = {}) {
  if (!(err instanceof RemoteServiceError)) return err;
  const o = overrides[err.kind] || {};
  switch (err.kind) {
    case 'NOT_FOUND':
      return new AppError(404, o.message || mensajeRemoto(err) || `Recurso no encontrado en ${err.service}`, o.code || 'RECURSO_NO_ENCONTRADO');
    case 'CONFLICT':
      // Se conserva el código que informó el dueño de la regla (SIN_AFORO, EVENTO_NO_VENDIBLE, ...).
      return new AppError(409, o.message || mensajeRemoto(err) || 'Conflicto informado por el servicio remoto', codigoRemoto(err) || o.code || 'CONFLICTO_REMOTO');
    case 'LOCKED':
      return new AppError(423, o.message || 'El recurso está ocupado, intentá nuevamente', o.code || 'RECURSO_OCUPADO');
    case 'UNAVAILABLE':
      return new AppError(503, `${err.service} no está disponible`, 'DEPENDENCIA_NO_DISPONIBLE');
    case 'REMOTE_ERROR':
      return new AppError(503, `${err.service} respondió con un error inesperado`, 'DEPENDENCIA_ERROR');
    default:
      return new AppError(502, `${err.service} rechazó el pedido (HTTP ${err.status})`, 'DEPENDENCIA_RECHAZO');
  }
}

// Fallo sin respuesta confiable: no sabemos si el servicio remoto llegó a aplicar el cambio.
const esIncierto = (err) => err instanceof RemoteServiceError && (err.kind === 'UNAVAILABLE' || err.kind === 'REMOTE_ERROR');

module.exports = { toAppError, esIncierto };
