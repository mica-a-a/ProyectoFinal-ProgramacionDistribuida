// TP7 - Registro de usuarios con credenciales. usuarios-service es la ÚNICA autoridad sobre las contraseñas:
// ningún otro servicio ve el hash ni consulta esta base. (El login y el JWT se agregan en el punto 3.)
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const logger = require('../config/logger');
const { AppError } = require('../config/errors');
const Usuario = require('../models/Usuario');
const { validarPassword } = require('./validacion');
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

module.exports = { registrar };
