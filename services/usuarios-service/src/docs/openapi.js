// Contrato OpenAPI de usuarios-service. Debe coincidir con el comportamiento real.
const idParam = {
  in: 'path',
  name: 'id',
  required: true,
  schema: { type: 'string', example: '64b000000000000000000001' },
  description: 'ID del usuario (24 caracteres hexadecimales)',
};

const error = (description, example) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example } },
});

const errorValidacion = {
  description: 'Error de validación o ID inválido',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example: { message: 'Error de validación', code: 'VALIDACION', errors: ['El email no tiene un formato válido'] },
    },
  },
};

const noEncontrado = error('Usuario no encontrado', { message: 'Usuario no encontrado', code: 'USUARIO_NO_ENCONTRADO' });
const dbNoDisponible = error('La base de datos del servicio no está disponible', {
  message: 'Base de datos no disponible',
  code: 'DB_NO_DISPONIBLE',
});
const duplicado = error('Email o DNI ya registrados', { message: 'El email ya está registrado', code: 'EMAIL_DUPLICADO' });

const usuarioOk = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Usuario' } } },
});

const cuerpoUsuario = {
  required: true,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/UsuarioEntrada' } } },
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'usuarios-service',
    version: '1.0.0',
    description:
      'Identidad y datos personales de las personas registradas. ' +
      'Es la única autoridad sobre el perfil y el estado activo/inactivo de un usuario. ' +
      'entradas-service consulta `GET /usuarios/{id}` y usa solo `id` y `activo`.',
  },
  // URL relativa: Swagger UI le pega al mismo host y puerto desde donde se abrió
  // (local :3001 o el puerto publicado por Docker Compose).
  servers: [{ url: '/' }],
  tags: [
    { name: 'Usuarios', description: 'CRUD de usuarios con baja lógica' },
    { name: 'Salud', description: 'Estado del servicio' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Salud'],
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
    '/usuarios': {
      get: {
        tags: ['Usuarios'],
        summary: 'Listar usuarios',
        parameters: [
          {
            in: 'query',
            name: 'activo',
            required: false,
            schema: { type: 'string', enum: ['true', 'false'] },
            description: 'Filtra por estado. Sin este parámetro devuelve todos.',
          },
        ],
        responses: {
          200: {
            description: 'Lista de usuarios',
            content: {
              'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Usuario' } } },
            },
          },
          503: dbNoDisponible,
        },
      },
      post: {
        tags: ['Usuarios'],
        summary: 'Crear un usuario (queda activo)',
        requestBody: cuerpoUsuario,
        responses: { 201: usuarioOk('Usuario creado'), 400: errorValidacion, 409: duplicado, 503: dbNoDisponible },
      },
    },
    '/usuarios/{id}': {
      get: {
        tags: ['Usuarios'],
        summary: 'Obtener un usuario por ID',
        description: 'Contrato que consume entradas-service: se usan `id` y `activo`.',
        parameters: [idParam],
        responses: { 200: usuarioOk('Usuario encontrado'), 400: errorValidacion, 404: noEncontrado, 503: dbNoDisponible },
      },
      put: {
        tags: ['Usuarios'],
        summary: 'Modificar los datos de un usuario',
        description: 'Reemplaza los datos personales (todos los campos obligatorios). No modifica `activo`: la baja se hace con DELETE.',
        parameters: [idParam],
        requestBody: cuerpoUsuario,
        responses: {
          200: usuarioOk('Usuario actualizado'),
          400: errorValidacion,
          404: noEncontrado,
          409: duplicado,
          503: dbNoDisponible,
        },
      },
      delete: {
        tags: ['Usuarios'],
        summary: 'Dar de baja un usuario (baja lógica)',
        description: 'No borra el documento: marca `activo = false`. Es idempotente.',
        parameters: [idParam],
        responses: {
          200: usuarioOk('Usuario dado de baja (activo = false)'),
          400: errorValidacion,
          404: noEncontrado,
          503: dbNoDisponible,
        },
      },
    },
  },
  components: {
    schemas: {
      Usuario: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '64b000000000000000000001' },
          nombre: { type: 'string', example: 'Lucía' },
          apellido: { type: 'string', example: 'Fernández' },
          email: { type: 'string', format: 'email', example: 'lucia.fernandez@example.com' },
          dni: { type: 'string', example: '30123456' },
          fechaNacimiento: { type: 'string', example: '1990-05-14', description: 'Formato YYYY-MM-DD' },
          edad: { type: 'integer', example: 36, description: 'Calculada a partir de fechaNacimiento (no se guarda)' },
          direccion: { type: 'string', example: 'San Martín 123, Mendoza' },
          activo: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      UsuarioEntrada: {
        type: 'object',
        required: ['nombre', 'apellido', 'email', 'dni', 'fechaNacimiento'],
        properties: {
          nombre: { type: 'string', minLength: 2, example: 'Lucía' },
          apellido: { type: 'string', minLength: 2, example: 'Fernández' },
          email: { type: 'string', format: 'email', example: 'lucia.fernandez@example.com' },
          dni: { type: 'string', pattern: '^\\d{7,8}$', example: '30123456' },
          fechaNacimiento: { type: 'string', example: '1990-05-14', description: 'YYYY-MM-DD, fecha real y no futura' },
          direccion: { type: 'string', maxLength: 200, example: 'San Martín 123, Mendoza' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          code: { type: 'string' },
          errors: { type: 'array', items: { type: 'string' }, description: 'Solo en errores de validación' },
        },
      },
    },
  },
};
