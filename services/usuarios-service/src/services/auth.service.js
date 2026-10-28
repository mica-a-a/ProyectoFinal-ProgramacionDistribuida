// TP7 - Registro de usuarios con credenciales. usuarios-service es la ÚNICA autoridad sobre las contraseñas:
// ningún otro servicio ve el hash ni consulta esta base. También es el ÚNICO que emite tokens (login).
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const logger = require('../config/logger');
const { AppError } = require('../config/errors');
const Usuario = require('../models/Usuario');
const { validarPassword, validarLogin } = require('./validacion');
const tokenService = require('./token.service');
const { ejecutar, validarOFallar } = require('./usuarios.service');

// POST /auth/register
async function registrar(body) {
  // Valida los datos personales (400 con la lista de errores). Solo se leen los campos conocidos:
  // cualquier `role` o `activo` que mande el cliente se ignora.
  const data = validarOFallar(body);

  const errores = validarPassword(body.password);
  if (errores.length > 0) {
    logger.warn('registro rechazado: contraseña inválida'); // nunca se loguea la contraseña
    throw new AppError(400, 'Error de validación', 'VALIDACION', errores);
  }

  // bcrypt genera el salt y lo guarda dentro del propio hash ($2a$12$<salt><hash>).
  const passwordHash = await bcrypt.hash(body.password, config.bcryptRounds);

  // El rol lo fija el servidor: un auto-registro SIEMPRE crea un USER activo.
  // El email/DNI duplicado lo traduce `ejecutar` a 409 EMAIL_DUPLICADO / DNI_DUPLICADO.
  const usuario = await ejecutar('registrar', () => Usuario.create({ ...data, passwordHash, role: 'USER', activo: true }));
  logger.info('usuario registrado', { operacion: 'POST /auth/register', usuarioId: String(usuario._id), role: 'USER' });
  return usuario; // toJSON no incluye passwordHash
}

// Hash de relleno para comparar cuando el usuario no existe (o no tiene hash): así tarda lo mismo que un login
// real y no se puede distinguir "usuario inexistente" de "contraseña incorrecta" midiendo tiempos.
let hashRelleno;
function obtenerHashRelleno() {
  if (!hashRelleno) hashRelleno = bcrypt.hash('relleno-sin-uso-no-es-una-clave', config.bcryptRounds);
  return hashRelleno;
}

const credencialesInvalidas = () => new AppError(401, 'Credenciales inválidas', 'CREDENCIALES_INVALIDAS');

// POST /auth/login
// 400 datos inválidos | 401 usuario inexistente o contraseña incorrecta (mismo mensaje) | 403 cuenta deshabilitada
// (solo si la contraseña es correcta) | 200 { token, tokenType, expiresIn }.
async function login(body) {
  const { data, errors } = validarLogin(body);
  if (errors.length > 0) {
    logger.warn('login rechazado: datos inválidos');
    throw new AppError(400, 'Error de validación', 'VALIDACION', errors);
  }

  // El hash tiene select:false, hay que pedirlo explícitamente. Solo se usa acá dentro, nunca sale.
  const usuario = await ejecutar('login', () => Usuario.findOne({ email: data.email }).select('+passwordHash'));

  // Se compara SIEMPRE contra algún hash, exista o no el usuario.
  const hash = usuario && usuario.passwordHash ? usuario.passwordHash : await obtenerHashRelleno();
  const coincide = await bcrypt.compare(data.password, hash);

  if (!usuario || !usuario.passwordHash || !coincide) {
    // El motivo real queda solo en el log del servidor; al cliente se le responde siempre lo mismo.
    logger.warn('login fallido', { motivo: !usuario ? 'usuario_inexistente' : !usuario.passwordHash ? 'sin_credenciales' : 'password_incorrecta' });
    throw credencialesInvalidas();
  }

  // Política: cuenta deshabilitada -> 403, pero solo después de validar la contraseña. Quien no conoce las
  // credenciales recibe el 401 genérico y no puede averiguar si una cuenta existe o está dada de baja.
  if (usuario.activo === false) {
    logger.warn('login rechazado: cuenta deshabilitada', { usuarioId: String(usuario._id) });
    throw new AppError(403, 'La cuenta está deshabilitada', 'CUENTA_DESHABILITADA');
  }

  // El rol sale de la base de datos: el cuerpo del request nunca se consulta para esto.
  const { token, expiresIn } = tokenService.emitir({ id: usuario._id, role: usuario.role || 'USER' });
  logger.info('login exitoso', { usuarioId: String(usuario._id), role: usuario.role }); // nunca se loguea el token
  return { token, tokenType: 'Bearer', expiresIn };
}

module.exports = { registrar, login };
