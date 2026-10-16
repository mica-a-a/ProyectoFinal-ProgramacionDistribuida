const config = require('../config/config');
const { request } = require('./httpClient');

const SERVICE = 'eventos-service';
const enc = encodeURIComponent;

// Contrato público de eventos-service (TP5, comunicaciones #2, #3 y #4).
function getEvento(id) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(id)}`);
}

// referencia = ordenId (clave de idempotencia)
function reservarAforo(eventoId, { cantidad, referencia }) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(eventoId)}/reservar-aforo`, {
    method: 'POST', body: { cantidad, referencia },
  });
}

function liberarAforo(eventoId, { cantidad, referencia }) {
  return request(SERVICE, config.eventosServiceUrl, `/eventos/${enc(eventoId)}/liberar-aforo`, {
    method: 'POST', body: { cantidad, referencia },
  });
}

module.exports = { getEvento, reservarAforo, liberarAforo };
