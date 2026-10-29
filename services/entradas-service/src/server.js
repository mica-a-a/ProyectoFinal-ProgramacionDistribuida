const mongoose = require('mongoose');
const config = require('./config/config');
const logger = require('./config/logger');
const { connectWithRetry } = require('./config/db');
const app = require('./app');

if (!config.mongodbUri || !config.usuariosServiceUrl || !config.eventosServiceUrl) {
  logger.error('faltan variables de entorno obligatorias (MONGODB_URI, USUARIOS_SERVICE_URL, EVENTOS_SERVICE_URL)');
  process.exit(1);
}

// El servidor HTTP arranca primero: /health responde aunque la base todavía no esté lista.
// Las rutas de negocio contestan 503 hasta que la conexión a MongoDB se establece.
const server = app.listen(config.port, () => {
  logger.info('servicio iniciado', { port: config.port });
});
connectWithRetry();

// Cierre ordenado (docker stop envía SIGTERM).
function shutdown(signal) {
  logger.info('cerrando servicio', { signal });
  server.close(async () => {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
