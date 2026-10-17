const { AppError } = require('../config/errors');
const { validarId, validarMovimiento } = require('./eventos.validation');

const claveLock = (eventoId) => `lock:evento:${eventoId}`;

// Reglas de aforo. Es el ÚNICO lugar donde se decide si se puede reservar o liberar lugares.
//
// Orden de las operaciones (pensado para que, ante una caída a mitad de camino, el sistema
// quede del lado seguro: se puede vender DE MENOS, nunca de más):
//   reservar: 1) descuento atómico condicional  2) registrar el movimiento
//   liberar:  1) registrar el movimiento        2) sumar de vuelta
function createAforoService({ eventosRepo, movimientosRepo, lock, logger, now = () => new Date() }) {
  async function motivoDeRechazo(eventoId, cantidad) {
    const evento = await eventosRepo.buscarPorId(eventoId);
    if (!evento) return new AppError(404, 'Evento no encontrado', 'EVENTO_NO_ENCONTRADO');
    if (evento.estado === 'AGOTADO') return new AppError(409, 'No hay lugares disponibles', 'SIN_AFORO');
    if (evento.estado !== 'PUBLICADO') {
      return new AppError(409, `El evento no está a la venta (estado ${evento.estado})`, 'EVENTO_NO_VENDIBLE');
    }
    if (new Date(evento.fecha) <= now()) return new AppError(409, 'El evento ya ocurrió', 'EVENTO_NO_VENDIBLE');
    return new AppError(409, `No hay lugares suficientes (disponibles: ${evento.disponibles})`, 'SIN_AFORO');
  }

  async function reservar(eventoId, body) {
    validarId(eventoId);
    const { cantidad, referencia } = validarMovimiento(body);

    return lock.withLock(claveLock(eventoId), async () => {
      // Idempotencia: si esta referencia ya reservó, se devuelve el mismo resultado sin volver a descontar.
      const previo = await movimientosRepo.buscar({ eventoId, referencia, tipo: 'RESERVA' });
      if (previo) {
        if (previo.cantidad !== cantidad) {
          throw new AppError(409, 'La referencia ya fue usada con otra cantidad', 'REFERENCIA_CONFLICTIVA');
        }
        const evento = await eventosRepo.buscarPorId(eventoId);
        logger.info('reserva repetida, sin cambios', { eventoId, referencia });
        return { reservado: true, disponibles: evento.disponibles, idempotente: true };
      }

      const actualizado = await eventosRepo.reservarCupo(eventoId, cantidad, now());
      if (!actualizado) throw await motivoDeRechazo(eventoId, cantidad);

      let final = actualizado;
      if (actualizado.disponibles === 0) final = (await eventosRepo.marcarAgotado(eventoId)) || actualizado;

      try {
        await movimientosRepo.crear({ eventoId, referencia, tipo: 'RESERVA', cantidad });
      } catch (err) {
        // No se pudo registrar: se deshace el descuento para no perder lugares.
        await eventosRepo.devolverCupo(eventoId, cantidad);
        await eventosRepo.reabrir(eventoId);
        logger.error('no se pudo registrar el movimiento; se revirtió el descuento', { eventoId, referencia, cause: err.name });
        throw err;
      }

      logger.info('aforo reservado', { eventoId, referencia, cantidad, disponibles: final.disponibles });
      return { reservado: true, disponibles: final.disponibles, idempotente: false };
    });
  }

  async function liberar(eventoId, body) {
    validarId(eventoId);
    const { cantidad, referencia } = validarMovimiento(body);

    return lock.withLock(claveLock(eventoId), async () => {
      const evento = await eventosRepo.buscarPorId(eventoId);
      if (!evento) throw new AppError(404, 'Evento no encontrado', 'EVENTO_NO_ENCONTRADO');

      const yaLiberado = await movimientosRepo.buscar({ eventoId, referencia, tipo: 'LIBERACION' });
      if (yaLiberado) {
        logger.info('liberación repetida, sin cambios', { eventoId, referencia });
        return { liberado: true, disponibles: evento.disponibles, idempotente: true };
      }

      const reserva = await movimientosRepo.buscar({ eventoId, referencia, tipo: 'RESERVA' });
      if (!reserva) {
        // Nada que devolver (por ejemplo, la reserva nunca llegó a aplicarse): no se suma nada.
        logger.warn('liberación sin reserva previa', { eventoId, referencia });
        return { liberado: false, motivo: 'SIN_RESERVA', disponibles: evento.disponibles, idempotente: false };
      }
      if (reserva.cantidad !== cantidad) {
        throw new AppError(409, 'La cantidad no coincide con la reservada', 'CANTIDAD_INCONSISTENTE');
      }

      await movimientosRepo.crear({ eventoId, referencia, tipo: 'LIBERACION', cantidad });
      try {
        let actualizado = await eventosRepo.devolverCupo(eventoId, cantidad);
        if (!actualizado) throw new AppError(409, 'Liberar superaría el aforo total', 'AFORO_INCONSISTENTE');
        if (actualizado.estado === 'AGOTADO' && actualizado.disponibles > 0) {
          actualizado = (await eventosRepo.reabrir(eventoId)) || actualizado;
        }
        logger.info('aforo liberado', { eventoId, referencia, cantidad, disponibles: actualizado.disponibles });
        return { liberado: true, disponibles: actualizado.disponibles, idempotente: false };
      } catch (err) {
        await movimientosRepo.eliminar({ eventoId, referencia, tipo: 'LIBERACION' });
        throw err;
      }
    });
  }

  return { reservar, liberar };
}

module.exports = { createAforoService, claveLock };
