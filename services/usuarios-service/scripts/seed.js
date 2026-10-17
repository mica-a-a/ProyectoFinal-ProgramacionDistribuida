const mongoose = require('mongoose');
require('dotenv').config();
const Usuario = require('../src/models/Usuario');

const usuarios = [
  { _id: '64b000000000000000000001', nombre: 'Lucía', apellido: 'Fernández', email: 'lucia.fernandez@example.com', dni: '30123456', fechaNacimiento: '1990-05-14', direccion: 'San Martín 123, Mendoza', activo: true },
  { _id: '64b000000000000000000002', nombre: 'Martín', apellido: 'Gómez', email: 'martin.gomez@example.com', dni: '28456789', fechaNacimiento: '1985-11-02', direccion: 'Belgrano 450, Las Heras', activo: true },
  { _id: '64b000000000000000000003', nombre: 'Sofía', apellido: 'Rossi', email: 'sofia.rossi@example.com', dni: '40111222', fechaNacimiento: '1998-03-27', direccion: '', activo: true },
  { _id: '64b000000000000000000004', nombre: 'Diego', apellido: 'Paz', email: 'diego.paz@example.com', dni: '25999888', fechaNacimiento: '1978-08-09', direccion: 'Mitre 77, Godoy Cruz', activo: false },
  { _id: '64b000000000000000000005', nombre: 'Valentina', apellido: 'Sosa', email: 'valentina.sosa@example.com', dni: '42333444', fechaNacimiento: '2001-12-31', direccion: 'Rivadavia 900, Mendoza', activo: true },
];

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('Falta MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await Usuario.init();
  await Usuario.deleteMany({});
  await Usuario.insertMany(usuarios.map((u) => ({ ...u, fechaNacimiento: new Date(u.fechaNacimiento) })));
  console.log(`Seed OK: ${usuarios.length} usuarios (1 inactivo: Diego Paz)`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Seed falló:', err.message);
  process.exit(1);
});
