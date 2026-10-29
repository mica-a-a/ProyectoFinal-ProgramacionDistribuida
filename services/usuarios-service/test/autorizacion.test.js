// TP7 (punto 4) - Autenticación (401), autorización por rol (403) y propiedad del recurso en usuarios-service.
// No necesita MongoDB: el modelo se reemplaza por stubs, igual que en api.test.js. Corre con `npm test`.
const test = require('node:test');
const assert = require('node:assert');
process.env.LOG_LEVEL = 'error';
const { firmar, vencido, adulterado, bearer } = require('./helpers/token'); // fija JWT_SECRET de prueba; va ANTES de la app

const db = require('../src/config/db');
const Usuario = require('../src/models/Usuario');
const app = require('../src/app');

const ID_A = '64b000000000000000000001';
const ID_B = '64b000000000000000000002';
const doc = (id) => new Usuario({
  _id: id, nombre: 'Ana', apellido: 'Pérez', email: `${id}@example.com`, dni: '33444555',
  fechaNacimiento: new Date('1995-04-12'), activo: true,
});

let server; let base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  db.isConnected = () => true;
  Usuario.findById = async (id) => doc(id);
  Usuario.find = () => ({ sort: async () => [doc(ID_A), doc(ID_B)] });
  Usuario.findByIdAndUpdate = async (id) => doc(id);
});
test.after(() => server.close());

// token: null = sin encabezado Authorization.
const call = (method, path, token, json) => fetch(base + path, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? bearer(token) : {}) },
  body: json === undefined ? undefined : JSON.stringify(json),
});
const verifica = async (res, status, code) => {
  assert.strictEqual(res.status, status);
  assert.strictEqual((await res.json()).code, code);
};

const PROTEGIDOS = [
  ['GET', '/usuarios'], ['POST', '/usuarios', {}], ['GET', `/usuarios/${ID_A}`],
  ['PUT', `/usuarios/${ID_A}`, {}], ['DELETE', `/usuarios/${ID_A}`],
];

test('/health sigue siendo público (sin token)', async () => {
  assert.strictEqual((await call('GET', '/health', null)).status, 200);
});

test('E: sin token -> 401 TOKEN_AUSENTE en todos los endpoints de /usuarios', async () => {
  for (const [m, p, b] of PROTEGIDOS) await verifica(await call(m, p, null, b), 401, 'TOKEN_AUSENTE');
});

test('encabezado mal formado (sin Bearer, sin token, token basura) -> 401 TOKEN_INVALIDO', async () => {
  for (const header of ['Token abc', 'Bearer', 'Bearer a.b.c', 'abc']) {
    const res = await fetch(`${base}/usuarios`, { headers: { Authorization: header } });
    await verifica(res, 401, 'TOKEN_INVALIDO');
  }
});

test('F: token modificado a mano (firma inválida) -> 401 TOKEN_INVALIDO', async () => {
  await verifica(await call('GET', '/usuarios', adulterado()), 401, 'TOKEN_INVALIDO');
});

test('token firmado con OTRA clave -> 401 TOKEN_INVALIDO', async () => {
  const otro = firmar({ role: 'ADMIN', secret: 'otra-clave-distinta-de-32-caracteres-o-mas' });
  await verifica(await call('GET', '/usuarios', otro), 401, 'TOKEN_INVALIDO');
});

test('G: token vencido -> 401 TOKEN_VENCIDO', async () => {
  await verifica(await call('GET', '/usuarios', vencido({ role: 'ADMIN' })), 401, 'TOKEN_VENCIDO');
});

test('401 va antes que 503: sin token no se llega a la base', async () => {
  db.isConnected = () => false;
  try {
    await verifica(await call('GET', '/usuarios', null), 401, 'TOKEN_AUSENTE');
  } finally {
    db.isConnected = () => true;
  }
});

test('H: USER no puede listar, crear ni dar de baja usuarios -> 403 PERMISOS_INSUFICIENTES', async () => {
  const user = firmar({ sub: ID_A, role: 'USER' });
  for (const [m, p, b] of [['GET', '/usuarios'], ['POST', '/usuarios', {}], ['DELETE', `/usuarios/${ID_A}`]]) {
    await verifica(await call(m, p, user, b), 403, 'PERMISOS_INSUFICIENTES');
  }
});

test('propiedad: un USER ve su perfil (200) pero no el de otro ni lo modifica (403)', async () => {
  const user = firmar({ sub: ID_A, role: 'USER' });
  assert.strictEqual((await call('GET', `/usuarios/${ID_A}`, user)).status, 200);
  await verifica(await call('GET', `/usuarios/${ID_B}`, user), 403, 'PERMISOS_INSUFICIENTES');
  await verifica(await call('PUT', `/usuarios/${ID_B}`, user, {}), 403, 'PERMISOS_INSUFICIENTES');
});

test('I: ADMIN puede listar, ver el perfil de cualquiera y dar de baja', async () => {
  const admin = firmar({ sub: ID_B, role: 'ADMIN' });
  const lista = await call('GET', '/usuarios', admin);
  assert.strictEqual(lista.status, 200);
  assert.strictEqual((await lista.json()).length, 2);
  assert.strictEqual((await call('GET', `/usuarios/${ID_A}`, admin)).status, 200);
  assert.strictEqual((await call('DELETE', `/usuarios/${ID_A}`, admin)).status, 200);
});
