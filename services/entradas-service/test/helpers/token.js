// TP7 - Helper de tests: firma tokens de prueba con el mismo contrato que usuarios-service
// (HS256, claims sub / role / iat / exp / iss). Mismo archivo en los tres servicios.
// Fija JWT_SECRET (solo para tests) al cargarse, así que hay que requerirlo ANTES de cargar la app.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-de-al-menos-32-caracteres!!';
process.env.EVENTOS_SERVICE_TOKEN_SECRET = process.env.EVENTOS_SERVICE_TOKEN_SECRET || 'secreto-interno-de-prueba-de-32-caracteres!!';
const jwt = require('jsonwebtoken');

const ID_DEFAULT = '64b000000000000000000001';
const ISSUER = 'usuarios-service';

// Token válido (vence en `expiresIn` segundos).
function firmar({ sub = ID_DEFAULT, role = 'USER', expiresIn = 3600, secret = process.env.JWT_SECRET, algorithm = 'HS256' } = {}) {
  return jwt.sign({ role }, secret, { algorithm, subject: String(sub), issuer: ISSUER, expiresIn });
}

// Token con firma correcta pero `exp` en el pasado (escenario G).
function vencido({ sub = ID_DEFAULT, role = 'USER' } = {}) {
  const exp = Math.floor(Date.now() / 1000) - 10;
  return jwt.sign({ role, exp }, process.env.JWT_SECRET, { algorithm: 'HS256', subject: String(sub), issuer: ISSUER });
}

// Token con el payload cambiado a mano (USER -> ADMIN) y la firma original (escenario F).
function adulterado({ sub = ID_DEFAULT } = {}) {
  const [h, p, f] = firmar({ sub, role: 'USER' }).split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  payload.role = 'ADMIN';
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${f}`;
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { firmar, vencido, adulterado, bearer, ID_DEFAULT };
