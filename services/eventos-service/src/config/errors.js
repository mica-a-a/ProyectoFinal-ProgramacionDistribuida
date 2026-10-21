// Error de negocio o de infraestructura con código HTTP asociado.
class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { AppError };
