const { AppError } = require('../config/errors');

const ID_VALIDO = /^[0-9a-fA-F]{24}$/;

function validarId(id) {
  if (!ID_VALIDO.test(String(id))) {
    throw new AppError(400, 'ID de evento inválido', 'ID_INVALIDO');
  }
}

function fallar(errores) {
  const err = new AppError(400, 'Error de validación', 'VALIDACION');
  err.detalles = errores;
  throw err;
}

const esTexto = (v) => typeof v === 'string' && v.trim().length >= 2;
const esEntero = (v) => Number.isInteger(v);

// `estado` y `disponibles` los decide únicamente el servicio, nunca el cliente.
function rechazarCamposReservados(body, errores) {
  for (const campo of ['estado', 'disponibles', 'id']) {
    if (body[campo] !== undefined) errores.push(`"${campo}" no puede indicarse: lo administra el servicio`);
  }
}

function validarCampos(body, { requeridos }, ahora) {
  const errores = [];
  const limpio = {};
  rechazarCamposReservados(body, errores);

  const presente = (c) => body[c] !== undefined;
  const reglas = {
    nombre: () => esTexto(body.nombre) || 'nombre es obligatorio (mínimo 2 caracteres)',
    lugar: () => esTexto(body.lugar) || 'lugar es obligatorio (mínimo 2 caracteres)',
    precio: () => (typeof body.precio === 'number' && Number.isFinite(body.precio) && body.precio >= 0) || 'precio debe ser un número mayor o igual a 0',
    aforoTotal: () => (esEntero(body.aforoTotal) && body.aforoTotal >= 1) || 'aforoTotal debe ser un entero mayor o igual a 1',
    fecha: () => {
      const f = new Date(body.fecha);
      if (typeof body.fecha !== 'string' || Number.isNaN(f.getTime())) return 'fecha debe ser una fecha válida (ISO 8601)';
      if (f <= ahora) return 'fecha debe ser futura';
      return true;
    },
  };

  for (const campo of Object.keys(reglas)) {
    if (!presente(campo)) {
      if (requeridos) errores.push(`${campo} es obligatorio`);
      continue;
    }
    const resultado = reglas[campo]();
    if (resultado !== true) errores.push(resultado);
    else limpio[campo] = campo === 'fecha' ? new Date(body.fecha) : typeof body[campo] === 'string' ? body[campo].trim() : body[campo];
  }

  if (errores.length) fallar(errores);
  return limpio;
}

function validarCrear(body, ahora) {
  return validarCampos(body || {}, { requeridos: true }, ahora);
}

function validarActualizar(body, ahora) {
  const limpio = validarCampos(body || {}, { requeridos: false }, ahora);
  if (Object.keys(limpio).length === 0) fallar(['No se indicó ningún campo para modificar']);
  return limpio;
}

function validarMovimiento(body) {
  const errores = [];
  const { cantidad, referencia } = body || {};
  if (!esEntero(cantidad) || cantidad < 1) errores.push('cantidad debe ser un entero mayor o igual a 1');
  if (typeof referencia !== 'string' || referencia.trim() === '') errores.push('referencia es obligatoria');
  if (errores.length) fallar(errores);
  return { cantidad, referencia: referencia.trim() };
}

module.exports = { validarId, validarCrear, validarActualizar, validarMovimiento };
