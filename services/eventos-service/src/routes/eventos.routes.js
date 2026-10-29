const { Router } = require('express');
const { autenticar, requerirRol } = require('../middlewares/auth');

function createEventosRoutes(c) {
  const router = Router();

  // Gestión de eventos
  const soloAdmin = [autenticar, requerirRol('ADMIN')];
  router.get('/eventos', c.listar);                       // público: catálogo
  router.post('/eventos', ...soloAdmin, c.crear);
  router.get('/eventos/:id', c.obtener);                  // público (Entradas también lo consulta)
  router.put('/eventos/:id', ...soloAdmin, c.actualizar);
  router.patch('/eventos/:id/cancelar', ...soloAdmin, c.cancelar);
  router.patch('/eventos/:id/finalizar', ...soloAdmin, c.finalizar);

  // Operaciones INTERNAS: las usa entradas-service, no el cliente final.
  // Quedan protegidas con cualquier rol: Entradas propaga el token del comprador (sección 7 del Hito 1).
  router.post('/eventos/:id/reservar-aforo', autenticar, c.reservarAforo);
  router.post('/eventos/:id/liberar-aforo', autenticar, c.liberarAforo);

  return router;
}

module.exports = { createEventosRoutes };
