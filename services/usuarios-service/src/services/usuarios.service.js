const Usuario = require('../models/Usuario');
const logger = require('../config/logger');
const { AppError } = require('../config/errors');
const { validarUsuario } = require('./validacion');

const ID_RE = /^[a-f\d]{24}$/i;

function validarId(id) {
  if (!ID_RE.test(String(id))) {
    throw new AppError(400, 'ID de usuario inválido', 'ID_INVALIDO');
  }
}

// Traduce errores de la base a errores de la aplicación, distinguiendo
// "dato duplicado" (409) de "base no disponible" (503) y de fallos propios (500).
function traducirError(err, operacion) {
  if (err instanceof AppError) return err;

  if (err && err.code === 11000) {
    const campo = Object.keys(err.keyPattern || err.keyValue || {})[0];
    if (campo === 'dni') return new AppError(409, 'El DNI ya está registrado', 'DNI_DUPLICADO');
    return new AppError(409, 'El email ya está registrado', 'EMAIL_DUPLICADO');
  }

  const nombre = err && err.name;
  const sinConexion =
    nombre === 'MongoServerSelectionError' ||
    nombre === 'MongoNetworkError' ||
    nombre === 'MongoNetworkTimeoutError' ||
    nombre === 'MongoNotConnectedError' ||
    (nombre === 'MongooseError' && /bufferCommands|before initial connection/i.test(err.message));
  if (sinConexion) {
    logger.error('base de datos no disponible', { operacion, cause: nombre });
    return new AppError(503, 'Base de datos no disponible', 'DB_NO_DISPONIBLE');
  }

  return err;
}

async function ejecutar(operacion, fn) {
  try {
    return await fn();
  } catch (err) {
    throw traducirError(err, operacion);
  }
}

function validarOFallar(body) {
  const { data, errors } = validarUsuario(body);
  if (errors.length > 0) {
    logger.warn('validación fallida', { errors });
    throw new AppError(400, 'Error de validación', 'VALIDACION', errors);
  }
  return data;
}

async function listar({ activo } = {}) {
  const filtro = {};
  if (activo === 'true') filtro.activo = true;
  if (activo === 'false') filtro.activo = false;
  return ejecutar('listar', () => Usuario.find(filtro).sort({ createdAt: 1 }));
}

async function obtener(id) {
  validarId(id);
  const usuario = await ejecutar('obtener', () => Usuario.findById(id));
  if (!usuario) throw new AppError(404, 'Usuario no encontrado', 'USUARIO_NO_ENCONTRADO');
  return usuario;
}

async function crear(body) {
  const data = validarOFallar(body);
  return ejecutar('crear', () => Usuario.create({ ...data, activo: true }));
}

async function actualizar(id, body) {
  validarId(id);
  const data = validarOFallar(body);
  const usuario = await ejecutar('actualizar', () =>
    Usuario.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
  );
  if (!usuario) throw new AppError(404, 'Usuario no encontrado', 'USUARIO_NO_ENCONTRADO');
  return usuario;
}

// Baja lógica: el usuario no se borra, queda activo=false. Así las entradas de otros servicios que guardan su `usuarioId` nunca apuntan a un usuario inexistente.
// Es idempotente: dar de baja a alguien ya dado de baja devuelve el mismo resultado.
async function darDeBaja(id) {
  validarId(id);
  const usuario = await ejecutar('baja', () =>
    Usuario.findByIdAndUpdate(id, { $set: { activo: false } }, { new: true })
  );
  if (!usuario) throw new AppError(404, 'Usuario no encontrado', 'USUARIO_NO_ENCONTRADO');
  return usuario;
}

module.exports = { listar, obtener, crear, actualizar, darDeBaja };
