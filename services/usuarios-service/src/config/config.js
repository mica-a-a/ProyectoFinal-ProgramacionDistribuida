require('dotenv').config();

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

const config = {
  serviceName: process.env.SERVICE_NAME || 'usuarios-service',
  port: int(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  mongodbUri: process.env.MONGODB_URI,
  // Cada cuánto se reintenta la conexión a Mongo si todavía no está lista.
  mongodbRetryMs: int(process.env.MONGODB_RETRY_MS, 3000),
  // Cuánto espera el driver para encontrar el servidor antes de fallar (falla rápido).
  mongodbTimeoutMs: int(process.env.MONGODB_TIMEOUT_MS, 3000),
};

module.exports = config;
