async function listarEntradas(req, res, next) {
    try {
        return res.status(200).json([]);
    } catch (error) {
        next(error);
    }
}

async function validarEntrada(req, res, next) {
    try {
        return res.status(200).json({ valida: true });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listarEntradas,
    validarEntrada
};