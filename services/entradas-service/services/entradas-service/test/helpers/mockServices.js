// Simulan usuarios-service y eventos-service siguiendo los contratos del TP5 (sección 7).
// Sirven para probar entradas-service sin depender de que los otros servicios estén terminados.
const express = require('express');

const horas = (h) => new Date(Date.now() + h * 36e5).toISOString();

function seedUsuarios() {
  return {
    u1: { id: 'u1', nombreApellido: 'Lucas Fernández', activo: true },
    u2: { id: 'u2', nombreApellido: 'Sofía Martínez', activo: true },
    u3: { id: 'u3', nombreApellido: 'Usuario Inactivo', activo: false },
  };
}

function seedEventos() {
  const base = (id, nombre, fecha, extra = {}) => ({
    id, nombre, fecha, lugar: 'Aula Magna', precio: 5000, aforoTotal: 10, disponibles: 10, estado: 'PUBLICADO', vigente: true, ...extra,
  });
  return {
    e1: base('e1', 'Taller de Node.js', horas(240)),                                   // en 10 días
    e2: base('e2', 'Charla en 2 horas', horas(2)),                                      // dentro del plazo de cancelación
    e3: base('e3', 'Evento cancelado', horas(240), { estado: 'CANCELADO', vigente: false }),
    e4: base('e4', 'Aforo chico', horas(240), { aforoTotal: 2, disponibles: 2 }),
  };
}

function startUsuariosMock(port = 0) {
  const state = { usuarios: seedUsuarios() };
  const app = express();
  app.get('/health', (req, res) => res.json({ service: 'usuarios-service', status: 'ok' }));
  app.get('/usuarios/:id', (req, res) => {
    const u = state.usuarios[req.params.id];
    if (!u) return res.status(404).json({ message: 'Usuario no encontrado' });
    return res.json(u);
  });
  return listen(app, port, state);
}

function startEventosMock(port = 0) {
  const state = {
    eventos: seedEventos(),
    movimientos: new Map(),   // referencia -> cantidad reservada (idempotencia)
    liberados: new Set(),
    llamadas: [],             // registro de pedidos recibidos (para los tests)
    lockOcupadoVeces: 0,      // responde 423 esa cantidad de veces
    fallo: null,              // 'http500' | 'lento' para simular fallos
    demoraMs: 0,
  };
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    state.llamadas.push({ method: req.method, path: req.path, body: req.body });
    if (state.demoraMs) await new Promise((r) => setTimeout(r, state.demoraMs));
    next();
  });
  app.get('/health', (req, res) => res.json({ service: 'eventos-service', status: 'ok' }));
  app.get('/eventos/:id', (req, res) => {
    const e = state.eventos[req.params.id];
    if (!e) return res.status(404).json({ message: 'Evento no encontrado' });
    return res.json(e);
  });
  app.post('/eventos/:id/reservar-aforo', (req, res) => {
    const e = state.eventos[req.params.id];
    if (!e) return res.status(404).json({ message: 'Evento no encontrado' });
    if (state.lockOcupadoVeces > 0) { state.lockOcupadoVeces -= 1; return res.status(423).json({ message: 'Evento ocupado' }); }
    if (state.fallo === 'http500') return res.status(500).json({ message: 'boom' });
    const { cantidad, referencia } = req.body;
    if (state.movimientos.has(referencia)) return res.json({ reservado: true, disponibles: e.disponibles });
    if (!e.vigente || e.estado !== 'PUBLICADO') return res.status(409).json({ message: 'El evento no admite ventas' });
    if (cantidad > e.disponibles) return res.status(409).json({ message: 'No hay lugares suficientes' });
    e.disponibles -= cantidad;
    if (e.disponibles === 0) e.estado = 'AGOTADO';
    state.movimientos.set(referencia, cantidad);
    return res.json({ reservado: true, disponibles: e.disponibles });
  });
  app.post('/eventos/:id/liberar-aforo', (req, res) => {
    const e = state.eventos[req.params.id];
    if (!e) return res.status(404).json({ message: 'Evento no encontrado' });
    const { cantidad, referencia } = req.body;
    if (!state.liberados.has(referencia)) {
      e.disponibles = Math.min(e.aforoTotal, e.disponibles + cantidad);
      if (e.estado === 'AGOTADO') e.estado = 'PUBLICADO';
      state.liberados.add(referencia);
    }
    return res.json({ liberado: true, disponibles: e.disponibles });
  });
  return listen(app, port, state);
}

function listen(app, port, state) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve({ server, state, port: server.address().port }));
  });
}

module.exports = { startUsuariosMock, startEventosMock };
