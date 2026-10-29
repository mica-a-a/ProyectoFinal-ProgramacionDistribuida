const test = require('node:test');
const assert = require('node:assert/strict');
const { firmar, bearer } = require('./helpers/token'); // TP7: fija JWT_SECRET de prueba
const { armar, datosEvento } = require('./helpers/armar');

// TP7: la gestión de eventos exige ADMIN; por defecto se llama como ADMIN (token: null = sin token).
const ADMIN = firmar({ role: 'ADMIN' });

async function conServidor(opciones, fn) {
  const ctx = armar(opciones);
  const server = ctx.app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (metodo, ruta, cuerpo, token = ADMIN) => {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token ? bearer(token) : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await res.text();
    return { status: res.status, body: texto ? JSON.parse(texto) : null };
  };
  try { await fn(http, ctx); } finally { server.close(); }
}

test('GET /health responde servicio y estado', () =>
  conServidor({}, async (http) => {
    const r = await http('GET', '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { service: 'eventos-service', status: 'ok' });
  }));

test('GET /ready informa 503 degradado si Redis no está', () =>
  conServidor({ readiness: () => ({ mongodb: true, redis: false }) }, async (http) => {
    const r = await http('GET', '/ready');
    assert.equal(r.status, 503);
    assert.deepEqual(r.body.dependencies, { mongodb: 'up', redis: 'down' });
  }));

test('flujo completo: crear, consultar, reservar, agotar, liberar', () =>
  conServidor({}, async (http) => {
    const creado = await http('POST', '/eventos', datosEvento({ aforoTotal: 2 }));
    assert.equal(creado.status, 201);
    const id = creado.body.id;

    assert.equal((await http('GET', `/eventos/${id}`)).body.disponibles, 2);

    const r1 = await http('POST', `/eventos/${id}/reservar-aforo`, { cantidad: 2, referencia: 'o1' });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.body, { reservado: true, disponibles: 0, idempotente: false });

    const r2 = await http('POST', `/eventos/${id}/reservar-aforo`, { cantidad: 1, referencia: 'o2' });
    assert.equal(r2.status, 409);
    assert.equal(r2.body.code, 'SIN_AFORO');

    assert.equal((await http('GET', `/eventos/${id}`)).body.estado, 'AGOTADO');

    const lib = await http('POST', `/eventos/${id}/liberar-aforo`, { cantidad: 2, referencia: 'o1' });
    assert.equal(lib.status, 200);
    assert.equal(lib.body.disponibles, 2);
  }));

test('códigos de error: 400, 404, 409 y ruta inexistente', () =>
  conServidor({}, async (http) => {
    const mal = await http('POST', '/eventos', { nombre: 'x' });
    assert.equal(mal.status, 400);
    assert.ok(Array.isArray(mal.body.errores));

    assert.equal((await http('GET', '/eventos/xyz')).status, 400);
    assert.equal((await http('GET', `/eventos/${'a'.repeat(24)}`)).status, 404);
    assert.equal((await http('GET', '/nada')).status, 404);

    const id = (await http('POST', '/eventos', datosEvento())).body.id;
    await http('PATCH', `/eventos/${id}/cancelar`);
    const r = await http('POST', `/eventos/${id}/reservar-aforo`, { cantidad: 1, referencia: 'o1' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'EVENTO_NO_VENDIBLE');
  }));

test('un JSON mal formado devuelve 400 y no rompe el servicio', () =>
  conServidor({}, async (http, ctx) => {
    const server = ctx.app.listen(0);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/eventos`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{roto',
    });
    assert.equal(res.status, 400);
    server.close();
    assert.equal((await http('GET', '/health')).status, 200);
  }));
