// Contrato OpenAPI de eventos-service. Debe coincidir con el comportamiento real.
const config = require('../config/config');

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', example: '66f1a2b3c4d5e6f708091a2b' }, description: 'ID del evento (24 caracteres hexadecimales)' };

const error = (descripcion, code) => ({
  description: descripcion,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { message: descripcion, code } } },
});

const evento = (descripcion) => ({
  description: descripcion,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Evento' } } },
});

const cuerpoMovimiento = {
  required: true,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Movimiento' } } },
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'eventos-service',
    version: '1.0.0',
    description:
      'Eventos y control de aforo. Es la única autoridad sobre cuántos lugares quedan: ' +
      'la reserva y la liberación se hacen con exclusión mutua por evento (lock en Redis) y son idempotentes por `referencia`.',
  },
  servers: [{ url: `http://localhost:${config.port}` }],
  tags: [
    { name: 'Eventos', description: 'Gestión de eventos (uso del cliente)' },
    { name: 'Aforo (interno)', description: 'Operaciones que invoca entradas-service' },
    { name: 'Salud', description: 'Estado del servicio' },
  ],
  paths: {
    '/eventos': {
      get: {
        tags: ['Eventos'], summary: 'Listar eventos',
        parameters: [{ name: 'estado', in: 'query', required: false, schema: { type: 'string', enum: ['PUBLICADO', 'AGOTADO', 'CANCELADO', 'FINALIZADO'] } }],
        responses: {
          200: { description: 'Lista de eventos ordenada por fecha', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Evento' } } } } },
          400: error('estado inválido', 'VALIDACION'),
          503: error('Base de datos no disponible, intentá más tarde', 'DB_NO_DISPONIBLE'),
        },
      },
      post: {
        tags: ['Eventos'], summary: 'Crear un evento (queda PUBLICADO con todo el aforo disponible)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EventoEntrada' } } } },
        responses: { 201: evento('Evento creado'), 400: error('Error de validación', 'VALIDACION') },
      },
    },
    '/eventos/{id}': {
      get: {
        tags: ['Eventos'], summary: 'Consultar un evento (incluye `vigente` y `vendible`)', parameters: [idParam],
        responses: { 200: evento('El evento'), 400: error('ID de evento inválido', 'ID_INVALIDO'), 404: error('Evento no encontrado', 'EVENTO_NO_ENCONTRADO') },
      },
      put: {
        tags: ['Eventos'], summary: 'Modificar un evento. No admite `estado` ni `disponibles`.', parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EventoEntrada' } } } },
        responses: {
          200: evento('Evento modificado'),
          400: error('Error de validación', 'VALIDACION'),
          404: error('Evento no encontrado', 'EVENTO_NO_ENCONTRADO'),
          409: error('Evento no modificable o aforo menor a lo ya vendido', 'AFORO_MENOR_A_VENDIDO'),
          423: error('El evento está siendo modificado, intentá nuevamente', 'LOCK_OCUPADO'),
        },
      },
    },
    '/eventos/{id}/cancelar': {
      patch: {
        tags: ['Eventos'], summary: 'Cancelar un evento (idempotente)', parameters: [idParam],
        responses: {
          200: evento('Evento cancelado'),
          404: error('Evento no encontrado', 'EVENTO_NO_ENCONTRADO'),
          409: error('No se puede cancelar un evento FINALIZADO', 'TRANSICION_INVALIDA'),
          423: error('El evento está siendo modificado, intentá nuevamente', 'LOCK_OCUPADO'),
        },
      },
    },
    '/eventos/{id}/finalizar': {
      patch: {
        tags: ['Eventos'], summary: 'Marcar un evento como FINALIZADO (idempotente, solo si ya ocurrió)', parameters: [idParam],
        responses: {
          200: evento('Evento finalizado'),
          404: error('Evento no encontrado', 'EVENTO_NO_ENCONTRADO'),
          409: error('Transición inválida', 'TRANSICION_INVALIDA'),
          423: error('El evento está siendo modificado, intentá nuevamente', 'LOCK_OCUPADO'),
        },
      },
    },
    '/eventos/{id}/reservar-aforo': {
      post: {
        tags: ['Aforo (interno)'], summary: 'Reservar lugares (interno, lo invoca entradas-service)', parameters: [idParam],
        description: 'Idempotente por `referencia`: repetir el pedido con la misma referencia no vuelve a descontar.',
        requestBody: cuerpoMovimiento,
        responses: {
          200: { description: 'Aforo reservado', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResultadoReserva' } } } },
          400: error('Error de validación', 'VALIDACION'),
          404: error('Evento no encontrado', 'EVENTO_NO_ENCONTRADO'),
          409: error('Sin aforo, evento no vendible o referencia conflictiva', 'SIN_AFORO'),
          423: error('El evento está siendo modificado, intentá nuevamente', 'LOCK_OCUPADO'),
          503: error('Coordinador de locks no disponible, intentá más tarde', 'REDIS_NO_DISPONIBLE'),
        },
      },
    },
    '/eventos/{id}/liberar-aforo': {
      post: {
        tags: ['Aforo (interno)'], summary: 'Liberar lugares (interno, lo invoca entradas-service)', parameters: [idParam],
        description: 'Idempotente por `referencia`. Si esa referencia nunca reservó, responde 200 con `liberado: false` y no suma nada.',
        requestBody: cuerpoMovimiento,
        responses: {
          200: { description: 'Aforo liberado (o sin cambios)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResultadoLiberacion' } } } },
          400: error('Error de validación', 'VALIDACION'),
          404: error('Evento no encontrado', 'EVENTO_NO_ENCONTRADO'),
          409: error('Cantidad inconsistente con la reserva', 'CANTIDAD_INCONSISTENTE'),
          423: error('El evento está siendo modificado, intentá nuevamente', 'LOCK_OCUPADO'),
          503: error('Coordinador de locks no disponible, intentá más tarde', 'REDIS_NO_DISPONIBLE'),
        },
      },
    },
    '/health': {
      get: {
        tags: ['Salud'], summary: 'El proceso está activo',
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { service: 'eventos-service', status: 'ok' } } } } },
      },
    },
    '/ready': {
      get: {
        tags: ['Salud'], summary: 'Estado de las dependencias propias (MongoDB y Redis)',
        responses: {
          200: { description: 'Listo', content: { 'application/json': { example: { service: 'eventos-service', status: 'ready', dependencies: { mongodb: 'up', redis: 'up' } } } } },
          503: { description: 'Alguna dependencia no está disponible', content: { 'application/json': { example: { service: 'eventos-service', status: 'degraded', dependencies: { mongodb: 'up', redis: 'down' } } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      EventoEntrada: {
        type: 'object',
        required: ['nombre', 'fecha', 'lugar', 'precio', 'aforoTotal'],
        properties: {
          nombre: { type: 'string', example: 'Taller de Node.js' },
          fecha: { type: 'string', format: 'date-time', example: '2027-03-15T19:00:00.000Z', description: 'Debe ser futura' },
          lugar: { type: 'string', example: 'Aula Magna UCH' },
          precio: { type: 'number', minimum: 0, example: 5000 },
          aforoTotal: { type: 'integer', minimum: 1, example: 50 },
        },
      },
      Evento: {
        type: 'object',
        properties: {
          id: { type: 'string' }, nombre: { type: 'string' }, fecha: { type: 'string', format: 'date-time' },
          lugar: { type: 'string' }, precio: { type: 'number' }, aforoTotal: { type: 'integer' },
          disponibles: { type: 'integer', description: '0 <= disponibles <= aforoTotal' },
          estado: { type: 'string', enum: ['PUBLICADO', 'AGOTADO', 'CANCELADO', 'FINALIZADO'] },
          vigente: { type: 'boolean', description: 'No está cancelado ni finalizado (válido para el ingreso)' },
          vendible: { type: 'boolean', description: 'Está PUBLICADO y es futuro: se puede reservar aforo' },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Movimiento: {
        type: 'object', required: ['cantidad', 'referencia'],
        properties: {
          cantidad: { type: 'integer', minimum: 1, example: 2 },
          referencia: { type: 'string', example: 'orden-123', description: 'Clave de idempotencia (el ordenId de entradas-service)' },
        },
      },
      ResultadoReserva: {
        type: 'object',
        properties: { reservado: { type: 'boolean', example: true }, disponibles: { type: 'integer', example: 48 }, idempotente: { type: 'boolean', example: false } },
      },
      ResultadoLiberacion: {
        type: 'object',
        properties: {
          liberado: { type: 'boolean', example: true }, disponibles: { type: 'integer', example: 50 },
          idempotente: { type: 'boolean', example: false }, motivo: { type: 'string', example: 'SIN_RESERVA' },
        },
      },
      Error: { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' }, errores: { type: 'array', items: { type: 'string' } } } },
    },
  },
};
