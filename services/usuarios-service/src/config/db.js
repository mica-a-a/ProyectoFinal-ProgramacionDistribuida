const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');

// Sin buffer: si no hay conexión, las operaciones fallan enseguida (y respondemos 503) en lugar de quedar colgadas esperando.
mongoose.set('bufferCommands', false);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isConnected() {
  return mongoose.connection.readyState === 1;
}

mongoose.connection.on('disconnected', () => logger.warn('MongoDB desconectado'));
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconectado'));

// Reintenta hasta lograr la primera conexión. El servicio ya está escuchando mientras tanto, así que responde 503 controlado en vez de caerse si la base aún 
//no está lista. Una vez conectado, el driver se encarga de reconectar solo ante caídas posteriores.
async function connectWithRetry() {
  if (!config.mongodbUri) {
    logger.error('MONGODB_URI no está definida: el servicio no podrá persistir datos');
    return;
  }
  for (;;) {
    try {
      await mongoose.connect(config.mongodbUri, {
        serverSelectionTimeoutMS: config.mongodbTimeoutMs,
      });
      logger.info('conectado a MongoDB');
      // Asegura los índices únicos (email, dni) antes de aceptar altas.
      await require('../models/Usuario').init();
      return;
    } catch (err) {
      // No se loguea la URI: puede contener credenciales.
      logger.error('no se pudo conectar a MongoDB, se reintenta', {
        cause: err.name,
        retryInMs: config.mongodbRetryMs,
      });
      await sleep(config.mongodbRetryMs);
    }
  }
}

module.exports = { connectWithRetry, isConnected };
