const { Router } = require('express');

function createHealthRoutes(controller) {
  const router = Router();
  router.get('/health', controller.health);
  router.get('/ready', controller.ready);
  return router;
}

module.exports = { createHealthRoutes };
