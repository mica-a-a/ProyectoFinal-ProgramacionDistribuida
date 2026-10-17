const test = require('node:test');
const assert = require('node:assert/strict');
const { armar, datosEvento } = require('./helpers/armar');

const rechazaCon = (promesa, status, code) =>
  assert.rejects(promesa, (err) => { assert.equal(err.status, status); assert.equal(err.code, code); return true; });

test('crear deja el evento PUBLICADO con todo el aforo disponible', async () => {
  const { eventosService } = armar();
  const e = await eventosService.crear(datosEvento({ aforoTotal: 50 }));
  assert.equal(e.estado, 'PUBLICADO');
  assert.equal(e.disponibles, 50);
  assert.equal(e.vendible, true);
  assert.equal(e.vigente, true);
});

test('crear valida los campos y rechaza estado/disponibles del cliente', async () => {
  const { eventosService } = armar();
  await rechazaCon(eventosService.crear({}), 400, 'VALIDACION');
  await rechazaCon(eventosService.crear(datosEvento({ aforoTotal: 0 })), 400, 'VALIDACION');
  await rechazaCon(eventosService.crear(datosEvento({ precio: -1 })), 400, 'VALIDACION');
  await rechazaCon(eventosService.crear(datosEvento({ fecha: '2000-01-01T00:00:00Z' })), 400, 'VALIDACION');
  await rechazaCon(eventosService.crear(datosEvento({ estado: 'CANCELADO' })), 400, 'VALIDACION');
  await rechazaCon(eventosService.crear(datosEvento({ disponibles: 99 })), 400, 'VALIDACION');
});

test('modificar el aforo respeta lo ya vendido', async () => {
  const { eventosService, aforoService } = armar();
  const e = await eventosService.crear(datosEvento({ aforoTotal: 10 }));
  await aforoService.reservar(e.id, { cantidad: 4, referencia: 'o1' });
  await rechazaCon(eventosService.actualizar(e.id, { aforoTotal: 3 }), 409, 'AFORO_MENOR_A_VENDIDO');
  const mod = await eventosService.actualizar(e.id, { aforoTotal: 6 });
  assert.equal(mod.disponibles, 2); // 6 - 4 vendidos
  const igual = await eventosService.actualizar(e.id, { aforoTotal: 4 });
  assert.equal(igual.disponibles, 0);
  assert.equal(igual.estado, 'AGOTADO');
});

test('un evento cancelado no se modifica y cancelar es idempotente', async () => {
  const { eventosService } = armar();
  const e = await eventosService.crear(datosEvento());
  await eventosService.cancelar(e.id);
  const otra = await eventosService.cancelar(e.id);
  assert.equal(otra.estado, 'CANCELADO');
  assert.equal(otra.vigente, false);
  assert.equal(otra.vendible, false);
  await rechazaCon(eventosService.actualizar(e.id, { nombre: 'Otro' }), 409, 'EVENTO_NO_MODIFICABLE');
});

test('finalizar solo aplica a eventos que ya ocurrieron y no a los cancelados', async () => {
  const { eventosService } = armar();
  const futuro = await eventosService.crear(datosEvento());
  await rechazaCon(eventosService.finalizar(futuro.id), 409, 'TRANSICION_INVALIDA');

  const ctx = armar({ ahora: () => new Date(Date.now() + 90 * 24 * 3600 * 1000) });
  const e = await ctx.eventosRepo.crear({ ...datosEvento(), fecha: new Date(Date.now() + 1000), disponibles: 5, estado: 'PUBLICADO' });
  const fin = await ctx.eventosService.finalizar(e.id);
  assert.equal(fin.estado, 'FINALIZADO');
  await rechazaCon(ctx.eventosService.cancelar(e.id), 409, 'TRANSICION_INVALIDA');
});

test('listar filtra por estado y valida el filtro', async () => {
  const { eventosService } = armar();
  const a = await eventosService.crear(datosEvento({ nombre: 'Evento A' }));
  await eventosService.crear(datosEvento({ nombre: 'Evento B' }));
  await eventosService.cancelar(a.id);
  assert.equal((await eventosService.listar({ estado: 'CANCELADO' })).length, 1);
  assert.equal((await eventosService.listar()).length, 2);
  await rechazaCon(eventosService.listar({ estado: 'XX' }), 400, 'VALIDACION');
});
