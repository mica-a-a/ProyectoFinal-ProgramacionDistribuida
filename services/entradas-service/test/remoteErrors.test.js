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

// TP7 - propagación del token: cómo se traduce lo que responde el servicio remoto a la identidad propagada.
const remoto = (kind, status, body) => new RemoteServiceError({ service: 'usuarios-service', kind, status, body, message: 'x' });

test('401 TOKEN_VENCIDO del servicio remoto: se informa 401 al cliente (debe volver a iniciar sesión)', () => {
  const e = toAppError(remoto('UNAUTHENTICATED', 401, { code: 'TOKEN_VENCIDO' }));
  assert.equal(e.status, 401);
  assert.equal(e.code, 'TOKEN_VENCIDO');
});

test('cualquier otro 401 del servicio remoto es un problema de configuración nuestro: 502, no 401', () => {
  for (const body of [{ code: 'TOKEN_INVALIDO' }, { code: 'TOKEN_AUSENTE' }, null]) {
    const e = toAppError(remoto('UNAUTHENTICATED', 401, body));
    assert.equal(e.status, 502);
    assert.equal(e.code, 'DEPENDENCIA_AUTENTICACION');
  }
});

test('un 403 del servicio dueño del recurso se propaga como 403', () => {
  const e = toAppError(remoto('FORBIDDEN', 403, { message: 'No tenés permisos sobre este recurso', code: 'PERMISOS_INSUFICIENTES' }));
  assert.equal(e.status, 403);
  assert.equal(e.code, 'PERMISOS_INSUFICIENTES');
});
