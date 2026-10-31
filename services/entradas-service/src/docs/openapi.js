// Contrato OpenAPI de entradas-service. Debe coincidir con el comportamiento real del servicio.
const { aplicarSeguridad } = require('./seguridad');

const json = (schema, example) => ({ 'application/json': { schema, ...(example ? { example } : {}) } });
const err = (description, code, message) => ({
  description,
  content: json({ $ref: '#/components/schemas/Error' }, { message, code }),
});

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const idParam = {
  name: 'id', in: 'path', required: true,
  description: 'Id de la orden (24 caracteres hexadecimales)',
  schema: { type: 'string', example: '6718b3f2a1c4d5e6f7a8b9c0' },
};

const e503 = err('Dependencia o base de datos no disponible (la causa figura en `code`)', 'DEPENDENCIA_NO_DISPONIBLE', 'eventos-service no está disponible');

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'entradas-service',
    version: '1.0.0',
    description:
      'Órdenes de compra y tickets de uso único.\n\n' +
      '**Servicios que consume** (contratos en `docs/arquitectura.md`, sección 7): ' +
      '`usuarios-service` (`GET /usuarios/:id`) y `eventos-service` (`GET /eventos/:id`, ' +
      '`POST /eventos/:id/reservar-aforo`, `POST /eventos/:id/liberar-aforo`).\n\n' +
      '**Errores de dependencias:** `404` remoto = error funcional; `409` se propaga; `423` se reintenta y, si persiste, se informa; ' +
      'timeout, DNS, conexión rechazada o `5xx` = `503`; rechazo `4xx` inesperado = `502`.',
  },
  // URL relativa: "Try it out" le pega al mismo host y puerto desde donde se abrió Swagger (local o el puerto publicado por Docker).
  servers: [{ url: '/' }],
  tags: [
    { name: 'Órdenes', description: 'Compra, consulta y cancelación' },
    { name: 'Entradas', description: 'Tickets del usuario y validación en el ingreso' },
    { name: 'Salud' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Salud'],
        summary: 'Estado del servicio',
        responses: {
          200: {
            description: 'El servicio está activo',
            content: json({ type: 'object', properties: { service: { type: 'string' }, status: { type: 'string' } } }, { service: 'entradas-service', status: 'ok' }),
          },
        },
      },
    },
    '/ordenes': {
      post: {
        tags: ['Órdenes'],
        summary: 'Comprar entradas',
        description:
          'Crea la orden en `PENDIENTE`, verifica al usuario (usuarios-service), obtiene el precio del evento y aplica el máximo ' +
          'por usuario y evento. Luego pide a eventos-service reservar el aforo (idempotente por `referencia = id de la orden`) y, ' +
          'si lo confirma, emite los tickets y pasa la orden a `CONFIRMADA`.',
        requestBody: {
          required: true,
          content: json(ref('NuevaOrden'), { usuarioId: 'u1', eventoId: 'e1', cantidad: 2 }),
        },
        responses: {
          201: { description: 'Orden confirmada con sus tickets', content: json(ref('OrdenConTickets')) },
          400: err('Datos inválidos o JSON mal formado', 'DATOS_INVALIDOS', 'cantidad debe ser un entero mayor o igual a 1'),
          404: err('Usuario o evento inexistente (`USUARIO_NO_ENCONTRADO`, `EVENTO_NO_ENCONTRADO`)', 'USUARIO_NO_ENCONTRADO', 'Usuario no encontrado'),
          409: err('Conflicto de negocio: `USUARIO_INACTIVO`, `MAXIMO_ENTRADAS_EXCEDIDO`, `SIN_AFORO`', 'MAXIMO_ENTRADAS_EXCEDIDO', 'Máximo 4 entradas por usuario y evento (ya tiene 3)'),
          423: err('El evento está ocupado y no se pudo reservar tras los reintentos (la orden queda `RECHAZADA`)', 'EVENTO_OCUPADO', 'El evento está ocupado, intentá nuevamente'),
          502: err('Un servicio remoto rechazó el pedido o devolvió datos inválidos. Con `code: DEPENDENCIA_AUTENTICACION` el servicio remoto no aceptó el token propagado (problema de configuración, p. ej. JWT_SECRET distinto), no del cliente', 'DEPENDENCIA_RECHAZO', 'eventos-service rechazó el pedido (HTTP 400)'),
          503: {
            description:
              'Dependencia o base de datos no disponible. `DEPENDENCIA_NO_DISPONIBLE`/`DB_NO_DISPONIBLE`: la orden queda `RECHAZADA` (o no se crea). ' +
              '`ORDEN_PENDIENTE`: eventos-service no respondió al reservar el aforo, no se sabe si lo descontó; la orden queda `PENDIENTE` y su id viaja en `details.ordenId`.',
            content: json(ref('Error'), { message: 'eventos-service no respondió; la orden quedó PENDIENTE', code: 'ORDEN_PENDIENTE', details: { ordenId: '6718b3f2a1c4d5e6f7a8b9c0', estado: 'PENDIENTE' } }),
          },
        },
      },
    },
    '/ordenes/{id}': {
      get: {
        tags: ['Órdenes'],
        summary: 'Consultar una orden y sus tickets',
        parameters: [idParam],
        responses: {
          200: { description: 'Orden con sus tickets', content: json(ref('OrdenConTickets')) },
          400: err('Id con formato inválido', 'ID_INVALIDO', 'El id de la orden no es válido'),
          404: err('La orden no existe', 'ORDEN_NO_ENCONTRADA', 'Orden no encontrada'),
          503: err('Base de datos no disponible', 'DB_NO_DISPONIBLE', 'Base de datos no disponible'),
        },
      },
      delete: {
        tags: ['Órdenes'],
        summary: 'Cancelar una orden',
        description:
          'Solo para órdenes `CONFIRMADA`, sin tickets usados y hasta `PLAZO_CANCELACION_HORAS` antes del evento (la fecha la informa eventos-service). ' +
          'Anula los tickets y pide a eventos-service liberar el aforo (idempotente por `referencia`). Cancelar una orden ya cancelada devuelve 200.',
        parameters: [idParam],
        responses: {
          200: { description: 'Orden cancelada (con sus tickets `ANULADO`)', content: json(ref('OrdenConTickets')) },
          400: err('Id con formato inválido', 'ID_INVALIDO', 'El id de la orden no es válido'),
          404: err('La orden no existe', 'ORDEN_NO_ENCONTRADA', 'Orden no encontrada'),
          409: err('`ORDEN_NO_CANCELABLE`, `FUERA_DE_PLAZO` o `TICKETS_USADOS`', 'FUERA_DE_PLAZO', 'Solo se puede cancelar hasta 24 h antes del evento'),
          502: err('Respuesta remota inválida', 'RESPUESTA_REMOTA_INVALIDA', 'eventos-service devolvió un evento sin fecha válida'),
          503: { ...e503, description: 'eventos-service o la base no están disponibles: la orden sigue `CONFIRMADA` con sus tickets válidos (se puede reintentar)' },
        },
      },
    },
    '/entradas': {
      get: {
        tags: ['Entradas'],
        summary: 'Listar los tickets de un usuario',
        parameters: [{ name: 'usuarioId', in: 'query', required: true, description: 'Id del usuario (referencia a usuarios-service)', schema: { type: 'string', example: 'u1' } }],
        responses: {
          200: { description: 'Tickets del usuario (puede ser una lista vacía)', content: json({ type: 'array', items: ref('Entrada') }) },
          400: err('Falta usuarioId', 'DATOS_INVALIDOS', 'usuarioId es obligatorio'),
          503: err('Base de datos no disponible', 'DB_NO_DISPONIBLE', 'Base de datos no disponible'),
        },
      },
    },
    '/entradas/validar': {
      post: {
        tags: ['Entradas'],
        summary: 'Validar un ticket en el ingreso',
        description:
          'Consulta a eventos-service si el evento está vigente y marca el ticket como `USADO` con una actualización condicional ' +
          '`VALIDO → USADO`: si dos pedidos llegan a la vez con el mismo código, solo uno ingresa.',
        requestBody: { required: true, content: json({ type: 'object', required: ['codigo'], properties: { codigo: { type: 'string' } } }, { codigo: 'A1B2C3D4E5' }) },
        responses: {
          200: {
            description: 'Ingreso permitido',
            content: json({ type: 'object', properties: { mensaje: { type: 'string' }, ticket: ref('Entrada') } }, { mensaje: 'Ingreso permitido' }),
          },
          400: err('Falta el código', 'DATOS_INVALIDOS', 'Falta el código del ticket'),
          404: err('El ticket no existe', 'TICKET_NO_ENCONTRADO', 'Ticket inexistente'),
          409: err('El ticket ya fue usado o fue anulado', 'TICKET_NO_VALIDO', 'El ticket ya no es válido (estado: USADO)'),
          422: err('El evento no está vigente', 'EVENTO_NO_VIGENTE', 'El evento no está vigente'),
          503: { ...e503, description: 'eventos-service no responde: se rechaza el ingreso (decisión conservadora) y el ticket sigue `VALIDO`' },
        },
      },
    },
  },
  components: {
    schemas: {
      NuevaOrden: {
        type: 'object',
        required: ['usuarioId', 'eventoId', 'cantidad'],
        properties: {
          usuarioId: { type: 'string', description: 'Referencia lógica a un usuario de usuarios-service' },
          eventoId: { type: 'string', description: 'Referencia lógica a un evento de eventos-service' },
          cantidad: { type: 'integer', minimum: 1 },
        },
      },
      Orden: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6718b3f2a1c4d5e6f7a8b9c0' },
          usuarioId: { type: 'string' },
          eventoId: { type: 'string' },
          cantidad: { type: 'integer' },
          precioUnitario: { type: 'number', nullable: true, description: 'Precio congelado al comprar' },
          estado: { type: 'string', enum: ['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'RECHAZADA'] },
          motivoRechazo: { type: 'string', nullable: true },
          fechaCreacion: { type: 'string', format: 'date-time' },
          fechaActualizacion: { type: 'string', format: 'date-time' },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          codigo: { type: 'string', example: 'A1B2C3D4E5' },
          ordenId: { type: 'string' },
          estado: { type: 'string', enum: ['VALIDO', 'USADO', 'ANULADO'] },
          usadoEn: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      OrdenConTickets: {
        type: 'object',
        properties: { orden: ref('Orden'), tickets: { type: 'array', items: ref('Ticket') } },
      },
      Entrada: {
        type: 'object',
        description: 'Ticket con los datos de su orden (usuario y evento)',
        properties: {
          id: { type: 'string' },
          codigo: { type: 'string' },
          ordenId: { type: 'string' },
          usuarioId: { type: 'string' },
          eventoId: { type: 'string' },
          estado: { type: 'string', enum: ['VALIDO', 'USADO', 'ANULADO'] },
          usadoEn: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Error: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          code: { type: 'string' },
          details: { type: 'object', description: 'Datos adicionales (por ejemplo el id de una orden pendiente)' },
        },
      },
    },
  },
};

// TP7: esquema Bearer, endpoints protegidos con su rol y respuestas 401 y 403 (ver ./seguridad.js).
module.exports = aplicarSeguridad(spec, {
  'POST /ordenes': { acceso: 'Requiere un token válido. Un USER solo puede comprar para sí mismo (usuarioId = su sub); un ADMIN para cualquiera' },
  'GET /ordenes/{id}': { acceso: 'Requiere un token válido. Solo el dueño de la orden o un ADMIN' },
  'DELETE /ordenes/{id}': { acceso: 'Requiere un token válido. Solo el dueño de la orden o un ADMIN' },
  'GET /entradas': { acceso: 'Requiere un token válido. Un USER solo puede consultar su propio usuarioId; un ADMIN el de cualquiera' },
  'POST /entradas/validar': { acceso: 'Requiere rol ADMIN (personal de control de acceso)' },
}, "Autenticación (TP7): los endpoints marcados con 🔒 exigen `Authorization: Bearer <JWT>`. El token se obtiene con `POST /auth/login` de usuarios-service (puerto 3001) y se verifica acá por la firma, sin consultar a Usuarios. Un USER solo opera sobre sus propias órdenes y entradas; un ADMIN sobre todas. Entradas reenvía el token del cliente a usuarios-service y eventos-service.");
