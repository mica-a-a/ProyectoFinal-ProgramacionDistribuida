require('dotenv').config();

const config = {
  serviceName: process.env.SERVICE_NAME || 'usuarios-service',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  mongodbUri: process.env.MONGODB_URI,
};

module.exports = config;
