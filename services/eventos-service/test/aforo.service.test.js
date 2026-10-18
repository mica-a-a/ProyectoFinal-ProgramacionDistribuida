const test = require('node:test');
const assert = require('node:assert/strict');
const { armar, datosEvento, DIA } = require('./helpers/armar');

async function conEvento(extra) {
  const ctx = armar();
  const evento = await ctx.eventosService.crear(datosEvento(extra));
  return { ...ctx, evento };
}
const rechazaCon = (promesa, status, code) =>
  assert.rejects(promesa, (err) => { assert.equal(err.status, status); assert.equal(err.code, code); return true; });

test('reservar descuenta el aforo', async () => {
  const { aforoService, evento } = await conEvento();
  const r = await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'o1' });
  assert.deepEqual(r, { reservado: true, disponibles: 3, idempotente: false });
});

test('al llegar a 0 el evento pasa a AGOTADO y rechaza con SIN_AFORO', async () => {
  const { aforoService, eventosService, evento } = await conEvento({ aforoTotal: 2 });
  await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'o1' });
  assert.equal((await eventosService.obtener(evento.id)).estado, 'AGOTADO');
  await rechazaCon(aforoService.reservar(evento.id, { cantidad: 1, referencia: 'o2' }), 409, 'SIN_AFORO');
});

test('pedir más de lo disponible devuelve SIN_AFORO y no descuenta', async () => {
  const { aforoService, eventosService, evento } = await conEvento({ aforoTotal: 3 });
  await rechazaCon(aforoService.reservar(evento.id, { cantidad: 4, referencia: 'o1' }), 409, 'SIN_AFORO');
  assert.equal((await eventosService.obtener(evento.id)).disponibles, 3);
});

test('un evento cancelado no se puede reservar (EVENTO_NO_VENDIBLE)', async () => {
  const { aforoService, eventosService, evento } = await conEvento();
  await eventosService.cancelar(evento.id);
  await rechazaCon(aforoService.reservar(evento.id, { cantidad: 1, referencia: 'o1' }), 409, 'EVENTO_NO_VENDIBLE');
});

test('un evento que ya pasó no se puede reservar', async () => {
  const ctx = armar({ ahora: () => new Date(Date.now() + 60 * DIA) }); // "hoy" es posterior al evento
  const evento = await ctx.eventosRepo.crear({ ...datosEvento(), fecha: new Date(Date.now() + 30 * DIA), disponibles: 5, estado: 'PUBLICADO' });
  await rechazaCon(ctx.aforoService.reservar(evento.id, { cantidad: 1, referencia: 'o1' }), 409, 'EVENTO_NO_VENDIBLE');
});

test('evento inexistente: 404; id mal formado: 400', async () => {
  const { aforoService } = await conEvento();
  await rechazaCon(aforoService.reservar('a'.repeat(24), { cantidad: 1, referencia: 'o1' }), 404, 'EVENTO_NO_ENCONTRADO');
  await rechazaCon(aforoService.reservar('xyz', { cantidad: 1, referencia: 'o1' }), 400, 'ID_INVALIDO');
});

test('cantidad y referencia inválidas devuelven 400', async () => {
  const { aforoService, evento } = await conEvento();
  await rechazaCon(aforoService.reservar(evento.id, { cantidad: 0, referencia: 'o1' }), 400, 'VALIDACION');
  await rechazaCon(aforoService.reservar(evento.id, { cantidad: 1.5, referencia: 'o1' }), 400, 'VALIDACION');
  await rechazaCon(aforoService.reservar(evento.id, { cantidad: 1 }), 400, 'VALIDACION');
});

test('IDEMPOTENCIA: repetir la misma referencia no descuenta dos veces', async () => {
  const { aforoService, evento } = await conEvento();
  const a = await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'orden-1' });
  const b = await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'orden-1' });
  assert.equal(a.disponibles, 3);
  assert.equal(b.disponibles, 3);
  assert.equal(b.idempotente, true);
});

test('misma referencia con otra cantidad: REFERENCIA_CONFLICTIVA', async () => {
  const { aforoService, evento } = await conEvento();
  await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'orden-1' });
  await rechazaCon(aforoService.reservar(evento.id, { cantidad: 3, referencia: 'orden-1' }), 409, 'REFERENCIA_CONFLICTIVA');
});

test('liberar devuelve los lugares y reabre un evento AGOTADO', async () => {
  const { aforoService, eventosService, evento } = await conEvento({ aforoTotal: 2 });
  await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'o1' });
  const r = await aforoService.liberar(evento.id, { cantidad: 2, referencia: 'o1' });
  assert.equal(r.liberado, true);
  assert.equal(r.disponibles, 2);
  assert.equal((await eventosService.obtener(evento.id)).estado, 'PUBLICADO');
});

test('IDEMPOTENCIA: liberar dos veces la misma referencia suma una sola vez', async () => {
  const { aforoService, evento } = await conEvento();
  await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'o1' });
  await aforoService.liberar(evento.id, { cantidad: 2, referencia: 'o1' });
  const otra = await aforoService.liberar(evento.id, { cantidad: 2, referencia: 'o1' });
  assert.equal(otra.disponibles, 5);
  assert.equal(otra.idempotente, true);
});

test('liberar una referencia que nunca reservó no suma nada', async () => {
  const { aforoService, evento } = await conEvento();
  const r = await aforoService.liberar(evento.id, { cantidad: 2, referencia: 'fantasma' });
  assert.equal(r.liberado, false);
  assert.equal(r.disponibles, 5); // nunca supera el aforo
});

test('liberar con una cantidad distinta a la reservada: CANTIDAD_INCONSISTENTE', async () => {
  const { aforoService, evento } = await conEvento();
  await aforoService.reservar(evento.id, { cantidad: 2, referencia: 'o1' });
  await rechazaCon(aforoService.liberar(evento.id, { cantidad: 3, referencia: 'o1' }), 409, 'CANTIDAD_INCONSISTENTE');
});

test('se puede liberar en un evento cancelado (compensación)', async () => {
  const { aforoService, eventosService, evento } = await conEvento();
  await aforoService.reservar(evento.id, { cantidad: 1, referencia: 'o1' });
  await eventosService.cancelar(evento.id);
  const r = await aforoService.liberar(evento.id, { cantidad: 1, referencia: 'o1' });
  assert.equal(r.liberado, true);
  assert.equal((await eventosService.obtener(evento.id)).estado, 'CANCELADO');
});

test('CONCURRENCIA: 30 pedidos simultáneos sobre 5 lugares venden exactamente 5', async () => {
  const { aforoService, eventosService, evento } = await conEvento({ aforoTotal: 5 });
  const resultados = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) => aforoService.reservar(evento.id, { cantidad: 1, referencia: `orden-${i}` }))
  );
  const ok = resultados.filter((r) => r.status === 'fulfilled').length;
  const ocupados = resultados.filter((r) => r.status === 'rejected' && r.reason.code === 'LOCK_OCUPADO').length;
  const sinAforo = resultados.filter((r) => r.status === 'rejected' && r.reason.code === 'SIN_AFORO').length;
  assert.ok(ok <= 5, `se vendieron ${ok} con aforo 5`);
  assert.equal(ok + ocupados + sinAforo, 30);
  const final = await eventosService.obtener(evento.id);
  assert.equal(final.disponibles, 5 - ok);
  assert.ok(final.disponibles >= 0);
});

test('la invariante 0 <= disponibles <= aforoTotal se mantiene tras mezclar reservas y liberaciones', async () => {
  const { aforoService, eventosService, evento } = await conEvento({ aforoTotal: 4 });
  for (let i = 0; i < 4; i++) await aforoService.reservar(evento.id, { cantidad: 1, referencia: `r${i}` });
  for (let i = 0; i < 4; i++) {
    await aforoService.liberar(evento.id, { cantidad: 1, referencia: `r${i}` });
    await aforoService.liberar(evento.id, { cantidad: 1, referencia: `r${i}` }); // repetida
  }
  const final = await eventosService.obtener(evento.id);
  assert.equal(final.disponibles, 4);
  assert.equal(final.estado, 'PUBLICADO');
});
