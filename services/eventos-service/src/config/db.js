const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');

const RETRY_MS = 3000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Si Mongo no responde, las operaciones fallan rápido (en vez de quedar colgadas)
// y el servicio las traduce a 503.
mongoose.set('bufferTimeoutMS', 2000);

function isConnected() {
  return mongoose.connection.readyState === 1;
}

// Conecta en segundo plano: el servicio arranca aunque Mongo todavía esté iniciando,
// y reintenta hasta lograrlo. Una vez conectado, el driver reconecta solo.
async function connectWithRetry() {
  if (!config.mongodbUri) {
    logger.error('MONGODB_URI no está definida');
    return;
  }
  for (;;) {
    try {
      await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 3000 });
      logger.info('MongoDB conectado');
      // Los índices (incluido el único de movimientos) se crean una vez conectado.
      await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
      return;
    } catch (err) {
      logger.warn('MongoDB no disponible, se reintenta', { cause: err.name, retryInMs: RETRY_MS });
      await sleep(RETRY_MS);
    }
  }
}

async function disconnect() {
  await mongoose.disconnect();
}

module.exports = { connectWithRetry, isConnected, disconnect };
