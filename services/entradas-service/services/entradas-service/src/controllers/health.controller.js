const config = require('../config/config');

// Solo indica que el proceso está activo. No expone secretos ni datos internos.
function health(req, res) {
  res.status(200).json({ service: config.serviceName, status: 'ok' });
}

module.exports = { health };
