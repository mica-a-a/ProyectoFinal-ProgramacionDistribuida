const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const db = require('../config/db');
const { AppError } = require('../config/errors');

const router = Router();

// Igual que /usuarios: sin base conectada se responde 503 controlado.
router.use('/auth', (req, res, next) => {
  if (!db.isConnected()) return next(new AppError(503, 'Base de datos no disponible', 'DB_NO_DISPONIBLE'));
  return next();
});

router.post('/auth/register', controller.registrar); // público
router.post('/auth/login', controller.login);       // público: es la única forma de obtener un token

module.exports = router;
