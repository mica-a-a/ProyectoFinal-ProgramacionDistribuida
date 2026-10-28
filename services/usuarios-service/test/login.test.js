// TP7 (punto 3) - Login y JWT. No necesita MongoDB: el modelo se reemplaza por stubs, igual que en los otros tests.
// Corre con `npm test`.
const test = require('node:test');
const assert = require('node:assert');
process.env.LOG_LEVEL = 'error';
process.env.BCRYPT_ROUNDS = '4';
process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres!!';
process.env.JWT_EXPIRES_IN = '1h';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const config = require('../src/config/config');
const Usuario = require('../src/models/Usuario');
const tokenService = require('../src/services/token.service');
const app = require('../src/app');

const ID = '64b000000000000000000001';
const CLAVE = 'clave-correcta-123';
const SECRET = process.env.JWT_SECRET;

let server; let base; let hash;
test.before(async () => {
  hash = await bcrypt.hash(CLAVE, 4);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  db.isConnected = () => true;
});
test.after(() => server.close());

const usuarioDe = (extra = {}) => new Usuario({
  _id: ID, nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', dni: '33444555',
  fechaNacimiento: new Date('1995-04-12'), passwordHash: hash, role: 'USER', activo: true, ...extra,
});
// Usuario.findOne(...).select('+passwordHash') -> devuelve `doc` (o null)
const stubBase = (doc) => { Usuario.findOne = () => ({ select: async () => doc }); };
const login = (json) => fetch(`${base}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json),
});
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const decodificar = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

test('credenciales válidas: 200 con token Bearer y sin cache', async () => {
  stubBase(usuarioDe());
  const res = await login({ email: 'ana@example.com', password: CLAVE });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  const j = await res.json();
  assert.strictEqual(j.tokenType, 'Bearer');
  assert.strictEqual(j.expiresIn, 3600);
  assert.ok(typeof j.token === 'string' && j.token.split('.').length === 3);
});

test('claims del token: sub, role, iat, exp (exp = iat + 1h) e iss; nada más', async () => {
  stubBase(usuarioDe({ role: 'ADMIN' }));
  const { token } = await (await login({ email: 'ana@example.com', password: CLAVE })).json();
  const p = decodificar(token);
  assert.deepStrictEqual(Object.keys(p).sort(), ['exp', 'iat', 'iss', 'role', 'sub']);
  assert.strictEqual(p.sub, ID);
  assert.strictEqual(p.role, 'ADMIN');
  assert.strictEqual(p.iss, 'usuarios-service');
  assert.strictEqual(p.exp - p.iat, 3600);
  assert.strictEqual(JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).alg, 'HS256');
});

test('el token no contiene contraseña, hash, secreto ni datos personales', async () => {
  stubBase(usuarioDe());
  const { token } = await (await login({ email: 'ana@example.com', password: CLAVE })).json();
  const payloadTexto = Buffer.from(token.split('.')[1], 'base64url').toString();
  for (const prohibido of [CLAVE, hash, SECRET, 'ana@example.com', '33444555', 'Pérez', 'passwordHash', 'email', 'dni']) {
    assert.ok(!payloadTexto.includes(prohibido), `el payload no debería incluir "${prohibido}"`);
  }
});

test('usuario inexistente y contraseña incorrecta dan EXACTAMENTE la misma respuesta 401', async () => {
  stubBase(null);
  const a = await login({ email: 'nadie@example.com', password: CLAVE });
  stubBase(usuarioDe());
  const b = await login({ email: 'ana@example.com', password: 'otra-clave-mala' });
  assert.strictEqual(a.status, 401);
  assert.strictEqual(b.status, 401);
  const ja = await a.json(); const jb = await b.json();
  assert.deepStrictEqual(ja, jb);
  assert.strictEqual(ja.code, 'CREDENCIALES_INVALIDAS');
  assert.ok(!('token' in ja));
});

test('usuario sin hash (creado antes del TP7) -> 401 genérico', async () => {
  stubBase(usuarioDe({ passwordHash: undefined }));
  const res = await login({ email: 'ana@example.com', password: CLAVE });
  assert.strictEqual(res.status, 401);
  assert.strictEqual((await res.json()).code, 'CREDENCIALES_INVALIDAS');
});

test('cuenta deshabilitada: 403 solo con contraseña correcta; con contraseña incorrecta 401 genérico', async () => {
  stubBase(usuarioDe({ activo: false }));
  const ok = await login({ email: 'ana@example.com', password: CLAVE });
  assert.strictEqual(ok.status, 403);
  const j = await ok.json();
  assert.strictEqual(j.code, 'CUENTA_DESHABILITADA');
  assert.ok(!('token' in j));
  const mala = await login({ email: 'ana@example.com', password: 'otra-clave-mala' });
  assert.strictEqual(mala.status, 401);
  assert.strictEqual((await mala.json()).code, 'CREDENCIALES_INVALIDAS');
});

test('datos inválidos -> 400 sin consultar la base', async () => {
  Usuario.findOne = () => { throw new Error('no debería llegar a la base'); };
  const casos = [
    {}, { email: 'ana@example.com' }, { password: CLAVE }, { email: '', password: '' },
    { email: 'no-es-un-email', password: CLAVE },
    { email: { $ne: null }, password: CLAVE },       // intento de inyección NoSQL
    { email: 'ana@example.com', password: { $ne: null } },
    { email: 'ana@example.com', password: 12345678 },
    { email: 'ana@example.com', password: 'a'.repeat(73) },
  ];
  for (const caso of casos) {
    const res = await login(caso);
    assert.strictEqual(res.status, 400, JSON.stringify(caso));
    assert.strictEqual((await res.json()).code, 'VALIDACION');
  }
  assert.strictEqual((await fetch(`${base}/auth/login`, { method: 'POST' })).status, 400);
  const jsonRoto = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{roto' });
  assert.strictEqual(jsonRoto.status, 400);
});

test('el cliente no puede elegir el rol: se ignora cualquier role/activo/sub del body', async () => {
  stubBase(usuarioDe({ role: 'USER' }));
  const res = await login({ email: 'ana@example.com', password: CLAVE, role: 'ADMIN', sub: 'otro', activo: true });
  assert.strictEqual(res.status, 200);
  const p = decodificar((await res.json()).token);
  assert.strictEqual(p.role, 'USER');
  assert.strictEqual(p.sub, ID);
});

test('el email se normaliza (mayúsculas y espacios)', async () => {
  let consultado;
  Usuario.findOne = (filtro) => { consultado = filtro; return { select: async () => usuarioDe() }; };
  const res = await login({ email: '  ANA@Example.com ', password: CLAVE });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(consultado, { email: 'ana@example.com' });
});

test('sin base conectada -> 503 y sin token', async () => {
  db.isConnected = () => false;
  const res = await login({ email: 'ana@example.com', password: CLAVE });
  db.isConnected = () => true;
  assert.strictEqual(res.status, 503);
});

test('error inesperado de la base -> 500 genérico, sin detalles', async () => {
  Usuario.findOne = () => ({ select: async () => { throw new Error('detalle interno secreto'); } });
  const res = await login({ email: 'ana@example.com', password: CLAVE });
  assert.strictEqual(res.status, 500);
  assert.ok(!(await res.text()).includes('detalle interno'));
});

// ---------------- verificación del token ----------------

test('verificar acepta un token emitido por el servicio y devuelve { sub, role }', () => {
  const { token } = tokenService.emitir({ id: ID, role: 'USER' });
  assert.deepStrictEqual(tokenService.verificar(token), { sub: ID, role: 'USER' });
});

const rechaza = (token, code) => assert.throws(() => tokenService.verificar(token), (e) => e.status === 401 && e.code === code);

test('se rechaza un token SIN firma (alg: none)', () => {
  const ahora = Math.floor(Date.now() / 1000);
  const sinFirma = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: ID, role: 'ADMIN', iss: 'usuarios-service', iat: ahora, exp: ahora + 3600 })}.`;
  rechaza(sinFirma, 'TOKEN_INVALIDO');
  rechaza(sinFirma.slice(0, -1), 'TOKEN_INVALIDO'); // sin el punto final
});

test('se rechaza un token con OTRO algoritmo (aunque esté firmado con la clave correcta)', () => {
  for (const algorithm of ['HS384', 'HS512']) {
    const t = jwt.sign({ role: 'ADMIN' }, SECRET, { algorithm, subject: ID, issuer: 'usuarios-service', expiresIn: 60 });
    rechaza(t, 'TOKEN_INVALIDO');
  }
});

test('se rechaza un token firmado con OTRA clave', () => {
  const t = jwt.sign({ role: 'ADMIN' }, 'otra-clave-distinta-de-32-caracteres-o-mas', { algorithm: 'HS256', subject: ID, issuer: 'usuarios-service', expiresIn: 60 });
  rechaza(t, 'TOKEN_INVALIDO');
});

test('se rechaza un token con el payload alterado (firma original)', () => {
  const { token } = tokenService.emitir({ id: ID, role: 'USER' });
  const [h, , f] = token.split('.');
  const alterado = { ...decodificar(token), role: 'ADMIN' };
  rechaza(`${h}.${b64(alterado)}.${f}`, 'TOKEN_INVALIDO');
});

test('se rechaza un token SIN exp aunque la firma sea válida', () => {
  const t = jwt.sign({ role: 'USER' }, SECRET, { algorithm: 'HS256', subject: ID, issuer: 'usuarios-service' }); // sin expiresIn
  assert.strictEqual(decodificar(t).exp, undefined);
  rechaza(t, 'TOKEN_INVALIDO');
});

test('se rechaza un token vencido (TOKEN_VENCIDO), con otro emisor, sin role o con role inválido, y basura', () => {
  const vencido = jwt.sign({ role: 'USER', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET, { algorithm: 'HS256', subject: ID, issuer: 'usuarios-service' });
  rechaza(vencido, 'TOKEN_VENCIDO');
  rechaza(jwt.sign({ role: 'USER' }, SECRET, { algorithm: 'HS256', subject: ID, issuer: 'otro-emisor', expiresIn: 60 }), 'TOKEN_INVALIDO');
  rechaza(jwt.sign({}, SECRET, { algorithm: 'HS256', subject: ID, issuer: 'usuarios-service', expiresIn: 60 }), 'TOKEN_INVALIDO');
  rechaza(jwt.sign({ role: 'ROOT' }, SECRET, { algorithm: 'HS256', subject: ID, issuer: 'usuarios-service', expiresIn: 60 }), 'TOKEN_INVALIDO');
  rechaza(jwt.sign({ role: 'USER' }, SECRET, { algorithm: 'HS256', issuer: 'usuarios-service', expiresIn: 60 }), 'TOKEN_INVALIDO'); // sin sub
  for (const basura of ['', 'abc', 'a.b.c', 'Bearer x']) rechaza(basura, 'TOKEN_INVALIDO');
});

// ---------------- vencimiento configurable ----------------

test('JWT_EXPIRES_IN configurable (15m, 2d, 900) y siempre produce exp', () => {
  const original = process.env.JWT_EXPIRES_IN;
  try {
    for (const [valor, segundos] of [['15m', 900], ['2d', 172800], ['900', 900], ['90s', 90], ['1h', 3600]]) {
      process.env.JWT_EXPIRES_IN = valor;
      const { token, expiresIn } = tokenService.emitir({ id: ID, role: 'USER' });
      const p = decodificar(token);
      assert.strictEqual(expiresIn, segundos, valor);
      assert.strictEqual(p.exp - p.iat, segundos, valor);
    }
    delete process.env.JWT_EXPIRES_IN; // sin variable: default de 1 hora
    assert.strictEqual(config.jwtExpiresInSeconds, 3600);
  } finally {
    process.env.JWT_EXPIRES_IN = original;
  }
});

test('valores inválidos de JWT_EXPIRES_IN no emiten tokens y assertJwtConfig falla', () => {
  const original = process.env.JWT_EXPIRES_IN;
  try {
    for (const malo of ['0', '-5', 'abc', '1x', '1.5h', '0h']) {
      process.env.JWT_EXPIRES_IN = malo;
      assert.strictEqual(config.jwtExpiresInSeconds, null, malo);
      assert.throws(() => config.assertJwtConfig(), /JWT_EXPIRES_IN/, malo);
      assert.throws(() => tokenService.emitir({ id: ID, role: 'USER' }), /JWT_EXPIRES_IN/, malo);
    }
  } finally {
    process.env.JWT_EXPIRES_IN = original;
  }
});

test('assertJwtConfig exige un JWT_SECRET de al menos 32 caracteres', () => {
  const original = process.env.JWT_SECRET;
  try {
    for (const malo of [undefined, '', 'corto', 'x'.repeat(31)]) {
      if (malo === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = malo;
      assert.throws(() => config.assertJwtConfig(), /JWT_SECRET/);
    }
    process.env.JWT_SECRET = 'x'.repeat(32);
    assert.doesNotThrow(() => config.assertJwtConfig());
  } finally {
    process.env.JWT_SECRET = original;
  }
});

test('sin JWT_SECRET no se emite ningún token (500 genérico, nunca 200)', async () => {
  const original = process.env.JWT_SECRET;
  stubBase(usuarioDe());
  delete process.env.JWT_SECRET;
  try {
    const res = await login({ email: 'ana@example.com', password: CLAVE });
    assert.strictEqual(res.status, 500);
    assert.ok(!(await res.text()).includes('token'));
  } finally {
    process.env.JWT_SECRET = original;
  }
});

test('el login nunca escribe la contraseña ni el token en los logs', async () => {
  const logger = require('../src/config/logger');
  const capturado = [];
  const originales = {};
  for (const nivel of ['info', 'warn', 'error']) {
    originales[nivel] = logger[nivel];
    logger[nivel] = (...args) => { capturado.push(JSON.stringify(args)); };
  }
  try {
    stubBase(usuarioDe());
    const { token } = await (await login({ email: 'ana@example.com', password: CLAVE })).json();
    await login({ email: 'ana@example.com', password: 'otra-clave-mala' });
    const todo = capturado.join('\n');
    assert.ok(!todo.includes(CLAVE) && !todo.includes('otra-clave-mala') && !todo.includes(token) && !todo.includes(hash));
    assert.ok(capturado.length > 0);
  } finally {
    Object.assign(logger, originales);
  }
});
