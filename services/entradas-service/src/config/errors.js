// Error de negocio o de infraestructura con código HTTP asociado.
// `details` (opcional) agrega datos útiles al cliente, por ejemplo el id de una orden pendiente.
class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
