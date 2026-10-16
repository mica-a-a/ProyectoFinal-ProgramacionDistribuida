// Contrato OpenAPI de usuarios-service.
// Cada endpoint que se implemente se agrega acá (debe coincidir con el comportamiento real).
const config = require('../config/config');

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'usuarios-service',
    version: '1.0.0',
    description: 'Identidad y datos personales de las personas registradas.',
  },
  servers: [{ url: `http://localhost:${config.port}` }],
  paths: {
    '/health': {
      get: {
        summary: 'Estado del servicio',
        responses: {
          200: {
            description: 'El servicio está activo',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    service: { type: 'string', example: 'usuarios-service' },
                    status: { type: 'string', example: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
