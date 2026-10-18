const config = require('./config/config');
const logger = require('./config/logger');
const app = require('./app');
const { connectWithRetry } = require('./config/db');

// Primero se abre el puerto y recién después se conecta a Mongo (con reintentos):
// si la base todavía no está lista, el servicio ya responde /health y devuelve
// 503 controlado en los endpoints que necesitan la base.
app.listen(config.port, () => {
  logger.info('servicio iniciado', { port: config.port });
  connectWithRetry();
});
