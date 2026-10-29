// Prueba el lock contra un Redis REAL. Si no hay Redis, se omite.
// Uso: REDIS_URL=redis://localhost:6379 npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('redis');
const { createLockManager } = require('../src/lock/lockManager');
const { loggerSilencioso } = require('./helpers/fakes');

const url = process.env.REDIS_URL;

async function conRedis(t, fn) {
  if (!url) return t.skip('REDIS_URL no definida');
  const client = createClient({ url, disableOfflineQueue: true, socket: { reconnectStrategy: false, connectTimeout: 1000 } });
  client.on('error', () => {});
  try { await client.connect(); } catch { return t.skip('Redis no disponible'); }
  try { await fn(client); } finally { await client.quit(); }
}

test('exclusión mutua: mientras se sostiene el lock, otro pedido recibe 423', async (t) => {
  await conRedis(t, async (client) => {
    const lock = createLockManager({ client, ttlMs: 5000, logger: loggerSilencioso });
    const clave = `lock:test:${Date.now()}`;
    let liberar;
    const espera = new Promise((r) => { liberar = r; });
    const primero = lock.withLock(clave, () => espera);
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(lock.withLock(clave, async () => {}), (e) => e.status === 423 && e.code === 'LOCK_OCUPADO');
    liberar();
    await primero;
    await lock.withLock(clave, async () => {}); // ya liberado: se puede tomar
  });
});

test('solo libera su propio lock: si expiró y otro lo tomó, no lo borra', async (t) => {
  await conRedis(t, async (client) => {
    const lock = createLockManager({ client, ttlMs: 100, logger: loggerSilencioso });
    const clave = `lock:test:ttl:${Date.now()}`;
    await lock.withLock(clave, async () => {
      await new Promise((r) => setTimeout(r, 250));        // el TTL (100 ms) expira acá
      await client.set(clave, 'token-de-otro', { PX: 5000 }); // otro pedido toma el lock
    });                                                       // al salir NO debe borrar el de otro
    assert.equal(await client.get(clave), 'token-de-otro');
    await client.del(clave);
  });
});

test('el lock expira solo (TTL) si el proceso se cae sin liberarlo', async (t) => {
  await conRedis(t, async (client) => {
    const clave = `lock:test:caida:${Date.now()}`;
    await client.set(clave, 'huérfano', { NX: true, PX: 100 }); // simula un lock que quedó tomado
    const lock = createLockManager({ client, ttlMs: 1000, logger: loggerSilencioso });
    await assert.rejects(lock.withLock(clave, async () => {}), (e) => e.status === 423);
    await new Promise((r) => setTimeout(r, 200));
    await lock.withLock(clave, async () => {}); // ya expiró: se puede tomar
  });
});

test('si Redis no responde, se informa 503 REDIS_NO_DISPONIBLE', async () => {
  const client = createClient({ url: 'redis://127.0.0.1:6399', disableOfflineQueue: true, socket: { reconnectStrategy: false, connectTimeout: 300 } });
  client.on('error', () => {});
  const lock = createLockManager({ client, ttlMs: 1000, logger: loggerSilencioso });
  await assert.rejects(lock.withLock('lock:x', async () => {}), (e) => e.status === 503 && e.code === 'REDIS_NO_DISPONIBLE');
});

test('concurrencia real: 30 pedidos con Redis nunca venden de más', async (t) => {
  await conRedis(t, async (client) => {
    const { createAforoService } = require('../src/services/aforo.service');
    const fakes = require('./helpers/fakes');
    const lock = createLockManager({ client, ttlMs: 5000, logger: loggerSilencioso });
    const eventosRepo = fakes.crearEventosRepoFake();
    const movimientosRepo = fakes.crearMovimientosRepoFake();
    const aforo = createAforoService({ eventosRepo, movimientosRepo, lock, logger: loggerSilencioso });
    const evento = await eventosRepo.crear({ nombre: 'E', fecha: new Date(Date.now() + 1e9), lugar: 'L', precio: 1, aforoTotal: 5, disponibles: 5, estado: 'PUBLICADO' });
    const rs = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => aforo.reservar(evento.id, { cantidad: 1, referencia: `o${i}` })));
    const ok = rs.filter((r) => r.status === 'fulfilled').length;
    const final = await eventosRepo.buscarPorId(evento.id);
    assert.ok(ok <= 5);
    assert.equal(final.disponibles, 5 - ok);
    assert.ok(final.disponibles >= 0);
  });
});
