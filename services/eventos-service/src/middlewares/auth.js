// TP7 - Punto 4: autenticación (401) y autorización por rol (403).
// MISMO código en los tres servicios (Hito 1, sección 1: los servicios no comparten paquetes).
// Copiar tal cual a: services/<servicio>/src/middlewares/auth.js
//
// Contrato (docs/tp7-hito1-seguridad.md, sección 9):
//   Header: Authorization: Bearer <token>   |   HS256 fijo   |   claims: sub, role, iat, exp, iss
//   Deja en el request:  req.auth = { sub, role }
const jwt = require('jsonwebtoken');
const { AppError } = require('../config/errors');

const ALGORITMOS = ['HS256']; // fijo al verificar; nunca se toma del header del token
const ROLES = ['USER', 'ADMIN'];
const SERVICIO_ENTRADAS = 'entradas-service';

// Se leen en cada request (no al cargar el módulo) para que los tests puedan fijar las variables antes.
const secreto = () => process.env.JWT_SECRET;
const emisor = () => process.env.JWT_ISSUER || 'usuarios-service';

function extraerToken(req) {
  const header = req.headers.authorization;
  if (!header) throw new AppError(401, 'Falta el token de autenticación', 'TOKEN_AUSENTE');
  const [esquema, token, ...resto] = header.trim().split(/\s+/);
  if (!/^bearer$/i.test(esquema) || !token || resto.length > 0) {
    throw new AppError(401, 'Token inválido', 'TOKEN_INVALIDO');
  }
  return token;
}

function verificar(token) {
  const clave = secreto();
  if (!clave) throw new Error('JWT_SECRET no configurado'); // error de configuración -> 500 genérico
  let payload;
  try {
    payload = jwt.verify(token, clave, { algorithms: ALGORITMOS, issuer: emisor() });
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') throw new AppError(401, 'Token vencido', 'TOKEN_VENCIDO');
    if (err && (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError')) {
      throw new AppError(401, 'Token inválido', 'TOKEN_INVALIDO');
    }
    throw err;
  }
  // jsonwebtoken no exige exp por sí mismo: se exige acá, igual que sub y role.
  const valido =
    payload && typeof payload === 'object' &&
    typeof payload.exp === 'number' &&
    typeof payload.sub === 'string' && payload.sub !== '' &&
    ROLES.includes(payload.role);
  if (!valido) throw new AppError(401, 'Token inválido', 'TOKEN_INVALIDO');
  return { sub: payload.sub, role: payload.role };
}

// 401 si no hay identidad válida.
function autenticar(req, res, next) {
  try {
    req.auth = verificar(extraerToken(req));
    next();
  } catch (err) {
    next(err);
  }
}

function autenticarEntradasService(req, res, next) {
  try {
    const token = extraerToken(req);
    const clave = process.env.EVENTOS_SERVICE_TOKEN_SECRET;
    if (!clave) throw new Error('EVENTOS_SERVICE_TOKEN_SECRET no configurado');
    if (clave.length < 32) throw new Error('EVENTOS_SERVICE_TOKEN_SECRET debe tener al menos 32 caracteres');
    if (clave === process.env.JWT_SECRET) {
      throw new Error('EVENTOS_SERVICE_TOKEN_SECRET debe ser distinto de JWT_SECRET');
    }

    let payload;
    try {
      payload = jwt.verify(token, clave, {
        algorithms: ALGORITMOS,
        issuer: SERVICIO_ENTRADAS,
        audience: 'eventos-service',
      });
    } catch (err) {
      if (err && err.name === 'TokenExpiredError') throw new AppError(401, 'Credencial de servicio vencida', 'TOKEN_SERVICIO_VENCIDO');
      if (err && (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError')) {
        throw new AppError(401, 'Credencial de servicio inválida', 'TOKEN_SERVICIO_INVALIDO');
      }
      throw err;
    }

    if (!payload || typeof payload !== 'object' ||
      typeof payload.exp !== 'number' ||
      payload.sub !== SERVICIO_ENTRADAS ||
      payload.service !== SERVICIO_ENTRADAS) {
      throw new AppError(401, 'Credencial de servicio inválida', 'TOKEN_SERVICIO_INVALIDO');
    }
    req.auth = { sub: SERVICIO_ENTRADAS, role: 'SERVICE' };
    next();
  } catch (err) {
    next(err);
  }
}

// 403 si la identidad es válida pero el rol no alcanza. Usar SIEMPRE después de `autenticar`.
const requerirRol = (...permitidos) => (req, res, next) => {
  if (!req.auth) return next(new AppError(401, 'Falta el token de autenticación', 'TOKEN_AUSENTE'));
  if (!permitidos.includes(req.auth.role)) {
    return next(new AppError(403, 'No tenés permisos para esta operación', 'PERMISOS_INSUFICIENTES'));
  }
  return next();
};

const esAdmin = (req) => req.auth && req.auth.role === 'ADMIN';

// Propiedad del recurso: ADMIN pasa siempre; USER solo si el id del recurso es su `sub`. Si no, lanza 403.
function exigirDuenoOAdmin(req, idDelDueno) {
  if (esAdmin(req)) return;
  if (!req.auth || String(idDelDueno) !== req.auth.sub) {
    throw new AppError(403, 'No tenés permisos sobre este recurso', 'PERMISOS_INSUFICIENTES');
  }
}

module.exports = { autenticar, autenticarEntradasService, requerirRol, esAdmin, exigirDuenoOAdmin, verificar };
