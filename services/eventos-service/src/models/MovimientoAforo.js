const mongoose = require('mongoose');

// Registro de cada reserva/liberación de aforo. Sirve para la idempotencia:
// la misma (evento, referencia, tipo) no se aplica dos veces.
const movimientoSchema = new mongoose.Schema(
  {
    eventoId: { type: mongoose.Schema.Types.ObjectId, required: true },
    referencia: { type: String, required: true, trim: true }, // ordenId de entradas-service
    tipo: { type: String, enum: ['RESERVA', 'LIBERACION'], required: true },
    cantidad: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger } },
  },
  { timestamps: true, autoIndex: false }
);

// Segunda defensa de la idempotencia: aunque falle el chequeo previo, la base rechaza el duplicado.
movimientoSchema.index({ eventoId: 1, referencia: 1, tipo: 1 }, { unique: true });

module.exports = mongoose.model('MovimientoAforo', movimientoSchema);
