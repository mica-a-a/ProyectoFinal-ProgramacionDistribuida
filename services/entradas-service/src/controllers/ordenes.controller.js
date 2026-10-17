async function crearOrden(req, res, next) {
    try {
        const { usuarioId, eventoId, cantidad } = req.body;

        // Generamos datos mock / temporales para validar el flujo
        const ordenId = `ord-${Date.now()}`;
        const codigoTicket = `TICK-${Math.floor(1000 + Math.random() * 9000)}`;

        return res.status(201).json({
            id: ordenId,
            usuarioId: usuarioId || 'u1',
            eventoId: eventoId || 'e1',
            cantidad: cantidad || 1,
            estado: 'CREADA',
            codigoTicket: codigoTicket
        });
    } catch (error) {
        next(error);
    }
}

async function obtenerOrdenPorId(req, res, next) {
    try {
        const { id } = req.params;
        return res.status(200).json({
            id,
            estado: 'CREADA'
        });
    } catch (error) {
        next(error);
    }
}

async function cancelarOrden(req, res, next) {
    try {
        const { id } = req.params;
        return res.status(200).json({
            id,
            estado: 'CANCELADA'
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    crearOrden,
    obtenerOrdenPorId,
    cancelarOrden
};