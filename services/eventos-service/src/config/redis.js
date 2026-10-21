const { createClient } = require('redis');
const config = require('./config');
const logger = require('./logger');

// - disableOfflineQueue: si Redis no está, los comandos fallan enseguida (no se acumulan).
// - reconnectStrategy: reintenta indefinidamente con espera creciente (máx. 3 s).
const client = createClient({
  url: config.redisUrl,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 3000,
    reconnectStrategy: (retries) => Math.min(retries * 500, 3000),
  },
});

let lastErrorLog = 0;
client.on('error', (err) => {
  // Evita llenar el log con un error por cada intento de reconexión.
  if (Date.now() - lastErrorLog > 5000) {
    lastErrorLog = Date.now();
    logger.warn('Redis no disponible', { cause: err.code || err.name });
  }
});
client.on('ready', () => logger.info('Redis conectado'));

function connect() {
  // Con reconnectStrategy, connect() queda reintentando hasta conectar.
  client.connect().catch((err) => logger.error('Falló la conexión a Redis', { cause: err.name }));
}

function isReady() {
  return client.isReady;
}

async function disconnect() {
  if (client.isOpen) await client.quit();
}

module.exports = { client, connect, isReady, disconnect };
