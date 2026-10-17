const { randomUUID } = require('crypto');
const { AppError } = require('../config/errors');

// Libera el lock SOLO si todavía es nuestro (compara el token y borra en un único paso atómico).
// En el TP4 esto eran dos comandos (GET y DEL): si el lock expiraba entre ambos, se podía borrar
// el lock de otro pedido. El script Lua evita esa carrera.
const SCRIPT_LIBERAR = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

function createLockManager({ client, ttlMs, logger }) {
  async function tomar(clave) {
    const token = randomUUID();
    let resultado;
    try {
      // SET clave token NX PX ttl: solo se crea si no existe, y expira sola.
      resultado = await client.set(clave, token, { NX: true, PX: ttlMs });
    } catch (err) {
      logger.error('Redis no disponible al tomar el lock', { clave, cause: err.code || err.name });
      throw new AppError(503, 'Coordinador de locks no disponible, intentá más tarde', 'REDIS_NO_DISPONIBLE');
    }
    if (resultado !== 'OK') {
      logger.warn('Lock ocupado', { clave });
      throw new AppError(423, 'El evento está siendo modificado, intentá nuevamente', 'LOCK_OCUPADO');
    }
    return token;
  }

  async function liberar(clave, token) {
    try {
      await client.eval(SCRIPT_LIBERAR, { keys: [clave], arguments: [token] });
    } catch (err) {
      // No es grave: el lock expira solo por TTL.
      logger.warn('No se pudo liberar el lock; expirará por TTL', { clave, cause: err.code || err.name });
    }
  }

  // Ejecuta `fn` con exclusión mutua sobre `clave`.
  async function withLock(clave, fn) {
    const token = await tomar(clave);
    try {
      return await fn();
    } finally {
      await liberar(clave, token);
    }
  }

  return { withLock };
}

module.exports = { createLockManager };
