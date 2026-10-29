const mongoose = require('mongoose');

const ESTADOS = ['PUBLICADO', 'AGOTADO', 'CANCELADO', 'FINALIZADO'];
const esEntero = { validator: Number.isInteger, message: '{PATH} debe ser un número entero' };

const eventoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, minlength: 2 },
    fecha: { type: Date, required: true },
    lugar: { type: String, required: true, trim: true, minlength: 2 },
    precio: { type: Number, required: true, min: 0 },
    aforoTotal: { type: Number, required: true, min: 1, validate: esEntero },
    disponibles: {
      type: Number,
      required: true,
      min: 0,
      validate: [
        esEntero,
        {
          // Invariante: 0 <= disponibles <= aforoTotal
          validator(valor) {
            return valor <= this.aforoTotal;
          },
          message: 'disponibles no puede superar el aforo total',
        },
      ],
    },
    estado: { type: String, enum: ESTADOS, default: 'PUBLICADO', required: true },
  },
  { timestamps: true, autoIndex: false }
);

module.exports = mongoose.model('Evento', eventoSchema);
module.exports.ESTADOS = ESTADOS;
