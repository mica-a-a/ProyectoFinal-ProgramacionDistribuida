const mongoose = require('mongoose');

const reservaSchema = new mongoose.Schema(
    {
        nombre: {
            type: String,
            required: true,
            trim: true
        },

        disponibles: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isInteger,
                message: 'Los disponibles deben ser un número entero'
            }
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('Reserva', reservaSchema);