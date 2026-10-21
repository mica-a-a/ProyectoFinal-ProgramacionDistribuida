const config = require('../config/config');

function createHealthController({ readiness }) {
  return {
    // Liveness: el proceso está activo. No expone secretos ni datos internos.
    health(req, res) {
      res.status(200).json({ service: config.serviceName, status: 'ok' });
    },

    // Readiness: además verifica que las dependencias propias (Mongo y Redis) estén disponibles.
    ready(req, res) {
      const dependencies = readiness();
      const listo = Object.values(dependencies).every(Boolean);
      res.status(listo ? 200 : 503).json({
        service: config.serviceName,
        status: listo ? 'ready' : 'degraded',
        dependencies: {
          mongodb: dependencies.mongodb ? 'up' : 'down',
          redis: dependencies.redis ? 'up' : 'down',
        },
      });
    },
  };
}

module.exports = { createHealthController };
