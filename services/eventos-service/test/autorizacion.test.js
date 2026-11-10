// TP7 (punto 4) - Autenticación (401) y autorización por rol (403) en eventos-service.
// Usa los mismos repositorios en memoria que api.test.js. Corre con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { firmar, vencido, adulterado, firmarServicio, bearer } = require('./helpers/token'); // fija secretos de prueba
const { armar, datosEvento } = require('./helpers/armar');

const ADMIN = firmar({ sub: 'admin1', role: 'ADMIN' });
const USER = firmar({ sub: 'u1', role: 'USER' });
const SERVICE = firmarServicio();
const ID_INEXISTENTE = 'a'.repeat(24);

// token: null = sin encabezado Authorization.
async function conServidor(fn) {
  const ctx = armar({});
  const server = ctx.app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (metodo, ruta, cuerpo, token) => {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token ? bearer(token) : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await res.text();
    return { status: res.status, body: texto ? JSON.parse(texto) : null };
  };
  try { await fn(http); } finally { server.close(); }
}

const GESTION = [
  ['POST', '/eventos', datosEvento()],
  ['PUT', `/eventos/${ID_INEXISTENTE}`, datosEvento()],
  ['PATCH', `/eventos/${ID_INEXISTENTE}/cancelar`],
  ['PATCH', `/eventos/${ID_INEXISTENTE}/finalizar`],
];
const INTERNOS = [
  ['POST', `/eventos/${ID_INEXISTENTE}/reservar-aforo`, { cantidad: 1, referencia: 'o1' }],
  ['POST', `/eventos/${ID_INEXISTENTE}/liberar-aforo`, { cantidad: 1, referencia: 'o1' }],
];

test('público: /health y la consulta de eventos no piden token', () =>
  conServidor(async (http) => {
    assert.equal((await http('GET', '/health')).status, 200);
    assert.equal((await http('GET', '/eventos')).status, 200);
    assert.equal((await http('GET', `/eventos/${ID_INEXISTENTE}`)).status, 404); // pasa la autenticación: llega al 404 de negocio
  }));

test('E: sin token -> 401 TOKEN_AUSENTE en gestión de eventos y en reservar/liberar aforo', () =>
  conServidor(async (http) => {
    for (const [m, p, b] of [...GESTION, ...INTERNOS]) {
      const r = await http(m, p, b);
      assert.equal(r.status, 401, `${m} ${p}`);
      assert.equal(r.body.code, 'TOKEN_AUSENTE');
    }
  }));

test('F: token modificado a mano -> 401 TOKEN_INVALIDO', () =>
  conServidor(async (http) => {
    const r = await http('POST', '/eventos', datosEvento(), adulterado());
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'TOKEN_INVALIDO');
  }));

test('token firmado con OTRA clave -> 401 TOKEN_INVALIDO', () =>
  conServidor(async (http) => {
    const otro = firmar({ role: 'ADMIN', secret: 'otra-clave-distinta-de-32-caracteres-o-mas' });
    const r = await http('POST', '/eventos', datosEvento(), otro);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'TOKEN_INVALIDO');
  }));

test('G: token vencido -> 401 TOKEN_VENCIDO', () =>
  conServidor(async (http) => {
    const r = await http('POST', '/eventos', datosEvento(), vencido({ role: 'ADMIN' }));
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'TOKEN_VENCIDO');
  }));

test('H: USER no puede gestionar eventos -> 403 PERMISOS_INSUFICIENTES', () =>
  conServidor(async (http) => {
    for (const [m, p, b] of GESTION) {
      const r = await http(m, p, b, USER);
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal(r.body.code, 'PERMISOS_INSUFICIENTES');
    }
  }));

test('solo la identidad técnica de entradas-service puede reservar y liberar aforo', () =>
  conServidor(async (http) => {
    const creado = await http('POST', '/eventos', datosEvento({ aforoTotal: 3 }), ADMIN);
    assert.equal(creado.status, 201);
    const id = creado.body.id;

    for (const token of [USER, ADMIN]) {
      const reservaRechazada = await http('POST', `/eventos/${id}/reservar-aforo`, { cantidad: 1, referencia: 'user-attempt' }, token);
      assert.equal(reservaRechazada.status, 401);
      assert.equal(reservaRechazada.body.code, 'TOKEN_SERVICIO_INVALIDO');
      const liberaRechazada = await http('POST', `/eventos/${id}/liberar-aforo`, { cantidad: 1, referencia: 'user-attempt' }, token);
      assert.equal(liberaRechazada.status, 401);
      assert.equal(liberaRechazada.body.code, 'TOKEN_SERVICIO_INVALIDO');
    }

    const reserva = await http('POST', `/eventos/${id}/reservar-aforo`, { cantidad: 2, referencia: 'o1' }, SERVICE);
    assert.equal(reserva.status, 200);
    const libera = await http('POST', `/eventos/${id}/liberar-aforo`, { cantidad: 2, referencia: 'o1' }, SERVICE);
    assert.equal(libera.status, 200);
  }));

test('credencial técnica de otro servicio se rechaza', () =>
  conServidor(async (http) => {
    const otroServicio = firmarServicio({ service: 'usuarios-service' });
    const r = await http('POST', `/eventos/${ID_INEXISTENTE}/reservar-aforo`, { cantidad: 1, referencia: 'o1' }, otroServicio);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'TOKEN_SERVICIO_INVALIDO');
  }));

test('JWT firmado con la clave de usuarios-service no suplanta la identidad técnica', () =>
  conServidor(async (http) => {
    const firmadoConClaveUsuario = firmarServicio({ secret: process.env.JWT_SECRET });
    const r = await http('POST', `/eventos/${ID_INEXISTENTE}/reservar-aforo`, { cantidad: 1, referencia: 'o1' }, firmadoConClaveUsuario);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'TOKEN_SERVICIO_INVALIDO');
  }));

test('credencial técnica vencida se rechaza', () =>
  conServidor(async (http) => {
    const vencida = firmarServicio({ expiresIn: -1 });
    const r = await http('POST', `/eventos/${ID_INEXISTENTE}/liberar-aforo`, { cantidad: 1, referencia: 'o1' }, vencida);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'TOKEN_SERVICIO_VENCIDO');
  }));
