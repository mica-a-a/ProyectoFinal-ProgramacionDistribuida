// Modelos en memoria con la misma interfaz que usan los servicios (create, find, updateMany...).
// Permiten probar las reglas de negocio sin una instancia de MongoDB.
const crypto = require('crypto');

function match(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('$in' in v) return v.$in.map(String).includes(String(val));
      if ('$ne' in v) return String(val) !== String(v.$ne);
    }
    return String(val) === String(v);
  });
}

function makeModel(defaults) {
  const rows = [];
  const wrap = (data) => {
    const d = { ...data };
    Object.defineProperty(d, 'toJSON', {
      enumerable: false,
      value() { const { _id, ...rest } = this; return { id: _id, ...rest }; },
    });
    return d;
  };
  const model = {
    rows,
    reset() { rows.length = 0; },
    async create(data) {
      const d = wrap({ _id: crypto.randomBytes(12).toString('hex'), ...defaults, ...data, fechaCreacion: new Date().toISOString() });
      rows.push(d);
      return d;
    },
    async insertMany(list) { const out = []; for (const x of list) out.push(await model.create(x)); return out; },
    async findById(id) { return rows.find((r) => r._id === String(id)) || null; },
    async find(filter = {}) { return rows.filter((r) => match(r, filter)); },
    async findOne(filter) { return rows.find((r) => match(r, filter)) || null; },
    async findByIdAndUpdate(id, upd) { const r = rows.find((x) => x._id === String(id)); if (!r) return null; Object.assign(r, upd); return r; },
    async findOneAndUpdate(filter, upd) { const r = rows.find((x) => match(x, filter)); if (!r) return null; Object.assign(r, upd); return r; },
    async updateMany(filter, upd) { const hits = rows.filter((r) => match(r, filter)); hits.forEach((r) => Object.assign(r, upd)); return { matchedCount: hits.length, modifiedCount: hits.length }; },
    async deleteMany(filter) { const hits = rows.filter((r) => match(r, filter)); hits.forEach((h) => rows.splice(rows.indexOf(h), 1)); return { deletedCount: hits.length }; },
  };
  return model;
}

module.exports = { makeModel };
