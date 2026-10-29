const express = require('express');
const swaggerUi = require('swagger-ui-express');
const logger = require('./config/logger');
const openapi = require('./docs/openapi');
const { createHealthRoutes } = require('./routes/health.routes');
const { createEventosRoutes } = require('./routes/eventos.routes');

// TP7: cada request autenticado deja en el log QUIEN lo hizo (sub y rol del token ya validado). Nunca el token.
const identidadLog = (req) => (req.auth ? { sub: req.auth.sub, role: req.auth.role } : {});

const ERRORES_DE_INFRAESTRUCTURA = [
  'MongooseServerSelectionError', 'MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError',
];

function esErrorDeInfraestructura(err) {
  return ERRORES_DE_INFRAESTRUCTURA.includes(err.name) || /buffering timed out/i.test(err.message || '');
}

function createApp({ eventosController, healthController }) {
  const app = express();
  app.use(express.json());

  // Log de cada request: servicio, método, ruta, status y duración.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('request', { method: req.method, path: req.originalUrl, status: res.statusCode, ms: Date.now() - start, ...identidadLog(req) });
    });
    next();
  });

  app.use(createHealthRoutes(healthController));
  app.use(createEventosRoutes(eventosController));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));

  app.use((req, res) => {
    res.status(404).json({ message: 'Ruta no encontrada', code: 'RUTA_NO_ENCONTRADA' });
  });

  // Manejo explícito de errores: los AppError conservan su código HTTP; la caída de Mongo/Redis
  // se informa como 503 (dependencia no disponible) y no como un 500 genérico.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status) {
      logger.warn('error controlado', { path: req.originalUrl, status: err.status, code: err.code, message: err.message });
      const cuerpo = { message: err.message, code: err.code };
      if (err.detalles) cuerpo.errores = err.detalles;
      return res.status(err.status).json(cuerpo);
    }
    if (err.name === 'ValidationError' && err.errors) {
      return res.status(400).json({ message: 'Error de validación', code: 'VALIDACION', errores: Object.values(err.errors).map((e) => e.message) });
    }
    if (esErrorDeInfraestructura(err)) {
      logger.error('base de datos no disponible', { path: req.originalUrl, cause: err.name });
      return res.status(503).json({ message: 'Base de datos no disponible, intentá más tarde', code: 'DB_NO_DISPONIBLE' });
    }
    logger.error('error inesperado', { path: req.originalUrl, message: err.message });
    return res.status(500).json({ message: 'Error interno del servicio', code: 'ERROR_INTERNO' });
  });

  return app;
}

module.exports = { createApp };
