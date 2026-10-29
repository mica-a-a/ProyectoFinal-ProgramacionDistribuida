// TP7 (punto 5) - Propagación del token entre microservicios.
// Entradas recibe el JWT del cliente, lo valida y lo reenvía a Usuarios y a Eventos. Estos tests usan simulados
// que validan el token como los servicios reales y registran el encabezado Authorization que reciben.
// Se ejecutan con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startUsuariosMock, startEventosMock } = require('./helpers/mockServices');
const { makeModel } = require('./helpers/fakeModels');
const { firmar, vencido, adulterado, bearer } = require('./helpers/token'); // fija JWT_SECRET de prueba

const src = (p) => path.join(__dirname, '..', 'src', p);
const injectar = (modulo, exports) => { require.cache[require.resolve(src(modulo))] = { id: src(modulo), filename: src(modulo), loaded: true, exports }; };

const Orden = makeModel({ estado: 'PENDIENTE', precioUnitario: null, motivoRechazo: null });
const Ticket = makeModel({ estado: 'VALIDO', usadoEn: null });

const USER_U1 = firmar({ sub: 'u1', role: 'USER' });   // u1 existe y está activo en el simulado de Usuarios
const USER_U2 = firmar({ sub: 'u2', role: 'USER' });
const ADMIN = firmar({ sub: 'admin1', role: 'ADMIN' });

const decodificar = (authorization) => JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString('utf8'));

let usuarios; let eventos; let entradas; let base; let logger;
const registroLogs = [];

test.before(async () => {
  usuarios = await startUsuariosMock();
  eventos = await startEventosMock();
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

  // Se registra todo lo que Entradas manda a los logs para comprobar que el token nunca aparece.
  logger = require('../src/config/logger');
  ['info', 'warn', 'error', 'debug'].forEach((nivel) => {
    const original = logger[nivel].bind(logger);
    logger[nivel] = (...args) => { registroLogs.push(JSON.stringify(args)); return original(...args); };
  });

  const app = require('../src/app');
  entradas = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${entradas.address().port}`;
});

test.after(() => { entradas.close(); usuarios.server.close(); eventos.server.close(); });

test.beforeEach(() => {
  Orden.reset(); Ticket.reset();
  registroLogs.length = 0;
  Object.assign(usuarios.state, { llamadas: [], forzar: null });
  Object.assign(eventos.state, { movimientos: new Map(), liberados: new Set(), llamadas: [], lockOcupadoVeces: 0, fallo: null, demoraMs: 0, forzar: null });
  for (const e of Object.values(eventos.state.eventos)) { e.disponibles = e.aforoTotal; if (e.estado === 'AGOTADO') e.estado = 'PUBLICADO'; }
});

const http = async (method, url, body, token) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? bearer(token) : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const comprar = (token, over = {}) => http('POST', '/ordenes', { usuarioId: 'u1', eventoId: 'e1', cantidad: 2, ...over }, token);

const sinAuth = (llamadas) => llamadas.filter((l) => l.path !== '/health');

// ---------------------------------------------------------------------------------------------
// Qué se propaga
// ---------------------------------------------------------------------------------------------
test('compra: Entradas reenvía a Usuarios el MISMO token que recibió del cliente', async () => {
  const r = await comprar(USER_U1);
  assert.equal(r.status, 201);
  const aUsuarios = usuarios.state.llamadas.filter((l) => l.path === '/usuarios/u1');
  assert.equal(aUsuarios.length, 1);
  assert.equal(aUsuarios[0].authorization, `Bearer ${USER_U1}`);
});

test('compra: Entradas reenvía el token a Eventos en TODAS las llamadas (consulta y reserva de aforo)', async () => {
  const r = await comprar(USER_U1);
  assert.equal(r.status, 201);
  const aEventos = sinAuth(eventos.state.llamadas);
  assert.deepEqual(aEventos.map((l) => `${l.method} ${l.path}`), ['GET /eventos/e1', 'POST /eventos/e1/reservar-aforo']);
  for (const l of aEventos) assert.equal(l.authorization, `Bearer ${USER_U1}`, `${l.method} ${l.path} sin el token del cliente`);
});

test('cancelar: se propaga el token a la consulta del evento y a la liberación de aforo', async () => {
  const compra = await comprar(USER_U1);
  eventos.state.llamadas.length = 0;
  const r = await http('DELETE', `/ordenes/${compra.body.orden.id}`, undefined, USER_U1);
  assert.equal(r.status, 200);
  assert.deepEqual(sinAuth(eventos.state.llamadas).map((l) => `${l.method} ${l.path}`), ['GET /eventos/e1', 'POST /eventos/e1/liberar-aforo']);
  for (const l of sinAuth(eventos.state.llamadas)) assert.equal(l.authorization, `Bearer ${USER_U1}`);
});

test('el contexto que llega a los servicios es el del CLIENTE (sub y role), no uno propio de Entradas', async () => {
  await comprar(USER_U1);
  const claims = decodificar(usuarios.state.llamadas.find((l) => l.path === '/usuarios/u1').authorization);
  assert.equal(claims.sub, 'u1');
  assert.equal(claims.role, 'USER');

  // Un ADMIN que compra para otra persona viaja como ADMIN: Usuarios lo autoriza por su rol.
  usuarios.state.llamadas.length = 0;
  const r = await comprar(ADMIN, { usuarioId: 'u2', cantidad: 1 });
  assert.equal(r.status, 201);
  const admin = decodificar(usuarios.state.llamadas.find((l) => l.path === '/usuarios/u2').authorization);
  assert.equal(admin.sub, 'admin1');
  assert.equal(admin.role, 'ADMIN');
});

test('solo se reenvía el encabezado Authorization (no el cuerpo ni otros encabezados del cliente)', async () => {
  const res = await fetch(`${base}/ordenes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `bearer   ${USER_U1}`, 'x-otro': 'secreto', cookie: 'a=b' },
    body: JSON.stringify({ usuarioId: 'u1', eventoId: 'e1', cantidad: 1 }),
  });
  assert.equal(res.status, 201);
  const recibida = usuarios.state.llamadas.find((l) => l.path === '/usuarios/u1');
  // Se normaliza a "Bearer <token>" aunque el cliente haya escrito el esquema distinto.
  assert.equal(recibida.authorization, `Bearer ${USER_U1}`);
  assert.equal(recibida.headers['x-otro'], undefined, 'se filtró un encabezado del cliente');
  assert.equal(recibida.headers.cookie, undefined, 'se filtró la cookie del cliente');
});

// ---------------------------------------------------------------------------------------------
// Lo que Entradas rechaza NO se propaga: no se llama a nadie con una identidad inválida
// ---------------------------------------------------------------------------------------------
test('sin token, token vencido o token alterado: 401 y no se llama a Usuarios ni a Eventos', async () => {
  for (const [nombre, token, codigo] of [['sin token', null, 'TOKEN_AUSENTE'], ['vencido', vencido({ sub: 'u1' }), 'TOKEN_VENCIDO'], ['alterado', adulterado({ sub: 'u1' }), 'TOKEN_INVALIDO']]) {
    const r = await comprar(token);
    assert.equal(r.status, 401, nombre);
    assert.equal(r.body.code, codigo, nombre);
  }
  assert.equal(usuarios.state.llamadas.length, 0);
  assert.equal(eventos.state.llamadas.length, 0);
  assert.equal(Orden.rows.length, 0);
});

test('un USER que intenta comprar para otra persona: 403 y no se llama a ningún servicio', async () => {
  const r = await comprar(USER_U1, { usuarioId: 'u2' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'PERMISOS_INSUFICIENTES');
  assert.equal(usuarios.state.llamadas.length, 0, 'Usuarios no debió ser consultado');
  assert.equal(eventos.state.llamadas.length, 0, 'Eventos no debió ser consultado');
  assert.equal(eventos.state.eventos.e1.disponibles, 10, 'no se descontó aforo');
});

// ---------------------------------------------------------------------------------------------
// Cuando el servicio remoto rechaza la identidad que se le propagó
// ---------------------------------------------------------------------------------------------
test('si el token vence a mitad de la operación (Usuarios responde 401 TOKEN_VENCIDO): 401 al cliente y orden RECHAZADA sin aforo', async () => {
  usuarios.state.forzar = { status: 401, code: 'TOKEN_VENCIDO' };
  const r = await comprar(USER_U1);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'TOKEN_VENCIDO');
  assert.equal(Orden.rows[0].estado, 'RECHAZADA');
  assert.equal(sinAuth(eventos.state.llamadas).length, 0, 'no se llegó a reservar aforo');
});

test('si un servicio no acepta la credencial por otro motivo (distinto JWT_SECRET): 502 DEPENDENCIA_AUTENTICACION, no un 401 para el cliente', async () => {
  eventos.state.forzar = { status: 401, code: 'TOKEN_INVALIDO' };
  const r = await comprar(USER_U1);
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'DEPENDENCIA_AUTENTICACION');
  assert.equal(Orden.rows[0].estado, 'RECHAZADA');
});

test('si el servicio dueño responde 403 (su regla de autorización), se propaga como 403', async () => {
  eventos.state.forzar = { status: 403, code: 'PERMISOS_INSUFICIENTES' };
  const r = await comprar(USER_U1);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'PERMISOS_INSUFICIENTES');
  assert.equal(Orden.rows[0].estado, 'RECHAZADA');
});

// ---------------------------------------------------------------------------------------------
// Seguridad de los logs (sección 17 de la consigna)
// ---------------------------------------------------------------------------------------------
test('el token no aparece en ningún log de Entradas, ni en el camino feliz ni cuando un servicio lo rechaza', async () => {
  await comprar(USER_U1);
  usuarios.state.forzar = { status: 401, code: 'TOKEN_INVALIDO' };
  await comprar(USER_U1);
  usuarios.state.forzar = null;
  await comprar(vencido({ sub: 'u1' }));
  assert.ok(registroLogs.length > 0, 'el spy de logs no registró nada');
  const todo = registroLogs.join('\n');
  assert.ok(!todo.includes(USER_U1), 'el token del cliente apareció en un log');
  assert.ok(!/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(todo), 'apareció algo con forma de JWT en un log');
});
