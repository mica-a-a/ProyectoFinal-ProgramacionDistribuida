const winston = require('winston');
const config = require('./config');

// Los logs salen por stdout (visibles con `docker compose logs <servicio>`)
// e incluyen siempre el nombre del servicio.
const logger = winston.createLogger({
  level: config.logLevel,
  defaultMeta: { service: config.serviceName },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
