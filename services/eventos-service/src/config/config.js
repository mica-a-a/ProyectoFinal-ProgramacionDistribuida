require('dotenv').config();

const config = {
  serviceName: process.env.SERVICE_NAME || 'eventos-service',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  mongodbUri: process.env.MONGODB_URI,
  redisUrl: process.env.REDIS_URL,
  lockTtlMs: parseInt(process.env.LOCK_TTL_MS || '5000', 10),
};

module.exports = config;
