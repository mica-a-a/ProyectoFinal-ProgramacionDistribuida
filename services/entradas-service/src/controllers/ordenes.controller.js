const asyncHandler = require('../config/asyncHandler');
const ordenes = require('../services/ordenes.service');
const { exigirDuenoOAdmin } = require('../middlewares/auth');

// Propiedad del recurso (Hito 1, sección 6): un USER solo opera sobre sus propias órdenes; ADMIN sobre todas.
const crear = asyncHandler(async (req, res) => {
  exigirDuenoOAdmin(req, req.body && req.body.usuarioId); // un USER solo compra para sí mismo
  res.status(201).json(await ordenes.crearOrden(req.body));
});

const obtener = asyncHandler(async (req, res) => {
  const resultado = await ordenes.obtenerOrden(req.params.id);
  exigirDuenoOAdmin(req, resultado.orden.usuarioId);
  res.status(200).json(resultado);
});

const cancelar = asyncHandler(async (req, res) => {
  const previa = await ordenes.obtenerOrden(req.params.id); // se verifica el dueño ANTES de tocar nada
  exigirDuenoOAdmin(req, previa.orden.usuarioId);
  res.status(200).json(await ordenes.cancelarOrden(req.params.id));
});

module.exports = { crear, obtener, cancelar };
