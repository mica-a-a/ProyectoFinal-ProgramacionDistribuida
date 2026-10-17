// Datos de prueba reproducibles. Es idempotente: se puede correr varias veces.
//   Local:   npm run seed
//   Docker:  docker compose exec eventos-service npm run seed
const mongoose = require('mongoose');
const config = require('../src/config/config');
const Evento = require('../src/models/Evento');

const DIA = 24 * 60 * 60 * 1000;
const en = (dias) => new Date(Date.now() + dias * DIA);

const eventos = [
  { nombre: 'Taller de Node.js', fecha: en(30), lugar: 'Aula Magna UCH', precio: 5000, aforoTotal: 5, disponibles: 5, estado: 'PUBLICADO' },
  { nombre: 'Recital de Aniversario', fecha: en(45), lugar: 'Teatro Independencia', precio: 15000, aforoTotal: 100, disponibles: 100, estado: 'PUBLICADO' },
  { nombre: 'Charla de Microservicios', fecha: en(20), lugar: 'Sala 2', precio: 0, aforoTotal: 30, disponibles: 0, estado: 'AGOTADO' },
  { nombre: 'Meetup cancelado', fecha: en(15), lugar: 'Sala 3', precio: 1000, aforoTotal: 20, disponibles: 20, estado: 'CANCELADO' },
  { nombre: 'Jornada ya realizada', fecha: en(-10), lugar: 'Auditorio', precio: 2000, aforoTotal: 40, disponibles: 12, estado: 'FINALIZADO' },
];

async function main() {
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 });
  for (const e of eventos) {
    await Evento.updateOne({ nombre: e.nombre }, { $set: e }, { upsert: true });
  }
  console.log(`Seed aplicado: ${eventos.length} eventos en ${mongoose.connection.name}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('No se pudo aplicar el seed:', err.message);
  process.exit(1);
});
