const { Router } = require('express');

function createEventosRoutes(c) {
  const router = Router();

  // Gestión de eventos
  router.get('/eventos', c.listar);
  router.post('/eventos', c.crear);
  router.get('/eventos/:id', c.obtener);
  router.put('/eventos/:id', c.actualizar);
  router.patch('/eventos/:id/cancelar', c.cancelar);
  router.patch('/eventos/:id/finalizar', c.finalizar);

  // Operaciones INTERNAS: las usa entradas-service, no el cliente final.
  router.post('/eventos/:id/reservar-aforo', c.reservarAforo);
  router.post('/eventos/:id/liberar-aforo', c.liberarAforo);

  return router;
}

module.exports = { createEventosRoutes };
