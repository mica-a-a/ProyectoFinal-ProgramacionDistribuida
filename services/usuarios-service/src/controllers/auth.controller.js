const authService = require('../services/auth.service');

const registrar = async (req, res, next) => {
  try {
    res.status(201).json(await authService.registrar(req.body));
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store'); // la respuesta lleva un token: que nadie la cachee
    res.status(200).json(await authService.login(req.body));
  } catch (err) {
    next(err);
  }
};

module.exports = { registrar, login };
