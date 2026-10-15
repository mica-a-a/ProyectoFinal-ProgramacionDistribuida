const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        nombre: {
            type: String,
            required: [true, 'El nombre es obligatorio'],
            trim: true,
            minlength: [2, 'El nombre debe tener al menos 2 caracteres']
        },

        apellido: {
            type: String,
            required: [true, 'El apellido es obligatorio'],
            trim: true,
            minlength: [2, 'El apellido debe tener al menos 2 caracteres']
        },

        email: {
            type: String,
            required: [true, 'El email es obligatorio'],
            unique: true,
            trim: true,
            lowercase: true,
            match: [
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                'El email no tiene un formato válido'
            ]
        },

        edad: {
            type: Number,
            required: [true, 'La edad es obligatoria'],
            min: [1, 'La edad debe ser mayor a 0'],
            validate: {
                validator: Number.isInteger,
                message: 'La edad debe ser un número entero'
            }
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('User', userSchema);