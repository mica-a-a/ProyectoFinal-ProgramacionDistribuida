const config = require('../config/config');
const { request } = require('./httpClient');
const jwt = require('jsonwebtoken');

const SERVICE = 'eventos-service';
const IDENTIDAD_SERVICIO = 'entradas-service';
const enc = encodeURIComponent;

function authorizationServicio() {
  if (!config.eventosServiceTokenSecret) {
    throw new Error('EVENTOS_SERVICE_TOKEN_SECRET no configurado');
  }
  if (config.eventosServiceTokenSecret.length < 32) {
    throw new Error('EVENTOS_SERVICE_TOKEN_SECRET debe tener al menos 32 caracteres');
  }
  if (config.eventosServiceTokenSecret === process.env.JWT_SECRET) {
    throw new Error('EVENTOS_SERVICE_TOKEN_SECRET debe ser distinto de JWT_SECRET');
  }
  const token = jwt.sign(
    { service: IDENTIDAD_SERVICIO },
    config.eventosServiceTokenSecret,
    {
      algorithm: 'HS256',
      subject: IDENTIDAD_SERVICIO,
      issuer: IDENTIDAD_SERVICIO,
      audience: 'eventos-service',
      expiresIn: '1m',
    },
  );
  return `Bearer ${token}`;
}

// El token del cliente se conserva en las lecturas; las mutaciones de aforo usan identidad técnica.
function getEvento(id, ctx = {}) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(id)}`, { authorization: ctx.authorization });
}

// referencia = ordenId (clave de idempotencia)
function reservarAforo(eventoId, { cantidad, referencia }) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(eventoId)}/reservar-aforo`, {
    method: 'POST', body: { cantidad, referencia }, authorization: authorizationServicio(),
  });
}

function liberarAforo(eventoId, { cantidad, referencia }) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(eventoId)}/liberar-aforo`, {
    method: 'POST', body: { cantidad, referencia }, authorization: authorizationServicio(),
  });
}

module.exports = { getEvento, reservarAforo, liberarAforo };
