const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');
const { AppError } = require('./errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Conecta a la base propia con reintentos. No bloquea el arranque del servicio:
// mientras la base no esté lista, las rutas de negocio responden 503 (ver requireDb).
async function connectWithRetry() {
  let intento = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    intento += 1;
    try {
      await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 3000 });
      logger.info('conectado a MongoDB', { intento });
      return;
    } catch (err) {
      const espera = Math.min(1000 * intento, 10000);
      logger.warn('MongoDB no disponible, se reintenta', { intento, reintentoEnMs: espera, causa: err.name });
      await sleep(espera);
    }
  }
}

mongoose.connection.on('disconnected', () => logger.warn('conexión con MongoDB perdida'));
mongoose.connection.on('reconnected', () => logger.info('conexión con MongoDB recuperada'));

// Middleware: las rutas que usan la base responden 503 si todavía no está disponible.
function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return next(new AppError(503, 'Base de datos no disponible', 'DB_NO_DISPONIBLE'));
  }
  return next();
}

module.exports = { connectWithRetry, requireDb };
