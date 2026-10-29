const asyncHandler = require('../config/asyncHandler');
const entradas = require('../services/entradas.service');
const { exigirDuenoOAdmin } = require('../middlewares/auth');

const listar = asyncHandler(async (req, res) => {
  exigirDuenoOAdmin(req, req.query.usuarioId); // un USER solo lista sus propias entradas
  res.status(200).json(await entradas.listarEntradas(req.query.usuarioId));
});

const validar = asyncHandler(async (req, res) => {
  res.status(200).json(await entradas.validarTicket(req.body && req.body.codigo));
});

module.exports = { listar, validar };
