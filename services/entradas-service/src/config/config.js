require('dotenv').config();

const config = {
  serviceName: process.env.SERVICE_NAME || 'entradas-service',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  mongodbUri: process.env.MONGODB_URI,
  usuariosServiceUrl: process.env.USUARIOS_SERVICE_URL,
  eventosServiceUrl: process.env.EVENTOS_SERVICE_URL,
  eventosServiceTokenSecret: process.env.EVENTOS_SERVICE_TOKEN_SECRET,
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '3000', 10),
  maxEntradasPorUsuario: parseInt(process.env.MAX_ENTRADAS_POR_USUARIO || '4', 10),
  plazoCancelacionHoras: parseInt(process.env.PLAZO_CANCELACION_HORAS || '24', 10),
};

module.exports = config;
