const config = require('../config/config');
const { request } = require('./httpClient');

const SERVICE = 'eventos-service';
const enc = encodeURIComponent;

// Contrato público de eventos-service (TP5, comunicaciones #2, #3 y #4).
// TP7: `ctx.authorization` es el token del cliente, que se propaga a todas las llamadas
// (GET /eventos/:id es público, pero se reenvía igual para conservar el contexto de identidad).
function getEvento(id, ctx = {}) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(id)}`, { authorization: ctx.authorization });
}

// referencia = ordenId (clave de idempotencia)
function reservarAforo(eventoId, { cantidad, referencia }, ctx = {}) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(eventoId)}/reservar-aforo`, {
    method: 'POST', body: { cantidad, referencia }, authorization: ctx.authorization,
  });
}

function liberarAforo(eventoId, { cantidad, referencia }, ctx = {}) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(eventoId)}/liberar-aforo`, {
    method: 'POST', body: { cantidad, referencia }, authorization: ctx.authorization,
  });
}

module.exports = { getEvento, reservarAforo, liberarAforo };
