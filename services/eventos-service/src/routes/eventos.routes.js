const { Router } = require('express');
const { autenticar, autenticarEntradasService, requerirRol } = require('../middlewares/auth');

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

  // Operaciones internas: solo acepta la identidad técnica de entradas-service.
  router.post('/eventos/:id/reservar-aforo', autenticarEntradasService, c.reservarAforo);
  router.post('/eventos/:id/liberar-aforo', autenticarEntradasService, c.liberarAforo);

  return router;
}

module.exports = { createEventosRoutes };
