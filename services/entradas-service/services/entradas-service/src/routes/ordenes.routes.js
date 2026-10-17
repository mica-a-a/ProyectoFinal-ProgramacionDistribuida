const { Router } = require('express');
const { requireDb } = require('../config/db');
const c = require('../controllers/ordenes.controller');

// requireDb se aplica ruta por ruta: /health y /api-docs siguen respondiendo sin base de datos.
const router = Router();
router.post('/ordenes', requireDb, c.crear);
router.get('/ordenes/:id', requireDb, c.obtener);
router.delete('/ordenes/:id', requireDb, c.cancelar);

module.exports = router;
