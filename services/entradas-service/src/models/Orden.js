const mongoose = require('mongoose');

// Orden de compra. Guarda usuarioId y eventoId solo como REFERENCIAS LÓGICAS:
// los datos de esas entidades pertenecen a usuarios-service y eventos-service.
const ESTADOS = ['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'RECHAZADA'];

const ordenSchema = new mongoose.Schema(
  {
    usuarioId: { type: String, required: [true, 'usuarioId es obligatorio'], trim: true },
    eventoId: { type: String, required: [true, 'eventoId es obligatorio'], trim: true },
    cantidad: {
      type: Number,
      required: [true, 'cantidad es obligatoria'],
      min: [1, 'cantidad debe ser al menos 1'],
      validate: { validator: Number.isInteger, message: 'cantidad debe ser un entero' },
    },
    // Se congela al comprar: si el precio del evento cambia después, la orden no cambia.
    precioUnitario: { type: Number, min: 0, default: null },
    estado: { type: String, enum: ESTADOS, default: 'PENDIENTE' },
    motivoRechazo: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'fechaCreacion', updatedAt: 'fechaActualizacion' },
    versionKey: false,
  }
);

ordenSchema.index({ usuarioId: 1, eventoId: 1, estado: 1 });

// El _id de Mongo se expone como "id", igual que en el resto de los servicios.
ordenSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Orden', ordenSchema);
module.exports.ESTADOS = ESTADOS;
