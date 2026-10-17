const asyncHandler = require('../config/asyncHandler');
const ordenes = require('../services/ordenes.service');

const crear = asyncHandler(async (req, res) => {
  res.status(201).json(await ordenes.crearOrden(req.body));
});

const obtener = asyncHandler(async (req, res) => {
  res.status(200).json(await ordenes.obtenerOrden(req.params.id));
});

const cancelar = asyncHandler(async (req, res) => {
  res.status(200).json(await ordenes.cancelarOrden(req.params.id));
});

module.exports = { crear, obtener, cancelar };
