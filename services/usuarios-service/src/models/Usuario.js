const mongoose = require('mongoose');
const usuarioSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    apellido: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    dni: { type: String, required: true, unique: true, trim: true },
    fechaNacimiento: { type: Date, required: true },
    direccion: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        ret.fechaNacimiento = doc.fechaNacimiento.toISOString().slice(0, 10);
        return ret;
      },
    },
  }
);

// La edad se calcula, no se guarda (reemplaza al campo `edad` de la app base).
function calcularEdad(fechaNacimiento, hoy = new Date()) {
  let edad = hoy.getUTCFullYear() - fechaNacimiento.getUTCFullYear();
  const meses = hoy.getUTCMonth() - fechaNacimiento.getUTCMonth();
  if (meses < 0 || (meses === 0 && hoy.getUTCDate() < fechaNacimiento.getUTCDate())) edad -= 1;
  return edad;
}

usuarioSchema.virtual('edad').get(function edad() {
  return this.fechaNacimiento ? calcularEdad(this.fechaNacimiento) : undefined;
});

module.exports = mongoose.model('Usuario', usuarioSchema);
module.exports.calcularEdad = calcularEdad;
