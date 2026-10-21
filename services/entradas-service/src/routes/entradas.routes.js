const { Router } = require('express');
const { requireDb } = require('../config/db');
const c = require('../controllers/entradas.controller');

const router = Router();
router.get('/entradas', requireDb, c.listar);
router.post('/entradas/validar', requireDb, c.validar);

module.exports = router;
