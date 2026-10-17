const express = require('express');
const swaggerUi = require('swagger-ui-express');
const logger = require('./config/logger');
const openapi = require('./docs/openapi');
const healthRoutes = require('./routes/health.routes');
const ordenesRoutes = require('./routes/ordenes.routes');
const entradasRoutes = require('./routes/entradas.routes');

const app = express();
app.use(express.json());

// Log de cada request: servicio, método, ruta, status y duración.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
});

app.use(healthRoutes);
app.use(ordenesRoutes);
app.use(entradasRoutes);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.use((req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// Manejo explícito de errores: los AppError conservan su código HTTP y, si existen, sus detalles.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    logger.warn('JSON inválido', { path: req.originalUrl });
    return res.status(400).json({ message: 'El cuerpo de la solicitud no es un JSON válido', code: 'JSON_INVALIDO' });
  }
  if (err.status) {
    logger.warn('error controlado', { path: req.originalUrl, status: err.status, code: err.code, message: err.message });
    return res.status(err.status).json({ message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
  }
  logger.error('error inesperado', { path: req.originalUrl, message: err.message });
  return res.status(500).json({ message: 'Error interno del servicio', code: 'ERROR_INTERNO' });
});

module.exports = app;
