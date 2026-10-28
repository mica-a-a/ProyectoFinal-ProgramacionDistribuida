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

  // TP7: costo de bcrypt (2^N iteraciones). 12 es razonable hoy; en los tests se baja para que corran rápido.
  // Es un getter para que los tests puedan fijar BCRYPT_ROUNDS antes de usarlo.
  get bcryptRounds() { return int(process.env.BCRYPT_ROUNDS, 12); },
};

module.exports = config;
