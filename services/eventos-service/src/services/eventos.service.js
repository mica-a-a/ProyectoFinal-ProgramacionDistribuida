const { AppError } = require('../config/errors');
const { validarId, validarCrear, validarActualizar } = require('./eventos.validation');
const { claveLock } = require('./aforo.service');

const ESTADOS_NO_MODIFICABLES = ['CANCELADO', 'FINALIZADO'];

// Gestión de eventos. Toda operación que cambia el estado o el aforo toma el MISMO lock
// por evento que usa la reserva, así nunca se pisan entre sí.
function createEventosService({ eventosRepo, lock, logger, now = () => new Date() }) {
  // Calculados por el servicio para que otros servicios no repliquen la regla:
  //  - vigente: el evento no fue cancelado ni finalizado (sirve para validar el ingreso)
  //  - vendible: se puede reservar aforo ahora mismo
  function presentar(evento) {
    return {
      ...evento,
      vigente: evento.estado === 'PUBLICADO' || evento.estado === 'AGOTADO',
      vendible: evento.estado === 'PUBLICADO' && new Date(evento.fecha) > now(),
    };
  }

  async function obtenerOFallar(id) {
    const evento = await eventosRepo.buscarPorId(id);
    if (!evento) throw new AppError(404, 'Evento no encontrado', 'EVENTO_NO_ENCONTRADO');
    return evento;
  }

  async function crear(body) {
    const datos = validarCrear(body, now());
    const evento = await eventosRepo.crear({ ...datos, disponibles: datos.aforoTotal, estado: 'PUBLICADO' });
    logger.info('evento creado', { eventoId: evento.id, aforoTotal: evento.aforoTotal });
    return presentar(evento);
  }

  async function listar({ estado } = {}) {
    if (estado !== undefined && !['PUBLICADO', 'AGOTADO', 'CANCELADO', 'FINALIZADO'].includes(estado)) {
      throw new AppError(400, 'estado inválido', 'VALIDACION');
    }
    const eventos = await eventosRepo.listar(estado ? { estado } : {});
    return eventos.map(presentar);
  }

  async function obtener(id) {
    validarId(id);
    return presentar(await obtenerOFallar(id));
  }

  async function actualizar(id, body) {
    validarId(id);
    const cambios = validarActualizar(body, now());

    return lock.withLock(claveLock(id), async () => {
      const evento = await obtenerOFallar(id);
      if (ESTADOS_NO_MODIFICABLES.includes(evento.estado)) {
        throw new AppError(409, `Un evento ${evento.estado} no puede modificarse`, 'EVENTO_NO_MODIFICABLE');
      }

      if (cambios.aforoTotal !== undefined) {
        const vendidos = evento.aforoTotal - evento.disponibles;
        if (cambios.aforoTotal < vendidos) {
          throw new AppError(409, `El aforo no puede ser menor a lo ya vendido (${vendidos})`, 'AFORO_MENOR_A_VENDIDO');
        }
        cambios.disponibles = cambios.aforoTotal - vendidos;
        cambios.estado = cambios.disponibles === 0 ? 'AGOTADO' : 'PUBLICADO';
      }

      const actualizado = await eventosRepo.actualizar(id, cambios);
      logger.info('evento modificado', { eventoId: id, campos: Object.keys(cambios) });
      return presentar(actualizado);
    });
  }

  async function cancelar(id) {
    validarId(id);
    return lock.withLock(claveLock(id), async () => {
      const evento = await obtenerOFallar(id);
      if (evento.estado === 'CANCELADO') return presentar(evento); // idempotente
      if (evento.estado === 'FINALIZADO') {
        throw new AppError(409, 'No se puede cancelar un evento FINALIZADO', 'TRANSICION_INVALIDA');
      }
      const actualizado = await eventosRepo.actualizar(id, { estado: 'CANCELADO' });
      logger.info('evento cancelado', { eventoId: id });
      return presentar(actualizado);
    });
  }

  async function finalizar(id) {
    validarId(id);
    return lock.withLock(claveLock(id), async () => {
      const evento = await obtenerOFallar(id);
      if (evento.estado === 'FINALIZADO') return presentar(evento); // idempotente
      if (evento.estado === 'CANCELADO') {
        throw new AppError(409, 'No se puede finalizar un evento CANCELADO', 'TRANSICION_INVALIDA');
      }
      if (new Date(evento.fecha) > now()) {
        throw new AppError(409, 'El evento todavía no ocurrió', 'TRANSICION_INVALIDA');
      }
      const actualizado = await eventosRepo.actualizar(id, { estado: 'FINALIZADO' });
      logger.info('evento finalizado', { eventoId: id });
      return presentar(actualizado);
    });
  }

  return { crear, listar, obtener, actualizar, cancelar, finalizar };
}

module.exports = { createEventosService };
