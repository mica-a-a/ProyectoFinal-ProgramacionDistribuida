// Pruebas de integración de entradas-service con usuarios-service y eventos-service SIMULADOS
// y modelos en memoria. Se ejecutan con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startUsuariosMock, startEventosMock } = require('./helpers/mockServices');
const { makeModel } = require('./helpers/fakeModels');

const src = (p) => path.join(__dirname, '..', 'src', p);
const injectar = (modulo, exports) => { require.cache[require.resolve(src(modulo))] = { id: src(modulo), filename: src(modulo), loaded: true, exports }; };

const Orden = makeModel({ estado: 'PENDIENTE', precioUnitario: null, motivoRechazo: null });
const Ticket = makeModel({ estado: 'VALIDO', usadoEn: null });

let usuarios; let eventos; let entradas; let base; let eventosPort;

test.before(async () => {
  usuarios = await startUsuariosMock();
  eventos = await startEventosMock();
  eventosPort = eventos.port;
  process.env.SERVICE_NAME = 'entradas-service';
  process.env.LOG_LEVEL = 'error';
  process.env.MONGODB_URI = 'mongodb://fake';
  process.env.USUARIOS_SERVICE_URL = `http://127.0.0.1:${usuarios.port}`;
  process.env.EVENTOS_SERVICE_URL = `http://127.0.0.1:${eventos.port}`;
  process.env.REQUEST_TIMEOUT_MS = '400';
  process.env.MAX_ENTRADAS_POR_USUARIO = '4';
  process.env.PLAZO_CANCELACION_HORAS = '24';
  injectar('models/Orden.js', Orden);
  injectar('models/Ticket.js', Ticket);
  injectar('config/db.js', { requireDb: (req, res, next) => next(), connectWithRetry: async () => {} });
  const app = require('../src/app');
  entradas = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${entradas.address().port}`;
});

test.after(async () => {
  entradas.close(); usuarios.server.close(); eventos.server.close();
});

test.beforeEach(() => {
  Orden.reset(); Ticket.reset();
  Object.assign(eventos.state, { movimientos: new Map(), liberados: new Set(), llamadas: [], lockOcupadoVeces: 0, fallo: null, demoraMs: 0 });
  for (const e of Object.values(eventos.state.eventos)) { e.disponibles = e.aforoTotal; if (e.estado === 'AGOTADO') e.estado = 'PUBLICADO'; }
});

const http = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const comprar = (over = {}) => http('POST', '/ordenes', { usuarioId: 'u1', eventoId: 'e1', cantidad: 2, ...over });

// ---------------- Health ----------------
test('health responde con el nombre del servicio', async () => {
  const r = await http('GET', '/health');
  assert.deepEqual(r.body, { service: 'entradas-service', status: 'ok' });
});

// ---------------- Compra ----------------
test('compra exitosa: orden CONFIRMADA, tickets emitidos, precio congelado y referencia = ordenId', async () => {
  const r = await comprar();
  assert.equal(r.status, 201);
  assert.equal(r.body.orden.estado, 'CONFIRMADA');
  assert.equal(r.body.orden.precioUnitario, 5000);
  assert.equal(r.body.tickets.length, 2);
  assert.equal(eventos.state.eventos.e1.disponibles, 8);
  const reserva = eventos.state.llamadas.find((l) => l.path.endsWith('/reservar-aforo'));
  assert.equal(reserva.body.referencia, r.body.orden.id);
});

test('datos inválidos: 400 y no se crea ninguna orden', async () => {
  assert.equal((await comprar({ cantidad: 0 })).status, 400);
  assert.equal((await comprar({ usuarioId: '' })).status, 400);
  assert.equal(Orden.rows.length, 0);
});

test('usuario inexistente: 404 funcional (no 503), orden RECHAZADA y sin pedir aforo', async () => {
  const r = await comprar({ usuarioId: 'nadie' });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'USUARIO_NO_ENCONTRADO');
  assert.equal(Orden.rows[0].estado, 'RECHAZADA');
  assert.equal(eventos.state.llamadas.some((l) => l.path.endsWith('/reservar-aforo')), false);
});

test('usuario inactivo: 409', async () => {
  const r = await comprar({ usuarioId: 'u3' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'USUARIO_INACTIVO');
});

test('máximo por usuario y evento: la regla es de Entradas (409)', async () => {
  assert.equal((await comprar({ cantidad: 3 })).status, 201);
  const r = await comprar({ cantidad: 2 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'MAXIMO_ENTRADAS_EXCEDIDO');
  assert.equal(eventos.state.eventos.e1.disponibles, 7);
});

test('sin aforo: el 409 de Eventos se propaga y la orden queda RECHAZADA', async () => {
  const r = await comprar({ eventoId: 'e4', cantidad: 3 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'SIN_AFORO');
  assert.equal(Orden.rows[0].estado, 'RECHAZADA');
});

test('evento cancelado: lo decide Eventos (409)', async () => {
  const r = await comprar({ eventoId: 'e3' });
  assert.equal(r.status, 409);
});

test('evento inexistente: 404', async () => {
  const r = await comprar({ eventoId: 'zzz' });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'EVENTO_NO_ENCONTRADO');
});

test('lock ocupado (423): se reintenta y la compra se completa', async () => {
  eventos.state.lockOcupadoVeces = 2;
  const r = await comprar();
  assert.equal(r.status, 201);
  assert.equal(eventos.state.llamadas.filter((l) => l.path.endsWith('/reservar-aforo')).length, 3);
});

test('lock ocupado de forma sostenida: 423 al cliente y orden RECHAZADA', async () => {
  eventos.state.lockOcupadoVeces = 10;
  const r = await comprar();
  assert.equal(r.status, 423);
  assert.equal(Orden.rows[0].estado, 'RECHAZADA');
});

// ---------------- Fallos de dependencia ----------------
test('timeout de Eventos: 503 controlado y Entradas sigue vivo', async () => {
  eventos.state.demoraMs = 1000;
  const r = await comprar();
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'DEPENDENCIA_NO_DISPONIBLE');
  assert.equal(Orden.rows[0].estado, 'RECHAZADA');
  assert.equal((await http('GET', '/health')).status, 200);
});

test('Eventos caído (conexión rechazada): 503 y recuperación al volver', async () => {
  await new Promise((r) => eventos.server.close(r));
  const caido = await comprar();
  assert.equal(caido.status, 503);
  assert.equal((await http('GET', '/health')).status, 200);        // Entradas no se cae

  // Se levanta de nuevo en el mismo puerto: el caso de uso se recupera.
  const nuevo = await startEventosMock(eventosPort);
  eventos.server = nuevo.server; eventos.state = nuevo.state;
  assert.equal((await comprar()).status, 201);
});

test('Usuarios caído: 503 y no se descuenta aforo', async () => {
  const original = process.env.USUARIOS_SERVICE_URL;
  // Usuarios simulado cerrado: se usa un puerto sin servicio.
  const config = require('../src/config/config');
  config.usuariosServiceUrl = 'http://127.0.0.1:1';
  const r = await comprar();
  config.usuariosServiceUrl = original;
  assert.equal(r.status, 503);
  assert.equal(eventos.state.eventos.e1.disponibles, 10);
});

test('fallo parcial: Eventos responde 500 al reservar -> orden PENDIENTE y 503 con el ordenId', async () => {
  eventos.state.fallo = 'http500';
  const r = await comprar();
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'ORDEN_PENDIENTE');
  assert.equal(Orden.rows[0].estado, 'PENDIENTE');
  assert.equal(r.body.details.ordenId, Orden.rows[0]._id);
});

// ---------------- Consulta ----------------
test('consultar orden: con tickets, 400 si el id es inválido y 404 si no existe', async () => {
  const c = await comprar();
  const ok = await http('GET', `/ordenes/${c.body.orden.id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tickets.length, 2);
  assert.equal((await http('GET', '/ordenes/abc')).status, 400);
  assert.equal((await http('GET', '/ordenes/aaaaaaaaaaaaaaaaaaaaaaaa')).status, 404);
});

test('listar entradas por usuario (usuarioId obligatorio)', async () => {
  await comprar({ cantidad: 2 });
  await comprar({ usuarioId: 'u2', cantidad: 1 });
  const r = await http('GET', '/entradas?usuarioId=u1');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 2);
  assert.equal(r.body[0].eventoId, 'e1');
  assert.equal((await http('GET', '/entradas')).status, 400);
});

// ---------------- Cancelación ----------------
test('cancelar: orden CANCELADA, tickets ANULADO y aforo devuelto con la misma referencia', async () => {
  const c = await comprar();
  const r = await http('DELETE', `/ordenes/${c.body.orden.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.orden.estado, 'CANCELADA');
  assert.ok(r.body.tickets.every((t) => t.estado === 'ANULADO'));
  assert.equal(eventos.state.eventos.e1.disponibles, 10);
  const lib = eventos.state.llamadas.find((l) => l.path.endsWith('/liberar-aforo'));
  assert.equal(lib.body.referencia, c.body.orden.id);
});

test('cancelar dos veces es idempotente y no devuelve el aforo dos veces', async () => {
  const c = await comprar();
  await http('DELETE', `/ordenes/${c.body.orden.id}`);
  const otra = await http('DELETE', `/ordenes/${c.body.orden.id}`);
  assert.equal(otra.status, 200);
  assert.equal(eventos.state.eventos.e1.disponibles, 10);
});

test('cancelar fuera de plazo: 409', async () => {
  const c = await comprar({ eventoId: 'e2' });
  const r = await http('DELETE', `/ordenes/${c.body.orden.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'FUERA_DE_PLAZO');
});

test('cancelar con un ticket ya usado: 409 y los tickets vuelven a su estado', async () => {
  const c = await comprar();
  await http('POST', '/entradas/validar', { codigo: c.body.tickets[0].codigo });
  const r = await http('DELETE', `/ordenes/${c.body.orden.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'TICKETS_USADOS');
  const estados = Ticket.rows.map((t) => t.estado).sort();
  assert.deepEqual(estados, ['USADO', 'VALIDO']);
});

test('cancelar con Eventos caído: 503 y la orden sigue CONFIRMADA con sus tickets válidos', async () => {
  const c = await comprar();
  eventos.state.demoraMs = 1000;
  const r = await http('DELETE', `/ordenes/${c.body.orden.id}`);
  assert.equal(r.status, 503);
  assert.equal(Orden.rows[0].estado, 'CONFIRMADA');
  assert.ok(Ticket.rows.every((t) => t.estado === 'VALIDO'));
});

// ---------------- Validación de tickets ----------------
test('validar: uso único (200 y luego 409)', async () => {
  const c = await comprar();
  const codigo = c.body.tickets[0].codigo;
  const uno = await http('POST', '/entradas/validar', { codigo });
  assert.equal(uno.status, 200);
  assert.equal(uno.body.ticket.estado, 'USADO');
  const dos = await http('POST', '/entradas/validar', { codigo });
  assert.equal(dos.status, 409);
});

test('validar: dos pedidos simultáneos con el mismo código, solo uno ingresa', async () => {
  const c = await comprar();
  const codigo = c.body.tickets[0].codigo;
  const [a, b] = await Promise.all([
    http('POST', '/entradas/validar', { codigo }),
    http('POST', '/entradas/validar', { codigo }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('validar: código inexistente 404, sin código 400', async () => {
  assert.equal((await http('POST', '/entradas/validar', { codigo: 'NOEXISTE' })).status, 404);
  assert.equal((await http('POST', '/entradas/validar', {})).status, 400);
});

test('validar: evento no vigente -> 422', async () => {
  const c = await comprar();
  eventos.state.eventos.e1.vigente = false;
  const r = await http('POST', '/entradas/validar', { codigo: c.body.tickets[0].codigo });
  eventos.state.eventos.e1.vigente = true;
  assert.equal(r.status, 422);
});

test('validar con Eventos caído: se rechaza el ingreso con 503', async () => {
  const c = await comprar();
  eventos.state.demoraMs = 1000;
  const r = await http('POST', '/entradas/validar', { codigo: c.body.tickets[0].codigo });
  assert.equal(r.status, 503);
  assert.equal(Ticket.rows[0].estado, 'VALIDO');
});

test('JSON inválido: 400', async () => {
  const res = await fetch(`${base}/ordenes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{malo' });
  assert.equal(res.status, 400);
});
