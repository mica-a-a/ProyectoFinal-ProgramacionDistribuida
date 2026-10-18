const { createAforoService } = require('../../src/services/aforo.service');
const { createEventosService } = require('../../src/services/eventos.service');
const { createEventosController } = require('../../src/controllers/eventos.controller');
const { createHealthController } = require('../../src/controllers/health.controller');
const { createApp } = require('../../src/app');
const fakes = require('./fakes');

const DIA = 24 * 60 * 60 * 1000;

function armar({ lock = fakes.crearLockFake(), ahora = () => new Date(), readiness } = {}) {
  const eventosRepo = fakes.crearEventosRepoFake();
  const movimientosRepo = fakes.crearMovimientosRepoFake();
  const logger = fakes.loggerSilencioso;
  const aforoService = createAforoService({ eventosRepo, movimientosRepo, lock, logger, now: ahora });
  const eventosService = createEventosService({ eventosRepo, lock, logger, now: ahora });
  const app = createApp({
    eventosController: createEventosController({ eventosService, aforoService }),
    healthController: createHealthController({ readiness: readiness || (() => ({ mongodb: true, redis: true })) }),
  });
  return { eventosRepo, movimientosRepo, aforoService, eventosService, app };
}

const datosEvento = (extra = {}) => ({
  nombre: 'Taller de Node.js', fecha: new Date(Date.now() + 30 * DIA).toISOString(),
  lugar: 'Aula Magna', precio: 5000, aforoTotal: 5, ...extra,
});

module.exports = { armar, datosEvento, DIA };
