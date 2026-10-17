const { Router } = require('express');
const { crearOrden, obtenerOrdenPorId, cancelarOrden } = require('../controllers/ordenes.controller');

const router = Router();

router.post('/ordenes', crearOrden);
router.get('/ordenes/:id', obtenerOrdenPorId);
router.delete('/ordenes/:id', cancelarOrden);

module.exports = router;