// Levanta usuarios-service (3001) y eventos-service (3002) SIMULADOS para probar
// entradas-service a mano (Swagger, Postman, curl) mientras los reales no están listos.
const { startUsuariosMock, startEventosMock } = require('../test/helpers/mockServices');

(async () => {
  const u = await startUsuariosMock(3001);
  const e = await startEventosMock(3002);
  console.log('Mocks listos:');
  console.log(`  usuarios (simulado) http://localhost:${u.port}  ->  ids: ${Object.keys(u.state.usuarios).join(', ')}  (u3 está inactivo)`);
  console.log(`  eventos  (simulado) http://localhost:${e.port}  ->  ids: ${Object.keys(e.state.eventos).join(', ')}`);
  console.log('    e1: normal | e2: empieza en 2 h (no se puede cancelar) | e3: cancelado | e4: aforo 2');
})();
