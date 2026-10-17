const { Router } = require('express');
const { listarEntradas, validarEntrada } = require('../controllers/entradas.controller');

const router = Router();

router.get('/entradas', listarEntradas);
router.post('/entradas/validar', validarEntrada);

module.exports = router;