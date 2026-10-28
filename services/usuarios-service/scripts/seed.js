const mongoose = require('mongoose');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const Usuario = require('../src/models/Usuario');

const usuarios = [
  { _id: '64b000000000000000000001', nombre: 'Lucía', apellido: 'Fernández', email: 'lucia.fernandez@example.com', dni: '30123456', fechaNacimiento: '1990-05-14', direccion: 'San Martín 123, Mendoza', activo: true },
  { _id: '64b000000000000000000002', nombre: 'Martín', apellido: 'Gómez', email: 'martin.gomez@example.com', dni: '28456789', fechaNacimiento: '1985-11-02', direccion: 'Belgrano 450, Las Heras', activo: true },
  { _id: '64b000000000000000000003', nombre: 'Sofía', apellido: 'Rossi', email: 'sofia.rossi@example.com', dni: '40111222', fechaNacimiento: '1998-03-27', direccion: '', activo: true },
  { _id: '64b000000000000000000004', nombre: 'Diego', apellido: 'Paz', email: 'diego.paz@example.com', dni: '25999888', fechaNacimiento: '1978-08-09', direccion: 'Mitre 77, Godoy Cruz', activo: false },
  { _id: '64b000000000000000000005', nombre: 'Valentina', apellido: 'Sosa', email: 'valentina.sosa@example.com', dni: '42333444', fechaNacimiento: '2001-12-31', direccion: 'Rivadavia 900, Mendoza', activo: true },
];

// TP7: las contraseñas NO están en el código; vienen de variables de entorno (ver .env.example).
//   SEED_USER_PASSWORD   contraseña de los 5 usuarios de prueba (rol USER)
//   SEED_ADMIN_PASSWORD  contraseña del administrador de prueba (rol ADMIN)
const ADMIN = {
  _id: '64b000000000000000000006', nombre: 'Admin', apellido: 'Sistema', email: 'admin@example.com',
  dni: '10000001', fechaNacimiento: '1980-01-01', direccion: '', activo: true,
};

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('Falta MONGODB_URI');
    process.exit(1);
  }
  const { SEED_USER_PASSWORD, SEED_ADMIN_PASSWORD } = process.env;
  if (!SEED_USER_PASSWORD || SEED_USER_PASSWORD.length < 8 || !SEED_ADMIN_PASSWORD || SEED_ADMIN_PASSWORD.length < 8) {
    console.error('Definí SEED_USER_PASSWORD y SEED_ADMIN_PASSWORD (mínimo 8 caracteres) en el .env.');
    process.exit(1);
  }
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  const hashUsuarios = await bcrypt.hash(SEED_USER_PASSWORD, rounds);
  const hashAdmin = await bcrypt.hash(SEED_ADMIN_PASSWORD, rounds);
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await Usuario.init();
  await Usuario.deleteMany({});
  await Usuario.insertMany([
    ...usuarios.map((u) => ({ ...u, passwordHash: hashUsuarios, role: 'USER' })),
    { ...ADMIN, passwordHash: hashAdmin, role: 'ADMIN' },
  ].map((u) => ({ ...u, fechaNacimiento: new Date(u.fechaNacimiento) })));
  console.log(`Seed OK: ${usuarios.length} usuarios USER (1 inactivo: Diego Paz) + 1 ADMIN (${ADMIN.email})`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Seed falló:', err.message);
  process.exit(1);
});
