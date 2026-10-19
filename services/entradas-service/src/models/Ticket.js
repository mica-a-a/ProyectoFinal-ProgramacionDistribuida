const mongoose = require('mongoose');

// Ticket de uso único. Se pasa de VALIDO a USADO con una actualización condicional.
// ANULADO: el ticket pertenece a una orden cancelada.
const ESTADOS = ['VALIDO', 'USADO', 'ANULADO'];

const ticketSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, unique: true, trim: true },
    ordenId: { type: mongoose.Schema.Types.ObjectId, ref: 'Orden', required: true, index: true },
    estado: { type: String, enum: ESTADOS, default: 'VALIDO' },
    usadoEn: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'fechaCreacion', updatedAt: 'fechaActualizacion' }, versionKey: false }
);

ticketSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Ticket', ticketSchema);
module.exports.ESTADOS = ESTADOS;
