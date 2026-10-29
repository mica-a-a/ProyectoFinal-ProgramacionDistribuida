require('dotenv').config();

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

// Convierte JWT_EXPIRES_IN ("1h", "30m", "2d", "900s" o "900" = segundos) a segundos enteros.
// Se hace acá (y no se le pasa el string a la librería) para que el `exp` SIEMPRE exista y sea un número:
// un valor inválido o <= 0 hace fallar el arranque en lugar de emitir tokens sin vencimiento o ya vencidos.
const UNIDADES = { s: 1, m: 60, h: 3600, d: 86400 };
function parseExpiracion(valor) {
  const m = /^(\d+)\s*([smhd])?$/i.exec(String(valor).trim());
  if (!m) return null;
  const segundos = parseInt(m[1], 10) * UNIDADES[(m[2] || 's').toLowerCase()];
  return segundos > 0 ? segundos : null;
}

const JWT_SECRET_MIN_LENGTH = 32;

const config = {
  serviceName: process.env.SERVICE_NAME || 'usuarios-service',
  port: int(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  mongodbUri: process.env.MONGODB_URI,
  // Cada cuánto se reintenta la conexión a Mongo si todavía no está lista.
  mongodbRetryMs: int(process.env.MONGODB_RETRY_MS, 3000),
  // Cuánto espera el driver para encontrar el servidor antes de fallar (falla rápido).
  mongodbTimeoutMs: int(process.env.MONGODB_TIMEOUT_MS, 3000),

  // TP7: costo de bcrypt (2^N iteraciones). 12 es razonable hoy; en los tests se baja para que corran rápido.
  // Es un getter para que los tests puedan fijar BCRYPT_ROUNDS antes de usarlo.
  get bcryptRounds() { return int(process.env.BCRYPT_ROUNDS, 12); },

  // TP7 - JWT. Son getters para que los tests puedan fijar las variables antes de usarlas.
  // El algoritmo NO es configurable a propósito: está fijo en HS256 (ver docs/tp7-hito1-seguridad.md, sección 9)
  // y se usa tanto al firmar como al verificar.
  jwtAlgorithm: 'HS256',
  get jwtSecret() { return process.env.JWT_SECRET; },
  get jwtIssuer() { return process.env.JWT_ISSUER || 'usuarios-service'; },
  // Vencimiento en segundos. Default: 1 hora. Si la variable existe pero es inválida devuelve null (assertJwtConfig lo detecta).
  get jwtExpiresInSeconds() {
    const crudo = process.env.JWT_EXPIRES_IN;
    return crudo === undefined || crudo === '' ? 3600 : parseExpiracion(crudo);
  },
};

// Falla rápido al arrancar si la configuración JWT no es segura. Se llama desde server.js.
config.assertJwtConfig = function assertJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`JWT_SECRET es obligatorio y debe tener al menos ${JWT_SECRET_MIN_LENGTH} caracteres`);
  }
  if (config.jwtExpiresInSeconds === null) {
    throw new Error('JWT_EXPIRES_IN inválido: usá un entero positivo con unidad opcional (ej. 900, 15m, 1h, 2d)');
  }
};

module.exports = config;
