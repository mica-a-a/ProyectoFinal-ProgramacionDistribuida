const asyncHandler = require('../config/asyncHandler');
const ordenes = require('../services/ordenes.service');
const { exigirDuenoOAdmin } = require('../middlewares/auth');

// TP7 - Propagación del token (Hito 1, sección 7): el contexto de identidad que viaja a Usuarios y a Eventos es el
// encabezado Authorization del cliente. `autenticar` ya lo validó, por eso acá solo se reenvía (normalizado a `Bearer <token>`).
const contextoDe = (req) => {
  const [, token] = String(req.headers.authorization || '').trim().split(/\s+/);
  return { authorization: token ? `Bearer ${token}` : undefined };
};

// Propiedad del recurso (Hito 1, sección 6): un USER solo opera sobre sus propias órdenes; ADMIN sobre todas.
const crear = asyncHandler(async (req, res) => {
  exigirDuenoOAdmin(req, req.body && req.body.usuarioId); // un USER solo compra para sí mismo
  res.status(201).json(await ordenes.crearOrden(req.body, contextoDe(req)));
});

const obtener = asyncHandler(async (req, res) => {
  const resultado = await ordenes.obtenerOrden(req.params.id);
  exigirDuenoOAdmin(req, resultado.orden.usuarioId);
  res.status(200).json(resultado);
});

const cancelar = asyncHandler(async (req, res) => {
  const previa = await ordenes.obtenerOrden(req.params.id); // se verifica el dueño ANTES de tocar nada
  exigirDuenoOAdmin(req, previa.orden.usuarioId);
  res.status(200).json(await ordenes.cancelarOrden(req.params.id, contextoDe(req)));
});

module.exports = { crear, obtener, cancelar };
