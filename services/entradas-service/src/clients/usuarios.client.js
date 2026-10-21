const config = require('../config/config');
const { request } = require('./httpClient');

// Contrato público de usuarios-service (TP5, comunicación #1).
function getUsuario(id) {
  return request('usuarios-service', config.usuariosServiceUrl, `/usuarios/${encodeURIComponent(id)}`);
}

module.exports = { getUsuario };
