const logger = require('../config/logger');
const { AppError } = require('../config/errors');
const Orden = require('../models/Orden');
const Ticket = require('../models/Ticket');
const eventosClient = require('../clients/eventos.client');
const { toAppError } = require('./remoteErrors');

const plano = (doc) => (doc && typeof doc.toJSON === 'function' ? doc.toJSON() : doc);

// Lista los tickets de un usuario (de todas sus órdenes, con su estado actual).
async function listarEntradas(usuarioId) {
  if (usuarioId === undefined || String(usuarioId).trim() === '') {
    throw new AppError(400, 'usuarioId es obligatorio', 'DATOS_INVALIDOS');
  }
  const id = String(usuarioId).trim();
  const ordenes = await Orden.find({ usuarioId: id });
  if (ordenes.length === 0) return [];
  const porId = new Map(ordenes.map((o) => [String(o._id), o]));
  const tickets = await Ticket.find({ ordenId: { $in: ordenes.map((o) => o._id) } });
  return tickets.map((t) => {
    const o = porId.get(String(t.ordenId));
    return { ...plano(t), ordenId: String(t.ordenId), usuarioId: o.usuarioId, eventoId: o.eventoId };
  });
}

// Valida un ticket en el ingreso (caso de uso 2, sección 8.2).
async function validarTicket(codigo) {
  if (typeof codigo !== 'string' || codigo.trim() === '') {
    throw new AppError(400, 'Falta el código del ticket', 'DATOS_INVALIDOS');
  }
  const codigoNormalizado = codigo.trim().toUpperCase();

  const ticket = await Ticket.findOne({ codigo: codigoNormalizado });
  if (!ticket) throw new AppError(404, 'Ticket inexistente', 'TICKET_NO_ENCONTRADO');
  const orden = await Orden.findById(ticket.ordenId);
  if (!orden) throw new AppError(500, 'El ticket no tiene una orden asociada', 'ERROR_INTERNO');

  // Eventos decide si el evento sigue vigente. Si no responde, se rechaza el ingreso (503).
  let evento;
  try {
    evento = await eventosClient.getEvento(orden.eventoId);
  } catch (err) {
    throw toAppError(err, { NOT_FOUND: { message: 'El evento del ticket no existe', code: 'EVENTO_NO_ENCONTRADO' } });
  }
  if (evento.vigente === false) {
    throw new AppError(422, 'El evento no está vigente', 'EVENTO_NO_VIGENTE');
  }

  // Uso único: actualización condicional y atómica VALIDO -> USADO.
  const usado = await Ticket.findOneAndUpdate(
    { codigo: codigoNormalizado, estado: 'VALIDO' },
    { estado: 'USADO', usadoEn: new Date() },
    { returnDocument: 'after' }
  );
  if (!usado) {
    const actual = await Ticket.findOne({ codigo: codigoNormalizado });
    throw new AppError(409, `El ticket ya no es válido (estado: ${actual.estado})`, 'TICKET_NO_VALIDO');
  }
  logger.info('ticket validado', { operacion: 'validarTicket', codigo: codigoNormalizado, ordenId: String(ticket.ordenId) });
  return { mensaje: 'Ingreso permitido', ticket: { ...plano(usado), ordenId: String(usado.ordenId), eventoId: orden.eventoId } };
}

module.exports = { listarEntradas, validarTicket };
