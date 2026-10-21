const { Router } = require('express');
const controller = require('../controllers/usuarios.controller');
const db = require('../config/db');
const { AppError } = require('../config/errors');

const router = Router();

// Si la base no está conectada se responde 503 controlado (no 500, no cuelgue).
// /health y /api-docs no pasan por acá, así que siguen respondiendo.
router.use('/usuarios', (req, res, next) => {
  if (!db.isConnected()) {
    return next(new AppError(503, 'Base de datos no disponible', 'DB_NO_DISPONIBLE'));
  }
  return next();
});

router.get('/usuarios', controller.listar);
router.get('/usuarios/:id', controller.obtener);
router.post('/usuarios', controller.crear);
router.put('/usuarios/:id', controller.actualizar);
router.delete('/usuarios/:id', controller.darDeBaja);

module.exports = router;
