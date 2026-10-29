const { Router } = require('express');
const { requireDb } = require('../config/db');
const c = require('../controllers/entradas.controller');
const { autenticar, requerirRol } = require('../middlewares/auth');

const router = Router();
router.get('/entradas', autenticar, requireDb, c.listar);
router.post('/entradas/validar', autenticar, requerirRol('ADMIN'), requireDb, c.validar);

module.exports = router;
