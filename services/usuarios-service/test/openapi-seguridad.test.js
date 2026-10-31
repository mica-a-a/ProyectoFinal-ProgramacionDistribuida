// TP7 (sección 16) - La documentación OpenAPI de usuarios-service coincide con su comportamiento real.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const test = require('node:test');
const assert = require('node:assert/strict');
const { firmar, bearer } = require('./helpers/token'); // fija JWT_SECRET de prueba
const db = require('../src/config/db');
const app = require('../src/app');

const USER = firmar({ sub: 'u1', role: 'USER' });
db.isConnected = () => true; // los chequeos de token y rol ocurren antes de tocar la base

async function conServidor(fn) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (metodo, ruta, cuerpo, token) => {
    const res = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json', ...(token ? bearer(token) : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    await res.text();
    return { status: res.status };
  };
  try { await fn(http); } finally { server.close(); }
}

const openapi = require('../src/docs/openapi');

const operaciones = Object.entries(openapi.paths).flatMap(([ruta, v]) => Object.entries(v).map(([m, op]) => ({ metodo: m.toUpperCase(), ruta, op })));
const protegidas = operaciones.filter((o) => o.op.security);
const soloAdmin = protegidas.filter((o) => /Requiere rol ADMIN/.test(o.op.description));
const concreta = (ruta) => ruta.replace(/\{id\}/g, 'a'.repeat(24));

test('Swagger define el esquema de seguridad Bearer JWT', () => {
  assert.deepEqual(
    { type: openapi.components.securitySchemes.bearerAuth.type, scheme: openapi.components.securitySchemes.bearerAuth.scheme, bearerFormat: openapi.components.securitySchemes.bearerAuth.bearerFormat },
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
  );
  assert.ok(protegidas.length > 0, 'ningún endpoint declara seguridad');
});

test('todo endpoint protegido documenta 401 y el rol o condición exigida; los de rol/propiedad documentan 403', () => {
  for (const { metodo, ruta, op } of protegidas) {
    assert.ok(op.responses[401], `${metodo} ${ruta} no documenta 401`);
    assert.match(op.description, /Requiere/, `${metodo} ${ruta} no documenta qué se exige`);
    if (!/cualquier rol/.test(op.description)) assert.ok(op.responses[403], `${metodo} ${ruta} no documenta 403`);
  }
});

test('la documentación coincide con el comportamiento: sin token, cada endpoint protegido responde 401', async () => {
  await conServidor(async (http) => {
    for (const { metodo, ruta } of protegidas) {
      const r = await http(metodo, concreta(ruta), ['POST', 'PUT', 'PATCH'].includes(metodo) ? {} : undefined, null);
      assert.equal(r.status, 401, `${metodo} ${ruta} debería responder 401 sin token`);
    }
  });
});

test('la documentación coincide con el comportamiento: un USER recibe 403 en los endpoints "Requiere rol ADMIN"', async () => {
  assert.ok(soloAdmin.length > 0);
  await conServidor(async (http) => {
    for (const { metodo, ruta } of soloAdmin) {
      const r = await http(metodo, concreta(ruta), ['POST', 'PUT', 'PATCH'].includes(metodo) ? {} : undefined, USER);
      assert.equal(r.status, 403, `${metodo} ${ruta} debería responder 403 a un USER`);
    }
  });
});

test('los endpoints públicos (salud y autenticación) no declaran seguridad', () => {
  for (const { ruta, op } of operaciones.filter((o) => /^\/(health|ready|auth)/.test(o.ruta))) assert.ok(!op.security, `${ruta} no debería pedir token`);
});

test('un USER recibe 403 al pedir el perfil de otra persona, como documenta Swagger', async () => {
  await conServidor(async (http) => {
    assert.equal((await http('GET', `/usuarios/${'b'.repeat(24)}`, undefined, USER)).status, 403);
    assert.equal((await http('PUT', `/usuarios/${'b'.repeat(24)}`, {}, USER)).status, 403);
  });
});
