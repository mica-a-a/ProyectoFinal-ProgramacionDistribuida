const config = require('../config/config');
const { request } = require('./httpClient');

// Contrato público de usuarios-service (TP5, comunicación #1).
// TP7: `ctx.authorization` es el token del cliente, que se propaga (ver httpClient.request).
function getUsuario(id, ctx = {}) {
  return request('usuarios-service', config.usuariosServiceUrl, `/usuarios/${encodeURIComponent(id)}`, {
    authorization: ctx.authorization,
  });
}

module.exports = { getUsuario };
