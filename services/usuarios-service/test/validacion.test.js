const test = require('node:test');
const assert = require('node:assert');
const { validarUsuario, parseFecha } = require('../src/services/validacion');

const valido = {
  nombre: 'Lucía', apellido: 'Fernández', email: 'Lucia@Example.com',
  dni: '30123456', fechaNacimiento: '1990-05-14', direccion: ' Calle 1 ',
};
const HOY = new Date(Date.UTC(2026, 9, 16));

test('acepta un usuario válido y normaliza email, texto y fecha', () => {
  const { data, errors } = validarUsuario(valido, HOY);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(data.email, 'lucia@example.com');
  assert.strictEqual(data.direccion, 'Calle 1');
  assert.ok(data.fechaNacimiento instanceof Date);
});

test('la dirección es opcional', () => {
  const { direccion, ...sinDireccion } = valido;
  assert.deepStrictEqual(validarUsuario(sinDireccion, HOY).errors, []);
});

test('informa todos los campos obligatorios faltantes juntos', () => {
  const { errors } = validarUsuario({}, HOY);
  assert.strictEqual(errors.length, 5);
});

test('rechaza email, dni y nombre inválidos', () => {
  assert.ok(validarUsuario({ ...valido, email: 'no-es-mail' }, HOY).errors.length);
  assert.ok(validarUsuario({ ...valido, dni: '123' }, HOY).errors.length);
  assert.ok(validarUsuario({ ...valido, dni: '12.345.678' }, HOY).errors.length);
  assert.ok(validarUsuario({ ...valido, nombre: 'A' }, HOY).errors.length);
});

test('rechaza fechas inexistentes, mal formateadas o futuras', () => {
  assert.strictEqual(parseFecha('2024-02-31'), null);
  assert.strictEqual(parseFecha('14/05/1990'), null);
  assert.ok(validarUsuario({ ...valido, fechaNacimiento: '2999-01-01' }, HOY).errors.length);
  assert.ok(validarUsuario({ ...valido, fechaNacimiento: '1850-01-01' }, HOY).errors.length);
  assert.ok(parseFecha('2024-02-29')); // bisiesto válido
});

test('ignora id y activo enviados en el body (no se pueden setear desde afuera)', () => {
  const { data } = validarUsuario({ ...valido, id: 'x', _id: 'y', activo: false }, HOY);
  assert.ok(!('id' in data) && !('_id' in data) && !('activo' in data));
});

test('rechaza un body que no es un objeto', () => {
  assert.ok(validarUsuario(null).errors.length);
  assert.ok(validarUsuario([]).errors.length);
});
