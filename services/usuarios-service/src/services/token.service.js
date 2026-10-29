// TP7 - Emisión y verificación de JWT. Única autoridad de emisión: usuarios-service.
// Contrato (docs/tp7-hito1-seguridad.md, sección 9): HS256, claims sub / role / iat / exp / iss.
// El payload NO lleva contraseña, hash, secretos ni datos personales (ni siquiera el email).
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { AppError } = require('../config/errors');

// Algoritmo fijado explícitamente, al firmar y al verificar. Nunca se deriva del header del token.
const ALGORITMOS = [config.jwtAlgorithm];

function obtenerSecreto() {
  const secret = config.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET no configurado'); // error de configuración -> 500 genérico
  return secret;
}

// Emite un token para un usuario ya autenticado. `role` sale SIEMPRE de la base, nunca del request.
function emitir({ id, role }) {
  const segundos = config.jwtExpiresInSeconds;
  if (!segundos) throw new Error('JWT_EXPIRES_IN inválido'); // jamás se emite un token sin exp
  const token = jwt.sign({ role }, obtenerSecreto(), {
    algorithm: config.jwtAlgorithm,
    subject: String(id),         // claim sub
    issuer: config.jwtIssuer,    // claim iss
    expiresIn: segundos,         // claim exp (iat lo agrega la librería)
  });
  return { token, expiresIn: segundos };
}

// Verifica firma, algoritmo, emisor y vencimiento. Lanza AppError 401 (TOKEN_INVALIDO / TOKEN_VENCIDO).
// Devuelve { sub, role }.
function verificar(token) {
  let payload;
  try {
    payload = jwt.verify(token, obtenerSecreto(), {
      algorithms: ALGORITMOS, // rechaza alg:none, HS512, RS256, etc.
      issuer: config.jwtIssuer,
    });
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') throw new AppError(401, 'Token vencido', 'TOKEN_VENCIDO');
    if (err && (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError')) {
      throw new AppError(401, 'Token inválido', 'TOKEN_INVALIDO');
    }
    throw err; // fallo de configuración u otro error inesperado
  }

  // jsonwebtoken NO exige `exp` por sí mismo: un token firmado sin vencimiento pasaría la verificación.
  // Acá se exige explícitamente, igual que sub y role.
  const valido =
    payload &&
    typeof payload === 'object' &&
    typeof payload.exp === 'number' &&
    typeof payload.sub === 'string' && payload.sub !== '' &&
    (payload.role === 'USER' || payload.role === 'ADMIN');
  if (!valido) throw new AppError(401, 'Token inválido', 'TOKEN_INVALIDO');

  return { sub: payload.sub, role: payload.role };
}

module.exports = { emitir, verificar };
