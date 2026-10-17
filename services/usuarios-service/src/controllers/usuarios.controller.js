const usuariosService = require('../services/usuarios.service');
const logger = require('../config/logger');

// Express 4 no captura errores de funciones async: este wrapper los manda al
// manejador de errores de app.js.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const listar = wrap(async (req, res) => {
  const usuarios = await usuariosService.listar({ activo: req.query.activo });
  res.status(200).json(usuarios);
});

const obtener = wrap(async (req, res) => {
  const usuario = await usuariosService.obtener(req.params.id);
  res.status(200).json(usuario);
});

const crear = wrap(async (req, res) => {
  const usuario = await usuariosService.crear(req.body);
  logger.info('usuario creado', { operacion: 'POST /usuarios', usuarioId: String(usuario._id) });
  res.status(201).json(usuario);
});

const actualizar = wrap(async (req, res) => {
  const usuario = await usuariosService.actualizar(req.params.id, req.body);
  logger.info('usuario actualizado', { operacion: 'PUT /usuarios/:id', usuarioId: req.params.id });
  res.status(200).json(usuario);
});

const darDeBaja = wrap(async (req, res) => {
  const usuario = await usuariosService.darDeBaja(req.params.id);
  logger.info('usuario dado de baja', { operacion: 'DELETE /usuarios/:id', usuarioId: req.params.id });
  res.status(200).json(usuario);
});

module.exports = { listar, obtener, crear, actualizar, darDeBaja };
