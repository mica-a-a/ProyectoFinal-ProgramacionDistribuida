// Express 4 no captura los errores de funciones async: este wrapper los pasa a next().
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
