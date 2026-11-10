const crypto = require('crypto');
const config = require('../config/config');
const logger = require('../config/logger');
const { AppError } = require('../config/errors');
const Orden = require('../models/Orden');
const Ticket = require('../models/Ticket');
const usuariosClient = require('../clients/usuarios.client');
const eventosClient = require('../clients/eventos.client');
const { RemoteServiceError } = require('../clients/httpClient');
const { toAppError, esIncierto } = require('./remoteErrors');

// 423 de Eventos = lock ocupado: no se aplicó nada, se puede reintentar.
const LOCK_INTENTOS = 3;
const LOCK_ESPERA_MS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OBJECT_ID = /^[a-f\d]{24}$/i;
const plano = (doc) => (doc && typeof doc.toJSON === 'function' ? doc.toJSON() : doc);
const genCodigo = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

function normalizarId(valor, nombre) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor === 'string' && valor.trim() !== '' && valor.trim().length <= 64) return valor.trim();
  throw new AppError(400, `${nombre} es obligatorio y debe ser un identificador válido`, 'DATOS_INVALIDOS');
}

function validarIdOrden(id) {
  if (!OBJECT_ID.test(String(id))) throw new AppError(400, 'El id de la orden no es válido', 'ID_INVALIDO');
}

// Pide reservar/liberar aforo reintentando solo cuando Eventos informa lock ocupado (423).
async function conReintentoLock(operacion) {
  for (let intento = 1; ; intento += 1) {
    try {
      return await operacion();
    } catch (err) {
      const ocupado = err instanceof RemoteServiceError && err.kind === 'LOCKED';
      if (!ocupado || intento >= LOCK_INTENTOS) throw err;
      logger.warn('aforo ocupado, se reintenta', { dependency: 'eventos-service', intento });
      await sleep(LOCK_ESPERA_MS);
    }
  }
}

async function marcarRechazada(orden, motivo) {
  try {
    await Orden.findByIdAndUpdate(orden._id, { estado: 'RECHAZADA', motivoRechazo: motivo }, { returnDocument: 'after' });
  } catch (err) {
    logger.error('no se pudo marcar la orden como rechazada', { ordenId: String(orden._id), message: err.message });
  }
}

// -------------------------------------------------------------------
// Comprar entradas (caso de uso 1 del TP5, sección 8.1)
// -------------------------------------------------------------------
// `ctx` = token de usuario: se propaga en consultas. Eventos usa credencial técnica para modificar aforo.
async function crearOrden(body = {}, ctx = {}) {
  const usuarioId = normalizarId(body.usuarioId, 'usuarioId');
  const eventoId = normalizarId(body.eventoId, 'eventoId');
  const { cantidad } = body;
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new AppError(400, 'cantidad debe ser un entero mayor o igual a 1', 'DATOS_INVALIDOS');
  }

  // 1) La orden nace PENDIENTE: su id es la clave de idempotencia ("referencia") hacia Eventos.
  const orden = await Orden.create({ usuarioId, eventoId, cantidad });
  const ordenId = String(orden._id);
  logger.info('orden creada', { operacion: 'crearOrden', ordenId, usuarioId, eventoId, cantidad });

  // Rechazo sin efectos secundarios: la orden queda RECHAZADA y se informa el motivo.
  const rechazar = async (appError) => {
    await marcarRechazada(orden, appError.code);
    logger.warn('orden rechazada', { operacion: 'crearOrden', ordenId, motivo: appError.code, status: appError.status });
    throw appError;
  };

  // 2) Usuarios decide si el usuario existe y está activo.
  let usuario;
  try {
    usuario = await usuariosClient.getUsuario(usuarioId, ctx);
  } catch (err) {
    return rechazar(toAppError(err, { NOT_FOUND: { message: 'Usuario no encontrado', code: 'USUARIO_NO_ENCONTRADO' } }));
  }
  if (usuario && usuario.activo === false) {
    return rechazar(new AppError(409, 'El usuario está inactivo', 'USUARIO_INACTIVO'));
  }

  // 3) Eventos informa precio y datos del evento.
  let evento;
  try {
    evento = await eventosClient.getEvento(eventoId, ctx);
  } catch (err) {
    return rechazar(toAppError(err, { NOT_FOUND: { message: 'Evento no encontrado', code: 'EVENTO_NO_ENCONTRADO' } }));
  }
  if (!evento || typeof evento.precio !== 'number' || evento.precio < 0) {
    return rechazar(new AppError(502, 'eventos-service devolvió un evento sin precio válido', 'RESPUESTA_REMOTA_INVALIDA'));
  }

  // 4) Regla propia de Entradas: máximo de entradas por usuario y evento.
  //    Cuentan las órdenes confirmadas y las pendientes (pueden tener aforo ya reservado).
  const previas = await Orden.find({
    usuarioId, eventoId, estado: { $in: ['PENDIENTE', 'CONFIRMADA'] }, _id: { $ne: orden._id },
  });
  const yaTiene = previas.reduce((acc, o) => acc + o.cantidad, 0);
  if (yaTiene + cantidad > config.maxEntradasPorUsuario) {
    return rechazar(new AppError(
      409,
      `Máximo ${config.maxEntradasPorUsuario} entradas por usuario y evento (ya tiene ${yaTiene})`,
      'MAXIMO_ENTRADAS_EXCEDIDO'
    ));
  }
  await Orden.findByIdAndUpdate(orden._id, { precioUnitario: evento.precio }, { returnDocument: 'after' });

  // 5) Eventos (único dueño del aforo) reserva los lugares. Idempotente por referencia.
  try {
    await conReintentoLock(() => eventosClient.reservarAforo(eventoId, { cantidad, referencia: ordenId }));
  } catch (err) {
    if (esIncierto(err)) {
      // No sabemos si Eventos llegó a descontar: la orden queda PENDIENTE para poder recuperarla.
      logger.error('reserva de aforo incierta, la orden queda PENDIENTE', {
        operacion: 'crearOrden', ordenId, dependency: err.service, kind: err.kind,
      });
      throw new AppError(503, `${err.service} no respondió; la orden quedó PENDIENTE`, 'ORDEN_PENDIENTE', { ordenId, estado: 'PENDIENTE' });
    }
    return rechazar(toAppError(err, {
      NOT_FOUND: { message: 'Evento no encontrado', code: 'EVENTO_NO_ENCONTRADO' },
      CONFLICT: { code: 'SIN_AFORO' },
      LOCKED: { message: 'El evento está ocupado, intentá nuevamente', code: 'EVENTO_OCUPADO' },
    }));
  }

  // 6) Con el aforo reservado: se emiten los tickets y la orden pasa a CONFIRMADA.
  try {
    const tickets = await Ticket.insertMany(
      Array.from({ length: cantidad }, () => ({ codigo: genCodigo(), ordenId: orden._id }))
    );
    const confirmada = await Orden.findByIdAndUpdate(orden._id, { estado: 'CONFIRMADA' }, { returnDocument: 'after' });
    logger.info('orden confirmada', { operacion: 'crearOrden', ordenId, tickets: tickets.length });
    return { orden: plano(confirmada), tickets: tickets.map(plano) };
  } catch (err) {
    // Fallo parcial: el aforo ya fue descontado pero no se pudieron emitir los tickets.
    logger.error('falló la emisión de tickets, se intenta compensar el aforo', { ordenId, message: err.message });
    await Ticket.deleteMany({ ordenId: orden._id }).catch(() => {});
    try {
      await conReintentoLock(() => eventosClient.liberarAforo(eventoId, { cantidad, referencia: ordenId }));
      await marcarRechazada(orden, 'ERROR_EMISION_TICKETS');
      throw new AppError(500, 'No se pudieron emitir los tickets; el aforo fue devuelto', 'ERROR_INTERNO');
    } catch (compensacion) {
      if (compensacion instanceof AppError) throw compensacion;
      logger.error('no se pudo compensar el aforo: queda PENDIENTE para recuperación', { ordenId, message: compensacion.message });
      throw new AppError(500, 'No se pudieron emitir los tickets; la orden quedó PENDIENTE', 'ORDEN_PENDIENTE', { ordenId, estado: 'PENDIENTE' });
    }
  }
}

// -------------------------------------------------------------------
// Consultar una orden y sus tickets
// -------------------------------------------------------------------
async function obtenerOrden(id) {
  validarIdOrden(id);
  const orden = await Orden.findById(id);
  if (!orden) throw new AppError(404, 'Orden no encontrada', 'ORDEN_NO_ENCONTRADA');
  const tickets = await Ticket.find({ ordenId: orden._id });
  return { orden: plano(orden), tickets: tickets.map(plano) };
}

// -------------------------------------------------------------------
// Cancelar una orden (caso de uso adicional, sección 8.3)
// -------------------------------------------------------------------
async function cancelarOrden(id, ctx = {}) {
  validarIdOrden(id);
  const orden = await Orden.findById(id);
  if (!orden) throw new AppError(404, 'Orden no encontrada', 'ORDEN_NO_ENCONTRADA');
  const ordenId = String(orden._id);

  if (orden.estado === 'CANCELADA') return obtenerOrden(id); // idempotente
  if (orden.estado !== 'CONFIRMADA') {
    throw new AppError(409, `Solo se puede cancelar una orden confirmada (estado actual: ${orden.estado})`, 'ORDEN_NO_CANCELABLE');
  }

  // Plazo: la fecha del evento la informa Eventos (fuente única).
  let evento;
  try {
    evento = await eventosClient.getEvento(orden.eventoId, ctx);
  } catch (err) {
    throw toAppError(err, { NOT_FOUND: { message: 'Evento no encontrado', code: 'EVENTO_NO_ENCONTRADO' } });
  }
  const horas = (new Date(evento && evento.fecha).getTime() - Date.now()) / 36e5;
  if (!Number.isFinite(horas)) {
    throw new AppError(502, 'eventos-service devolvió un evento sin fecha válida', 'RESPUESTA_REMOTA_INVALIDA');
  }
  if (horas < config.plazoCancelacionHoras) {
    throw new AppError(409, `Solo se puede cancelar hasta ${config.plazoCancelacionHoras} h antes del evento`, 'FUERA_DE_PLAZO');
  }

  // Primero se anulan los tickets (así nadie puede usarlos mientras se libera el aforo).
  const anulados = await Ticket.updateMany({ ordenId: orden._id, estado: 'VALIDO' }, { estado: 'ANULADO' });
  if (anulados.modifiedCount !== orden.cantidad) {
    await Ticket.updateMany({ ordenId: orden._id, estado: 'ANULADO' }, { estado: 'VALIDO' }); // revierte
    throw new AppError(409, 'La orden tiene entradas ya utilizadas', 'TICKETS_USADOS');
  }

  try {
    await conReintentoLock(() => eventosClient.liberarAforo(orden.eventoId, { cantidad: orden.cantidad, referencia: ordenId }));
  } catch (err) {
    // La cancelación queda pendiente de reintento: se restauran los tickets.
    await Ticket.updateMany({ ordenId: orden._id, estado: 'ANULADO' }, { estado: 'VALIDO' });
    logger.error('no se pudo liberar el aforo, la orden sigue CONFIRMADA', { operacion: 'cancelarOrden', ordenId, kind: err.kind });
    throw toAppError(err, { NOT_FOUND: { message: 'Evento no encontrado', code: 'EVENTO_NO_ENCONTRADO' } });
  }

  await Orden.findOneAndUpdate({ _id: orden._id, estado: 'CONFIRMADA' }, { estado: 'CANCELADA' }, { returnDocument: 'after' });
  logger.info('orden cancelada', { operacion: 'cancelarOrden', ordenId });
  return obtenerOrden(id);
}

module.exports = { crearOrden, obtenerOrden, cancelarOrden };
