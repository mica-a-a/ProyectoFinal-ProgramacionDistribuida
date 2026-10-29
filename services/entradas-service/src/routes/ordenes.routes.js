const { Router } = require('express');
const { requireDb } = require('../config/db');
const c = require('../controllers/ordenes.controller');
const { autenticar } = require('../middlewares/auth');

// requireDb se aplica ruta por ruta: /health y /api-docs siguen respondiendo sin base de datos.
const router = Router();
router.post('/ordenes', autenticar, requireDb, c.crear);
router.get('/ordenes/:id', autenticar, requireDb, c.obtener);
router.delete('/ordenes/:id', autenticar, requireDb, c.cancelar);

module.exports = router;
