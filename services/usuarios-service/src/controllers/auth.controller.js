const authService = require('../services/auth.service');

const registrar = async (req, res, next) => {
  try {
    res.status(201).json(await authService.registrar(req.body));
  } catch (err) {
    next(err);
  }
};

module.exports = { registrar };
