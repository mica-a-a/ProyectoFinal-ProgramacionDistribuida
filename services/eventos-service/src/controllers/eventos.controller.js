// Adapta HTTP <-> servicio. Las reglas de negocio viven en services/.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createEventosController({ eventosService, aforoService }) {
  return {
    crear: asyncHandler(async (req, res) => res.status(201).json(await eventosService.crear(req.body))),
    listar: asyncHandler(async (req, res) => res.status(200).json(await eventosService.listar({ estado: req.query.estado }))),
    obtener: asyncHandler(async (req, res) => res.status(200).json(await eventosService.obtener(req.params.id))),
    actualizar: asyncHandler(async (req, res) => res.status(200).json(await eventosService.actualizar(req.params.id, req.body))),
    cancelar: asyncHandler(async (req, res) => res.status(200).json(await eventosService.cancelar(req.params.id))),
    finalizar: asyncHandler(async (req, res) => res.status(200).json(await eventosService.finalizar(req.params.id))),
    reservarAforo: asyncHandler(async (req, res) => res.status(200).json(await aforoService.reservar(req.params.id, req.body))),
    liberarAforo: asyncHandler(async (req, res) => res.status(200).json(await aforoService.liberar(req.params.id, req.body))),
  };
}

module.exports = { createEventosController };
