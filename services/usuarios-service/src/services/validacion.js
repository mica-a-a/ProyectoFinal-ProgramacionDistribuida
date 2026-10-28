// Reglas de validación de los datos personales (autoridad: usuarios-service).
// Son funciones puras: no dependen de HTTP ni de la base, así se pueden probar solas.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DNI_RE = /^\d{7,8}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Devuelve un Date (UTC) si el string es una fecha real del calendario, o null.
// Rechaza, por ejemplo, 2024-02-31.
function parseFecha(valor) {
  if (typeof valor !== 'string' || !FECHA_RE.test(valor)) return null;
  const [y, m, d] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  const esReal =
    fecha.getUTCFullYear() === y && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
  return esReal ? fecha : null;
}

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : null;
}

// Valida el cuerpo de un alta o de un PUT. Devuelve { data, errors }.
// Solo se copian los campos permitidos: `id` y `activo` no se pueden setear desde el body.
function validarUsuario(body, hoy = new Date()) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { data: null, errors: ['El cuerpo debe ser un objeto JSON'] };
  }

  const data = {};

  const nombre = texto(body.nombre);
  if (!nombre) errors.push('El nombre es obligatorio');
  else if (nombre.length < 2) errors.push('El nombre debe tener al menos 2 caracteres');
  else if (nombre.length > 100) errors.push('El nombre no puede superar 100 caracteres');
  else data.nombre = nombre;

  const apellido = texto(body.apellido);
  if (!apellido) errors.push('El apellido es obligatorio');
  else if (apellido.length < 2) errors.push('El apellido debe tener al menos 2 caracteres');
  else if (apellido.length > 100) errors.push('El apellido no puede superar 100 caracteres');
  else data.apellido = apellido;

  const email = texto(body.email);
  if (!email) errors.push('El email es obligatorio');
  else if (!EMAIL_RE.test(email)) errors.push('El email no tiene un formato válido');
  else data.email = email.toLowerCase();

  const dniCrudo = typeof body.dni === 'number' ? String(body.dni) : texto(body.dni);
  if (!dniCrudo) errors.push('El DNI es obligatorio');
  else if (!DNI_RE.test(dniCrudo)) errors.push('El DNI debe tener 7 u 8 dígitos');
  else data.dni = dniCrudo;

  if (body.fechaNacimiento === undefined || body.fechaNacimiento === null || body.fechaNacimiento === '') {
    errors.push('La fecha de nacimiento es obligatoria');
  } else {
    const fecha = parseFecha(body.fechaNacimiento);
    if (!fecha) errors.push('La fecha de nacimiento debe ser una fecha válida con formato YYYY-MM-DD');
    else if (fecha > hoy) errors.push('La fecha de nacimiento no puede ser futura');
    else if (fecha.getUTCFullYear() < 1900) errors.push('La fecha de nacimiento no puede ser anterior a 1900');
    else data.fechaNacimiento = fecha;
  }

  if (body.direccion !== undefined && body.direccion !== null) {
    const direccion = texto(body.direccion);
    if (direccion === null) errors.push('La dirección debe ser texto');
    else if (direccion.length > 200) errors.push('La dirección no puede superar 200 caracteres');
    else data.direccion = direccion;
  }

  return { data, errors };
}

// ---- TP7: contraseña y rol -------------------------------------------------------------------
const ROLES = ['USER', 'ADMIN'];

// bcrypt solo usa los primeros 72 bytes: se rechaza lo que los supere para no truncar en silencio.
function validarPassword(password) {
  if (typeof password !== 'string' || password === '') return ['La contraseña es obligatoria'];
  const errors = [];
  if (password.length < 8) errors.push('La contraseña debe tener al menos 8 caracteres');
  if (Buffer.byteLength(password, 'utf8') > 72) errors.push('La contraseña no puede superar 72 bytes');
  return errors;
}

function validarRol(role) {
  return ROLES.includes(role) ? [] : [`El rol debe ser uno de: ${ROLES.join(', ')}`];
}

module.exports = { validarUsuario, parseFecha, validarPassword, validarRol, ROLES };
