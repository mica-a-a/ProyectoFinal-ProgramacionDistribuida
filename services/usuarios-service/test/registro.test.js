// TP7 (punto 2) - Registro con credenciales. No necesita MongoDB: el modelo se reemplaza por stubs,
// igual que en api.test.js. Corre con `npm test`.
const test = require('node:test');
const assert = require('node:assert');
process.env.LOG_LEVEL = 'error';
process.env.BCRYPT_ROUNDS = '4'; // bcrypt barato en tests (en producción: 12)

const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const Usuario = require('../src/models/Usuario');
const { validarPassword, validarRol } = require('../src/services/validacion');
const app = require('../src/app');

const ID = '64b000000000000000000001';
const CLAVE = 'clave-correcta-123';
const datos = { nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', dni: '33444555', fechaNacimiento: '1995-04-12', password: CLAVE };

let server; let base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  db.isConnected = () => true;
});
test.after(() => server.close());

const registrar = (json) => fetch(`${base}/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json),
});

test('registro válido: 201, rol USER y la respuesta NO trae contraseña ni hash', async () => {
  let guardado;
  Usuario.create = async (d) => { guardado = d; return new Usuario({ _id: ID, ...d }); };
  const res = await registrar(datos);
  assert.strictEqual(res.status, 201);
  const texto = await res.text();
  const u = JSON.parse(texto);
  assert.strictEqual(u.role, 'USER');
  assert.strictEqual(u.activo, true);
  assert.ok(!('password' in u) && !('passwordHash' in u));
  assert.ok(!texto.includes(CLAVE) && !texto.includes(guardado.passwordHash));
});

test('lo que se guarda es un hash bcrypt con salt: no la contraseña', async () => {
  let guardado;
  Usuario.create = async (d) => { guardado = d; return new Usuario({ _id: ID, ...d }); };
  await registrar(datos);
  assert.match(guardado.passwordHash, /^\$2[aby]\$\d\d\$/);
  assert.notStrictEqual(guardado.passwordHash, CLAVE);
  assert.ok(!('password' in guardado), 'el objeto persistido no debe tener el campo password');
  assert.ok(await bcrypt.compare(CLAVE, guardado.passwordHash));
  // dos registros con la misma contraseña generan hashes distintos (salt aleatorio)
  const primero = guardado.passwordHash;
  await registrar({ ...datos, email: 'otra@example.com', dni: '33444556' });
  assert.notStrictEqual(guardado.passwordHash, primero);
});

test('el cliente NO puede elegir su rol ni su estado al registrarse', async () => {
  let guardado;
  Usuario.create = async (d) => { guardado = d; return new Usuario({ _id: ID, ...d }); };
  const res = await registrar({ ...datos, role: 'ADMIN', activo: false });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(guardado.role, 'USER');
  assert.strictEqual(guardado.activo, true);
  assert.strictEqual((await res.json()).role, 'USER');
});

test('email o DNI duplicado -> 409 controlado', async () => {
  for (const [campo, code] of [['email', 'EMAIL_DUPLICADO'], ['dni', 'DNI_DUPLICADO']]) {
    Usuario.create = async () => { const e = new Error('dup'); e.code = 11000; e.keyPattern = { [campo]: 1 }; throw e; };
    const res = await registrar(datos);
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).code, code);
  }
});

test('datos obligatorios: faltantes o inválidos -> 400 con la lista de errores y sin tocar la base', async () => {
  Usuario.create = async () => { throw new Error('no debería llegar a la base'); };
  const vacio = await registrar({ password: CLAVE });
  assert.strictEqual(vacio.status, 400);
  const j = await vacio.json();
  assert.strictEqual(j.code, 'VALIDACION');
  assert.ok(j.errors.length >= 3);
  const sinCuerpo = await fetch(`${base}/auth/register`, { method: 'POST' });
  assert.strictEqual(sinCuerpo.status, 400);
});

test('contraseña ausente, corta o de más de 72 bytes -> 400', async () => {
  Usuario.create = async () => { throw new Error('no debería llegar a la base'); };
  for (const password of [undefined, '', '1234567', 'a'.repeat(73), 12345678]) {
    const res = await registrar({ ...datos, password });
    assert.strictEqual(res.status, 400, `password=${String(password).slice(0, 10)}`);
    assert.strictEqual((await res.json()).code, 'VALIDACION');
  }
});

test('sin base de datos conectada -> 503 controlado', async () => {
  db.isConnected = () => false;
  const res = await registrar(datos);
  db.isConnected = () => true;
  assert.strictEqual(res.status, 503);
});

test('validarPassword y validarRol', () => {
  assert.deepStrictEqual(validarPassword('12345678'), []);
  assert.strictEqual(validarPassword(undefined).length, 1);
  assert.strictEqual(validarPassword('corta').length, 1);
  assert.strictEqual(validarPassword('ñ'.repeat(37)).length, 1); // 37 caracteres = 74 bytes
  assert.deepStrictEqual(validarRol('USER'), []);
  assert.deepStrictEqual(validarRol('ADMIN'), []);
  assert.strictEqual(validarRol('ROOT').length, 1);
});

test('alta administrada (POST /usuarios): exige contraseña, valida el rol y guarda hash', async () => {
  let guardado;
  Usuario.create = async (d) => { guardado = d; return new Usuario({ _id: ID, ...d }); };
  const post = (json) => fetch(`${base}/usuarios`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) });
  assert.strictEqual((await post({ ...datos, password: undefined })).status, 400);
  assert.strictEqual((await post({ ...datos, role: 'ROOT' })).status, 400);
  const ok = await post({ ...datos, role: 'ADMIN' });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(guardado.role, 'ADMIN');
  assert.match(guardado.passwordHash, /^\$2[aby]\$/);
  assert.ok(!('passwordHash' in (await ok.json())));
});

test('el hash nunca sale en la lista ni en el detalle', async () => {
  const doc = new Usuario({ _id: ID, nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', dni: '33444555',
    fechaNacimiento: new Date('1995-04-12'), passwordHash: await bcrypt.hash(CLAVE, 4), role: 'USER' });
  Usuario.find = () => ({ sort: async () => [doc] });
  Usuario.findById = async () => doc;
  const lista = await (await fetch(`${base}/usuarios`)).text();
  const detalle = await (await fetch(`${base}/usuarios/${ID}`)).text();
  for (const t of [lista, detalle]) assert.ok(!t.includes('passwordHash') && !t.includes(doc.passwordHash));
});
