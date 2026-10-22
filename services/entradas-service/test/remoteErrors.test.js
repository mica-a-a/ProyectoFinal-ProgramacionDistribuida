const test = require('node:test');
const assert = require('node:assert/strict');
const { toAppError } = require('../src/services/remoteErrors');
const { RemoteServiceError } = require('../src/clients/httpClient');

const conflicto = (body) => new RemoteServiceError({ service: 'eventos-service', kind: 'CONFLICT', status: 409, body, message: 'x' });

test('un 409 conserva el código que informó el servicio dueño de la regla', () => {
  const e = toAppError(conflicto({ message: 'El evento no está a la venta (estado CANCELADO)', code: 'EVENTO_NO_VENDIBLE' }), {
    CONFLICT: { code: 'SIN_AFORO' },
  });
  assert.equal(e.status, 409);
  assert.equal(e.code, 'EVENTO_NO_VENDIBLE');
});

test('un 409 sin código remoto usa el código indicado por quien llama', () => {
  const e = toAppError(conflicto({ message: 'No hay lugares disponibles' }), { CONFLICT: { code: 'SIN_AFORO' } });
  assert.equal(e.code, 'SIN_AFORO');
});

test('un timeout o una conexión rechazada sigue siendo 503 y no un error funcional', () => {
  const caido = new RemoteServiceError({ service: 'usuarios-service', kind: 'UNAVAILABLE', message: 'x' });
  const e = toAppError(caido);
  assert.equal(e.status, 503);
  assert.equal(e.code, 'DEPENDENCIA_NO_DISPONIBLE');
});
