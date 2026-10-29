const config = require('./config/config');
const logger = require('./config/logger');
const app = require('./app');
const { connectWithRetry } = require('./config/db');

// Sin un JWT_SECRET fuerte y un JWT_EXPIRES_IN válido el servicio no arranca (mejor caer que emitir tokens inseguros).
try {
  config.assertJwtConfig();
} catch (err) {
  logger.error('configuración JWT inválida', { message: err.message });
  process.exit(1);
}

// Primero se abre el puerto y recién después se conecta a Mongo (con reintentos):
// si la base todavía no está lista, el servicio ya responde /health y devuelve
// 503 controlado en los endpoints que necesitan la base.
app.listen(config.port, () => {
  logger.info('servicio iniciado', { port: config.port });
  connectWithRetry();
});
