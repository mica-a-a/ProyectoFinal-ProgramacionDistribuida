const config = require('./config/config');
const logger = require('./config/logger');
const db = require('./config/db');
const redis = require('./config/redis');
const { createContainer } = require('./container');
const { createApp } = require('./app');

const app = createApp(createContainer());

// El servidor HTTP arranca de inmediato; Mongo y Redis se conectan en segundo plano con reintentos.
// Mientras no estén listos, /health responde ok y /ready responde 503 "degraded".
const server = app.listen(config.port, () => {
  logger.info('servicio iniciado', { port: config.port });
});

db.connectWithRetry();
redis.connect();

// docker stop envía SIGTERM: se cierran las conexiones ordenadamente.
async function apagar(signal) {
  logger.info('apagando servicio', { signal });
  server.close();
  await Promise.allSettled([db.disconnect(), redis.disconnect()]);
  process.exit(0);
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
