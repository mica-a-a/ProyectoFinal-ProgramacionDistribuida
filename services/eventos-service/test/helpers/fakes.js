const { randomBytes } = require('crypto');

// Versiones en memoria de los repositorios y del lock, con la MISMA semántica que las reales
// (descuento atómico y condicional, índice único de movimientos, SET NX). Permiten probar las
// reglas de negocio sin MongoDB. Cada operación cede el control (await) para que las pruebas de
// concurrencia realmente intercalen los pedidos.
const tick = () => new Promise((resolve) => setImmediate(resolve));
const nuevoId = () => randomBytes(12).toString('hex');

function crearEventosRepoFake() {
  const eventos = new Map();
  const copia = (e) => (e ? { ...e } : null);

  return {
    _eventos: eventos,
    async crear(datos) {
      await tick();
      const e = { id: nuevoId(), createdAt: new Date(), updatedAt: new Date(), ...datos };
      eventos.set(e.id, e);
      return copia(e);
    },
    async listar(filtro = {}) {
      await tick();
      return [...eventos.values()].filter((e) => !filtro.estado || e.estado === filtro.estado).map(copia);
    },
    async buscarPorId(id) { await tick(); return copia(eventos.get(id)); },
    async actualizar(id, cambios) {
      await tick();
      const e = eventos.get(id);
      if (!e) return null;
      Object.assign(e, cambios, { updatedAt: new Date() });
      return copia(e);
    },
    async reservarCupo(id, cantidad, ahora) {
      await tick();
      const e = eventos.get(id);
      if (!e || e.estado !== 'PUBLICADO' || !(new Date(e.fecha) > ahora) || e.disponibles < cantidad) return null;
      e.disponibles -= cantidad;
      return copia(e);
    },
    async marcarAgotado(id) {
      await tick();
      const e = eventos.get(id);
      if (!e || e.estado !== 'PUBLICADO' || e.disponibles !== 0) return null;
      e.estado = 'AGOTADO';
      return copia(e);
    },
    async devolverCupo(id, cantidad) {
      await tick();
      const e = eventos.get(id);
      if (!e || e.disponibles + cantidad > e.aforoTotal) return null;
      e.disponibles += cantidad;
      return copia(e);
    },
    async reabrir(id) {
      await tick();
      const e = eventos.get(id);
      if (!e || e.estado !== 'AGOTADO' || e.disponibles <= 0) return null;
      e.estado = 'PUBLICADO';
      return copia(e);
    },
  };
}

function crearMovimientosRepoFake() {
  const movimientos = new Map();
  const clave = ({ eventoId, referencia, tipo }) => `${eventoId}|${referencia}|${tipo}`;
  return {
    _movimientos: movimientos,
    async buscar(k) { await tick(); const m = movimientos.get(clave(k)); return m ? { ...m } : null; },
    async crear(m) {
      await tick();
      if (movimientos.has(clave(m))) { const err = new Error('E11000 duplicate key'); err.code = 11000; throw err; }
      movimientos.set(clave(m), { id: nuevoId(), ...m });
      return { ...m };
    },
    async eliminar(k) { await tick(); movimientos.delete(clave(k)); },
  };
}

// Lock en memoria con semántica SET NX (una sola clave tomada a la vez).
function crearLockFake() {
  const { AppError } = require('../../src/config/errors');
  const tomados = new Set();
  return {
    async withLock(clave, fn) {
      if (tomados.has(clave)) throw new AppError(423, 'El evento está siendo modificado, intentá nuevamente', 'LOCK_OCUPADO');
      tomados.add(clave);
      try { return await fn(); } finally { tomados.delete(clave); }
    },
  };
}

const loggerSilencioso = { info() {}, warn() {}, error() {} };

module.exports = { crearEventosRepoFake, crearMovimientosRepoFake, crearLockFake, loggerSilencioso, nuevoId };
