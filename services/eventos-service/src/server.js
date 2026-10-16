const config = require('./config/config');
const logger = require('./config/logger');
const app = require('./app');

// TODO: conectar acá a la base propia (y a Redis en eventos-service) con manejo de
// reintentos: el servicio debe arrancar y responder de forma controlada aunque una
// dependencia todavía no esté lista.

app.listen(config.port, () => {
  logger.info('servicio iniciado', { port: config.port });
});
