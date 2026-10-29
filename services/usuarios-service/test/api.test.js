// Pruebas HTTP del servicio. No necesitan MongoDB: el modelo se reemplaza por stubs
// y se simula el estado de la conexión. Verifican contrato, códigos y manejo de fallos.
const test = require('node:test');
const assert = require('node:assert');
process.env.LOG_LEVEL = 'error';
const { firmar, bearer } = require('./helpers/token'); // TP7: fija JWT_SECRET de prueba; va ANTES de cargar la app

const db = require('../src/config/db');
const Usuario = require('../src/models/Usuario');
const app = require('../src/app');

const ID = '64b000000000000000000001';
const body = {
  nombre: 'Lucía', apellido: 'Fernández', email: 'lucia@example.com',
  dni: '30123456', fechaNacimiento: '1990-05-14',
  password: 'clave-de-prueba-1', // TP7: el alta exige contraseña
};
const doc = (extra = {}) =>
  new Usuario({ _id: ID, ...body, fechaNacimiento: new Date('1990-05-14'), activo: true, ...extra });

let server; let base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// TP7: los endpoints de /usuarios exigen token; por defecto se llama como ADMIN.
const ADMIN = firmar({ role: 'ADMIN' });
const call = (method, path, json, token = ADMIN) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...bearer(token) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });

test('GET /health responde aunque la base no esté conectada', async () => {
  db.isConnected = () => false;
  const res = await call('GET', '/health');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { service: 'usuarios-service', status: 'ok' });
});

test('/api-docs sigue disponible con la base caída', async () => {
  db.isConnected = () => false;
  const res = await fetch(`${base}/api-docs/`);
  assert.strictEqual(res.status, 200);
});

test('base caída -> 503 controlado (no 500) en los endpoints de datos', async () => {
  db.isConnected = () => false;
  for (const [m, p, b] of [['GET', '/usuarios'], ['GET', `/usuarios/${ID}`], ['POST', '/usuarios', body]]) {
    const res = await call(m, p, b);
    assert.strictEqual(res.status, 503);
    assert.strictEqual((await res.json()).code, 'DB_NO_DISPONIBLE');
  }
});

test('error de conexión del driver a mitad de operación -> 503', async () => {
  db.isConnected = () => true;
  Usuario.findById = async () => { const e = new Error('x'); e.name = 'MongoServerSelectionError'; throw e; };
  const res = await call('GET', `/usuarios/${ID}`);
  assert.strictEqual(res.status, 503);
});

test('POST crea, devuelve 201 con id, edad calculada y activo=true', async () => {
  db.isConnected = () => true;
  Usuario.create = async (d) => new Usuario({ _id: ID, ...d });
  const res = await call('POST', '/usuarios', body);
  assert.strictEqual(res.status, 201);
  const u = await res.json();
  assert.strictEqual(u.id, ID);
  assert.strictEqual(u.activo, true);
  assert.strictEqual(u.fechaNacimiento, '1990-05-14');
  assert.ok(Number.isInteger(u.edad) && u.edad > 30);
  assert.ok(!('_id' in u));
});

test('POST con datos inválidos -> 400 con la lista de errores', async () => {
  db.isConnected = () => true;
  const res = await call('POST', '/usuarios', { nombre: 'A' });
  assert.strictEqual(res.status, 400);
  const j = await res.json();
  assert.strictEqual(j.code, 'VALIDACION');
  assert.ok(j.errors.length >= 2);
});

test('POST con JSON roto -> 400', async () => {
  db.isConnected = () => true;
  const res = await fetch(`${base}/usuarios`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{malo' });
  assert.strictEqual(res.status, 400);
});

test('POST con email o dni duplicado -> 409', async () => {
  db.isConnected = () => true;
  Usuario.create = async () => { const e = new Error('dup'); e.code = 11000; e.keyPattern = { email: 1 }; throw e; };
  let res = await call('POST', '/usuarios', body);
  assert.strictEqual(res.status, 409);
  assert.strictEqual((await res.json()).code, 'EMAIL_DUPLICADO');
  Usuario.create = async () => { const e = new Error('dup'); e.code = 11000; e.keyPattern = { dni: 1 }; throw e; };
  res = await call('POST', '/usuarios', body);
  assert.strictEqual((await res.json()).code, 'DNI_DUPLICADO');
});

test('GET /usuarios/:id -> 400 id inválido, 404 inexistente, 200 existente', async () => {
  db.isConnected = () => true;
  assert.strictEqual((await call('GET', '/usuarios/abc')).status, 400);
  Usuario.findById = async () => null;
  assert.strictEqual((await call('GET', `/usuarios/${ID}`)).status, 404);
  Usuario.findById = async () => doc();
  const res = await call('GET', `/usuarios/${ID}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).activo, true);
});

test('DELETE es baja lógica: devuelve el usuario con activo=false', async () => {
  db.isConnected = () => true;
  let update;
  Usuario.findByIdAndUpdate = async (id, u) => { update = u; return doc({ activo: false }); };
  const res = await call('DELETE', `/usuarios/${ID}`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(update, { $set: { activo: false } });
  assert.strictEqual((await res.json()).activo, false);
});

test('PUT no permite cambiar activo desde el body', async () => {
  db.isConnected = () => true;
  let update;
  Usuario.findByIdAndUpdate = async (id, u) => { update = u; return doc(); };
  const res = await call('PUT', `/usuarios/${ID}`, { ...body, activo: false });
  assert.strictEqual(res.status, 200);
  assert.ok(!('activo' in update.$set));
});

test('PUT / DELETE sobre usuario inexistente -> 404', async () => {
  db.isConnected = () => true;
  Usuario.findByIdAndUpdate = async () => null;
  assert.strictEqual((await call('PUT', `/usuarios/${ID}`, body)).status, 404);
  assert.strictEqual((await call('DELETE', `/usuarios/${ID}`)).status, 404);
});
