const Evento = require('../models/Evento');

// Acceso a la colección `eventos` (base propia de este servicio).
// Devuelve objetos planos con `id` (string), sin exponer detalles de Mongoose.
function aPlano(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    nombre: doc.nombre,
    fecha: doc.fecha,
    lugar: doc.lugar,
    precio: doc.precio,
    aforoTotal: doc.aforoTotal,
    disponibles: doc.disponibles,
    estado: doc.estado,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const NUEVO = { new: true };

module.exports = {
  async crear(datos) {
    const doc = await Evento.create(datos);
    return aPlano(doc);
  },

  async listar(filtro = {}) {
    const docs = await Evento.find(filtro).sort({ fecha: 1 }).lean();
    return docs.map(aPlano);
  },

  async buscarPorId(id) {
    return aPlano(await Evento.findById(id).lean());
  },

  async actualizar(id, cambios) {
    return aPlano(await Evento.findByIdAndUpdate(id, { $set: cambios }, { ...NUEVO, runValidators: true }).lean());
  },

  // Descuento ATÓMICO y condicional: solo si el evento está PUBLICADO, es futuro y alcanza el aforo.
  // Es la segunda defensa (además del lock): aunque dos pedidos se colaran, Mongo nunca deja
  // `disponibles` por debajo de 0.
  async reservarCupo(id, cantidad, ahora) {
    const doc = await Evento.findOneAndUpdate(
      { _id: id, estado: 'PUBLICADO', fecha: { $gt: ahora }, disponibles: { $gte: cantidad } },
      { $inc: { disponibles: -cantidad } },
      NUEVO
    ).lean();
    return aPlano(doc);
  },

  async marcarAgotado(id) {
    const doc = await Evento.findOneAndUpdate(
      { _id: id, estado: 'PUBLICADO', disponibles: 0 },
      { $set: { estado: 'AGOTADO' } },
      NUEVO
    ).lean();
    return aPlano(doc);
  },

  // Suma de vuelta, sin superar nunca el aforo total. Devuelve null si superaría.
  async devolverCupo(id, cantidad) {
    const doc = await Evento.findOneAndUpdate(
      { _id: id, $expr: { $lte: [{ $add: ['$disponibles', cantidad] }, '$aforoTotal'] } },
      { $inc: { disponibles: cantidad } },
      NUEVO
    ).lean();
    return aPlano(doc);
  },

  // Vuelve de AGOTADO a PUBLICADO cuando se liberó lugar.
  async reabrir(id) {
    const doc = await Evento.findOneAndUpdate(
      { _id: id, estado: 'AGOTADO', disponibles: { $gt: 0 } },
      { $set: { estado: 'PUBLICADO' } },
      NUEVO
    ).lean();
    return aPlano(doc);
  },
};
