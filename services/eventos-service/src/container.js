const logger = require('./config/logger');
const config = require('./config/config');
const db = require('./config/db');
const redis = require('./config/redis');
const eventosRepo = require('./repositories/eventos.repository');
const movimientosRepo = require('./repositories/movimientos.repository');
const { createLockManager } = require('./lock/lockManager');
const { createAforoService } = require('./services/aforo.service');
const { createEventosService } = require('./services/eventos.service');
const { createEventosController } = require('./controllers/eventos.controller');
const { createHealthController } = require('./controllers/health.controller');

// Arma las piezas reales (Mongo + Redis). En los tests se arma con versiones simuladas.
function createContainer() {
  const lock = createLockManager({ client: redis.client, ttlMs: config.lockTtlMs, logger });
  const aforoService = createAforoService({ eventosRepo, movimientosRepo, lock, logger });
  const eventosService = createEventosService({ eventosRepo, lock, logger });

  return {
    eventosController: createEventosController({ eventosService, aforoService }),
    healthController: createHealthController({
      readiness: () => ({ mongodb: db.isConnected(), redis: redis.isReady() }),
    }),
  };
}

module.exports = { createContainer };
