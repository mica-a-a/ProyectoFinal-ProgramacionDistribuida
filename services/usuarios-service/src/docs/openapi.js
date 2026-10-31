const { aplicarSeguridad } = require('./seguridad');
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

const spec = {
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
    { name: 'Autenticación', description: 'Registro, login y emisión de JWT (HS256). Endpoints públicos' },
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
    '/auth/register': {
      post: {
        tags: ['Autenticación'],
        summary: 'Registrarse (auto-registro, siempre crea un USER)',
        description:
          'Endpoint público. Valida los datos, impide email y DNI duplicados, guarda la contraseña como hash bcrypt ' +
          '(el salt lo maneja la biblioteca) y devuelve el usuario SIN contraseña ni hash. El rol lo fija el servidor: ' +
          'un `role` enviado en el cuerpo se ignora, así que nadie puede registrarse como ADMIN. Un ADMIN se crea por seed ' +
          'o con `POST /usuarios` (solo ADMIN).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RegistroEntrada' } } },
        },
        responses: {
          201: usuarioOk('Usuario registrado (rol USER, activo)'),
          400: errorValidacion,
          409: duplicado,
          503: dbNoDisponible,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión y obtener un JWT',
        description:
          'Valida email y contraseña contra el hash guardado y, solo si son correctos, emite un JWT firmado con HS256 ' +
          'con los claims `sub` (id del usuario), `role` (tomado de la base, nunca del request), `iat`, `exp` e `iss`. ' +
          'El token no contiene contraseña, hash ni datos personales. El vencimiento se configura con `JWT_EXPIRES_IN` ' +
          '(default 1 h). Usuario inexistente y contraseña incorrecta devuelven el MISMO 401. Una cuenta deshabilitada ' +
          'devuelve 403 solo si la contraseña es correcta. Usar el token como `Authorization: Bearer <token>`.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginEntrada' } } },
        },
        responses: {
          200: {
            description: 'Credenciales válidas',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRespuesta' } } },
          },
          400: errorValidacion,
          401: error('Usuario inexistente o contraseña incorrecta (no se revela cuál)', {
            message: 'Credenciales inválidas',
            code: 'CREDENCIALES_INVALIDAS',
          }),
          403: error('Cuenta deshabilitada (la contraseña era correcta)', {
            message: 'La cuenta está deshabilitada',
            code: 'CUENTA_DESHABILITADA',
          }),
          503: dbNoDisponible,
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
        summary: 'Alta administrada de un usuario (queda activo)',
        description: 'Solo ADMIN. Permite elegir el rol, y es el camino para crear otro ADMIN. La contraseña se guarda como hash bcrypt.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UsuarioAdminEntrada' } } },
        },
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
          role: { type: 'string', enum: ['USER', 'ADMIN'], example: 'USER', description: 'Rol de autorización. Nunca se devuelve la contraseña ni su hash' },
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
      RegistroEntrada: {
        allOf: [
          { $ref: '#/components/schemas/UsuarioEntrada' },
          {
            type: 'object',
            required: ['password'],
            properties: {
              password: { type: 'string', format: 'password', minLength: 8, maxLength: 72, description: 'Entre 8 caracteres y 72 bytes (límite de bcrypt). Nunca se guarda ni se devuelve' },
            },
          },
        ],
      },
      UsuarioAdminEntrada: {
        allOf: [
          { $ref: '#/components/schemas/RegistroEntrada' },
          {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['USER', 'ADMIN'], default: 'USER', description: 'Solo un ADMIN puede elegir el rol al dar de alta' },
            },
          },
        ],
      },
      LoginEntrada: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'lucia.fernandez@example.com' },
          password: { type: 'string', format: 'password', maxLength: 72, description: 'Máximo 72 bytes (límite de bcrypt)' },
        },
      },
      LoginRespuesta: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'JWT HS256 con claims sub, role, iat, exp e iss' },
          tokenType: { type: 'string', example: 'Bearer' },
          expiresIn: { type: 'integer', example: 3600, description: 'Segundos de vida del token (JWT_EXPIRES_IN)' },
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

// TP7: esquema Bearer, endpoints protegidos con su rol y respuestas 401 y 403 (ver ./seguridad.js).
module.exports = aplicarSeguridad(spec, {
  'GET /usuarios': { acceso: 'Requiere rol ADMIN' },
  'POST /usuarios': { acceso: 'Requiere rol ADMIN (alta administrada)' },
  'GET /usuarios/{id}': { acceso: 'Requiere un token válido. Un USER solo puede ver su propio perfil (id = su sub); un ADMIN el de cualquiera' },
  'PUT /usuarios/{id}': { acceso: 'Requiere un token válido. Un USER solo puede modificar su propio perfil y no puede cambiar role ni activo; un ADMIN el de cualquiera' },
  'DELETE /usuarios/{id}': { acceso: 'Requiere rol ADMIN' },
}, "Autenticación (TP7): este servicio es la ÚNICA autoridad sobre las credenciales y el ÚNICO que emite tokens. Flujo: 1) `POST /auth/register` (o el seed) 2) `POST /auth/login` devuelve el JWT 3) botón **Authorize** y pegar el token 4) los endpoints marcados con 🔒 ya se pueden probar. `/auth/register`, `/auth/login`, `/health` y `/api-docs` son públicos. El mismo token sirve en eventos-service y entradas-service.");
