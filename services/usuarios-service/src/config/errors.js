// Error de negocio o de infraestructura con código HTTP asociado.
// `details` permite devolver, por ejemplo, la lista de errores de validación.
class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
