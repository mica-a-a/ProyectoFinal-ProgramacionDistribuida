const MovimientoAforo = require('../models/MovimientoAforo');

// Acceso a la colección de movimientos de aforo (solo la usa eventos-service).
function aPlano(doc) {
  if (!doc) return null;
  return { id: doc._id.toString(), eventoId: doc.eventoId.toString(), referencia: doc.referencia, tipo: doc.tipo, cantidad: doc.cantidad };
}

module.exports = {
  async buscar({ eventoId, referencia, tipo }) {
    return aPlano(await MovimientoAforo.findOne({ eventoId, referencia, tipo }).lean());
  },

  // Lanza el error E11000 de Mongo si (eventoId, referencia, tipo) ya existe.
  async crear({ eventoId, referencia, tipo, cantidad }) {
    return aPlano(await MovimientoAforo.create({ eventoId, referencia, tipo, cantidad }));
  },

  async eliminar({ eventoId, referencia, tipo }) {
    await MovimientoAforo.deleteOne({ eventoId, referencia, tipo });
  },
};
