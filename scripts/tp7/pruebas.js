#!/usr/bin/env node
/*
 * TP7 - Pruebas obligatorias A a L (sección 19 de la consigna), reproducibles con un comando.
 *
 *   node scripts/tp7/pruebas.js <A..L | todo> [--no-guardar]
 *
 * Requisitos: Node 20+, Docker y la solución levantada con los datos de prueba:
 *   cp .env.example .env            (completar JWT_SECRET; ver instrucciones dentro del archivo)
 *   docker compose up --build -d
 *   docker compose exec -T usuarios-service npm run seed
 *   docker compose exec -T eventos-service npm run seed
 * Lee el .env de la raíz (JWT_SECRET, SEED_ADMIN_PASSWORD, puertos), igual que Docker Compose.
 *
 * Escenarios:
 *   A  Registrar o dar de alta un usuario válido
 *   B  Intentar registrar un usuario duplicado                  -> 409
 *   C  Login con credenciales válidas                           -> JWT con vencimiento
 *   D  Login con password incorrecta (y otros logins inválidos) -> 401 / 403 / 400
 *   E  Endpoint protegido sin token                             -> 401
 *   F  Modificar manualmente el token                           -> 401
 *   G  Token vencido                                            -> 401
 *   H  Usuario válido sin rol suficiente                        -> 403
 *   I  Usuario con rol autorizado                               -> operación correcta
 *   J  Caso de uso que atraviesa dos servicios                  (delega en propagacion.js)
 *   K  Reiniciar la solución con Docker Compose                 -> usuarios persistidos y re-autenticación
 *   L  Inspeccionar la persistencia de usuarios                 -> contraseña guardada como hash
 *
 * Cada escenario imprime los comandos que ejecuta y guarda su salida en docs/evidencias/tp7/<letra>-<nombre>.txt.
 * SEGURIDAD (sección 15): todo lo que se imprime y se guarda tiene tokens, contraseñas y hashes ENMASCARADOS,
 * así que las evidencias se pueden adjuntar al informe y subir a Git.
 * K reinicia los contenedores (conserva los volúmenes): por eso `todo` lo ejecuta casi al final.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ------------------------------------------------------------------ configuración
const ROOT = path.resolve(__dirname, '..', '..');
const EVID_DIR = path.join(ROOT, 'docs', 'evidencias', 'tp7');

function leerDotEnv() {
  const archivo = path.join(ROOT, '.env');
  const env = {};
  if (!fs.existsSync(archivo)) return env;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !linea.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const ENV = { ...leerDotEnv(), ...process.env };
const URL_ = {
  usuarios: `http://localhost:${ENV.USUARIOS_HOST_PORT || 3001}`,
  eventos: `http://localhost:${ENV.EVENTOS_HOST_PORT || 3002}`,
  entradas: `http://localhost:${ENV.ENTRADAS_HOST_PORT || 3003}`,
};
const SECRETO = ENV.JWT_SECRET;
const ADMIN_EMAIL = ENV.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || ENV.SEED_ADMIN_PASSWORD;
const PASSWORD_PRUEBA = 'Clave-Prueba-Tp7-1';
const ISSUER = 'usuarios-service';

const args = process.argv.slice(2);
const FLAGS = new Set(args.filter((a) => a.startsWith('--')));
const PRUEBA = args.find((a) => !a.startsWith('--'));
const GUARDAR = !FLAGS.has('--no-guardar');

// ------------------------------------------------------------------ salida (con enmascarado de secretos)
const ANSI = /\x1b\[[0-9;]*m/g;
const color = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const verde = color(32); const rojo = color(31); const gris = color(90); const azul = color(36); const negrita = color(1);

const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const BCRYPT_RE = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g;
const secretos = new Set([PASSWORD_PRUEBA, ADMIN_PASSWORD, ENV.SEED_USER_PASSWORD].filter(Boolean));
function enmascarar(t) {
  let s = String(t).replace(JWT_RE, 'eyJ…<JWT enmascarado>').replace(BCRYPT_RE, '$2a$..$…<hash bcrypt enmascarado>');
  s = s.replace(/"password"\s*:\s*"[^"]*"/g, '"password":"***"');
  for (const x of secretos) if (x) s = s.split(x).join('***');
  return s;
}

let buffer = []; let okActual = 0; let fallosActual = 0;
function out(linea = '') {
  const l = enmascarar(linea);
  console.log(l);
  buffer.push(l.replace(ANSI, ''));
}
const recortar = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seccion = (t) => out(`\n${azul(`▶ ${t}`)}`);
const nota = (t) => out(gris(`  ${t}`));

function check(desc, cond, detalle = '') {
  if (cond) { okActual += 1; out(`${verde('  ✔ ')}${desc}`); } else {
    fallosActual += 1; out(`${rojo('  ✘ ')}${desc}${detalle ? gris(`   → ${detalle}`) : ''}`);
  }
  return Boolean(cond);
}

// ------------------------------------------------------------------ tokens
const etiquetas = new Map();
const b64u = (x) => Buffer.from(x).toString('base64url');
const claimsDe = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };
const cabeceraDe = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')); } catch { return {}; } };

// JWT fabricado a mano (sin dependencias) para las pruebas de rechazo. `alg` y `secreto` se pueden manipular.
function fabricar(payload, { secreto = SECRETO, alg = 'HS256', sinFirma = false, etiqueta } = {}) {
  const h = b64u(JSON.stringify({ alg: sinFirma ? 'none' : alg, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  let token;
  if (sinFirma) token = `${h}.${p}.`;
  else {
    const hash = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg];
    token = `${h}.${p}.${crypto.createHmac(hash, secreto).update(`${h}.${p}`).digest('base64url')}`;
  }
  if (etiqueta) etiquetas.set(token, etiqueta);
  return token;
}
const ahora = () => Math.floor(Date.now() / 1000);
const claimsBase = (sub, role = 'USER') => ({ sub, role, iss: ISSUER, iat: ahora(), exp: ahora() + 3600 });

// ------------------------------------------------------------------ http / docker
async function http(metodo, url, { body, token, headers, mostrar = true, timeout = 10000 } = {}) {
  if (mostrar) {
    const h = token ? ` -H "Authorization: Bearer <${etiquetas.get(token) || 'token'}>"` : (headers?.authorization ? ` -H "Authorization: ${headers.authorization}"` : '');
    const d = body !== undefined ? ` -H "content-type: application/json" -d '${JSON.stringify(body)}'` : '';
    out(gris(`  $ curl -s -X ${metodo} ${url}${h}${d}`));
  }
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    if (mostrar) out(gris(`  ← sin respuesta (${e.cause?.code || e.name})`));
    return { status: 0, json: null, text: '', error: e };
  }
  let text = '';
  try { text = await res.text(); } catch { /* respuesta cortada */ }
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  if (mostrar) out(gris(`  ← ${res.status} ${recortar(text, 220)}`));
  return { status: res.status, json, text };
}

function docker(argv, { mostrar = true, maxLineas = 10 } = {}) {
  if (mostrar) out(gris(`  $ docker ${argv.map((a) => (/[\s"]/.test(a) ? `'${a}'` : a)).join(' ')}`));
  const r = spawnSync('docker', argv, { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (r.error) { out(rojo(`  No se pudo ejecutar docker: ${r.error.message}`)); return { code: -1, stdout: '', stderr: r.error.message }; }
  const texto = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (mostrar && texto) texto.split(/\r?\n/).slice(-maxLineas).forEach((l) => out(gris(`    ${l}`)));
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const compose = (argv, opts) => docker(['compose', ...argv], opts);

async function esperar(desc, fn, { timeoutMs = 150000, cadaMs = 3000 } = {}) {
  const t0 = Date.now();
  nota(`… esperando: ${desc}`);
  while (Date.now() - t0 < timeoutMs) {
    try { if (await fn()) { nota(`… listo (${Math.round((Date.now() - t0) / 1000)} s)`); return true; } } catch { /* reintenta */ }
    await sleep(cadaMs);
  }
  out(rojo(`  … tiempo agotado esperando: ${desc}`));
  return false;
}

// ------------------------------------------------------------------ datos de prueba (compartidos entre escenarios)
const SUF = Date.now().toString(36);
let contador = 0;
const unico = () => `${SUF}${(contador += 1)}`;
const dni = () => String(20000000 + Math.floor(Math.random() * 9e6));
const datosRegistro = (extra = {}) => {
  const u = unico();
  return { nombre: 'Prueba', apellido: `Tp7${u}`, email: `tp7.${u}@example.com`, dni: dni(), fechaNacimiento: '1995-04-12', password: PASSWORD_PRUEBA, ...extra };
};
const ctx = {};

async function login(email, password, mostrar = false) {
  secretos.add(password);
  return http('POST', `${URL_.usuarios}/auth/login`, { body: { email, password }, mostrar });
}

// Registra un usuario y le hace login. Con `mostrar` el escenario ve los comandos; si no, es preparación silenciosa.
async function registrar(etiqueta, { mostrar = false, extra = {} } = {}) {
  const datos = datosRegistro(extra);
  const r = await http('POST', `${URL_.usuarios}/auth/register`, { body: datos, mostrar });
  if (r.status !== 201) throw new Error(`no se pudo registrar al usuario ${etiqueta} (HTTP ${r.status}): ${r.text}`);
  const l = await login(datos.email, datos.password, mostrar);
  if (l.status !== 200) throw new Error(`no se pudo iniciar sesión con el usuario ${etiqueta} (HTTP ${l.status})`);
  etiquetas.set(l.json.token, `token de ${etiqueta}`);
  return { etiqueta, id: r.json.id, email: datos.email, dni: datos.dni, password: datos.password, token: l.json.token };
}

async function requerirStack() {
  for (const [n, u] of Object.entries(URL_)) {
    const r = await http('GET', `${u}/health`, { mostrar: false, timeout: 3000 });
    if (r.status !== 200) throw new Error(`${n}-service no responde en ${u}. Ejecutá primero: docker compose up --build -d`);
  }
}

async function admin() {
  if (ctx.admin) return ctx.admin;
  await requerirStack();
  if (!ADMIN_PASSWORD) throw new Error('Falta la contraseña del administrador: definí SEED_ADMIN_PASSWORD en el .env de la raíz.');
  const a = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (a.status !== 200) throw new Error(`no se pudo iniciar sesión como ${ADMIN_EMAIL} (HTTP ${a.status}). ¿Corriste el seed de usuarios con la misma SEED_ADMIN_PASSWORD?`);
  ctx.admin = { id: claimsDe(a.json.token).sub, token: a.json.token };
  etiquetas.set(ctx.admin.token, 'token de ADMIN');
  return ctx.admin;
}
async function usuario(letra) { // A y B: usuarios USER de prueba, creados una sola vez
  await admin();
  if (!ctx[letra]) ctx[letra] = await registrar(`USER ${letra}`);
  return ctx[letra];
}
async function evento() {
  if (ctx.evento) return ctx.evento;
  const a = await admin();
  const r = await http('POST', `${URL_.eventos}/eventos`, {
    token: a.token, mostrar: false,
    body: { nombre: `Evento TP7 ${unico()}`, fecha: new Date(Date.now() + 30 * 864e5).toISOString(), lugar: 'Sala TP7', precio: 2500, aforoTotal: 50 },
  });
  if (r.status !== 201) throw new Error(`el ADMIN no pudo crear el evento de prueba (HTTP ${r.status}): ${r.text}`);
  ctx.evento = r.json;
  return ctx.evento;
}
const comprar = (token, usuarioId, eventoId, cantidad = 1) => http('POST', `${URL_.entradas}/ordenes`, { token, body: { usuarioId, eventoId, cantidad } });

// Un endpoint protegido por servicio (con el cuerpo mínimo: la autenticación se evalúa antes que el cuerpo).
const PROTEGIDOS = [
  { servicio: 'usuarios-service', metodo: 'GET', url: () => `${URL_.usuarios}/usuarios` },
  { servicio: 'eventos-service', metodo: 'POST', url: () => `${URL_.eventos}/eventos`, body: {} },
  { servicio: 'entradas-service', metodo: 'POST', url: () => `${URL_.entradas}/ordenes`, body: {} },
];
const probar = (p, opciones = {}) => http(p.metodo, p.url(), { body: p.body, ...opciones });

// ================================================================== ESCENARIOS
const escenarios = {};
const NOMBRES = {
  A: 'registro', B: 'duplicado', C: 'login-valido', D: 'login-invalido', E: 'sin-token', F: 'token-alterado',
  G: 'token-vencido', H: 'sin-permiso', I: 'con-permiso', J: 'dos-servicios', K: 'reinicio', L: 'persistencia',
};

escenarios.A = async () => {
  const a = await admin();
  let r;
  seccion('1) Registro de un usuario válido (público)');
  const u = datosRegistro();
  r = await http('POST', `${URL_.usuarios}/auth/register`, { body: u });
  check('POST /auth/register → 201 Created', r.status === 201);
  check('la respuesta incluye id y rol USER, y el usuario queda activo', Boolean(r.json?.id) && r.json?.role === 'USER' && r.json?.activo === true);
  check('la respuesta NO incluye la contraseña ni su hash', !('password' in (r.json || {})) && !('passwordHash' in (r.json || {})) && !/\$2[aby]\$/.test(r.text));
  const registrado = r.json;

  seccion('2) El cliente no elige su rol: un `role: ADMIN` en el registro se ignora');
  r = await http('POST', `${URL_.usuarios}/auth/register`, { body: datosRegistro({ role: 'ADMIN' }) });
  check('el registro con role=ADMIN en el cuerpo → 201 pero se crea como USER', r.status === 201 && r.json?.role === 'USER');

  seccion('3) Datos inválidos: 400 con error controlado');
  r = await http('POST', `${URL_.usuarios}/auth/register`, { body: { nombre: 'A', email: 'no-es-un-mail', password: 'corta' } });
  check('registro con datos inválidos → 400 con la lista de errores', r.status === 400 && Array.isArray(r.json?.errors) && r.json.errors.length > 0);

  seccion('4) Alta administrada: solo un ADMIN puede crear otro ADMIN');
  r = await http('POST', `${URL_.usuarios}/usuarios`, { token: a.token, body: datosRegistro({ role: 'ADMIN' }) });
  check('POST /usuarios del ADMIN con role=ADMIN → 201 con rol ADMIN', r.status === 201 && r.json?.role === 'ADMIN');
  check('tampoco esa respuesta incluye contraseña ni hash', !('password' in (r.json || {})) && !('passwordHash' in (r.json || {})));
  nota(`usuario registrado: ${registrado?.id}. En el escenario L se comprueba cómo quedó guardada su contraseña.`);
  if (!ctx.A) {
    const l = await login(u.email, u.password);
    ctx.A = { etiqueta: 'USER A', id: registrado.id, email: u.email, dni: u.dni, password: u.password, token: l.json?.token };
    if (l.json?.token) etiquetas.set(l.json.token, 'token de USER A');
  }
};

escenarios.B = async () => {
  const a = await usuario('A');
  let r;
  seccion('1) Registrar de nuevo el mismo email');
  r = await http('POST', `${URL_.usuarios}/auth/register`, { body: datosRegistro({ email: a.email }) });
  check('→ 409 Conflict con código EMAIL_DUPLICADO', r.status === 409 && r.json?.code === 'EMAIL_DUPLICADO');
  seccion('2) Registrar con el mismo DNI y otro email');
  r = await http('POST', `${URL_.usuarios}/auth/register`, { body: datosRegistro({ dni: a.dni }) });
  check('→ 409 Conflict con código DNI_DUPLICADO', r.status === 409 && r.json?.code === 'DNI_DUPLICADO');
  seccion('3) El usuario original no se vio afectado');
  r = await login(a.email, a.password, true);
  check('el usuario original sigue pudiendo iniciar sesión → 200', r.status === 200);
};

escenarios.C = async () => {
  const a = await usuario('A');
  seccion('1) Login con credenciales válidas');
  const r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: a.email, password: a.password } });
  check('POST /auth/login → 200 OK', r.status === 200);
  check('la respuesta trae token, tokenType "Bearer" y expiresIn', typeof r.json?.token === 'string' && r.json?.tokenType === 'Bearer' && Number.isInteger(r.json?.expiresIn));
  const token = r.json?.token || '';
  etiquetas.set(token, 'token de USER A');
  const cab = cabeceraDe(token); const c = claimsDe(token);
  seccion('2) Qué contiene el token (se muestra decodificado; el token en sí nunca se imprime)');
  nota(`cabecera: ${JSON.stringify(cab)}`);
  nota(`claims:   ${JSON.stringify(c)}`);
  check('algoritmo HS256 (clave simétrica) y tipo JWT', cab.alg === 'HS256' && cab.typ === 'JWT');
  check('claims obligatorios: sub (id del usuario), role, iat, exp', c.sub === a.id && c.role === 'USER' && Number.isInteger(c.iat) && Number.isInteger(c.exp));
  check('emisor (iss) = usuarios-service', c.iss === ISSUER);
  check(`tiene vencimiento: exp - iat = ${c.exp - c.iat} s = expiresIn y todavía no venció`, c.exp - c.iat === r.json.expiresIn && c.exp > ahora());
  check('NO incluye contraseña, hash, email ni datos personales (solo sub, role, iat, exp, iss)', Object.keys(c).sort().join() === ['exp', 'iat', 'iss', 'role', 'sub'].sort().join());
  seccion('3) El rol sale de la base de datos: el ADMIN de prueba obtiene un token ADMIN');
  const ad = await login(ADMIN_EMAIL, ADMIN_PASSWORD, true);
  check('login del administrador → 200 y role=ADMIN en el token', ad.status === 200 && claimsDe(ad.json?.token || '').role === 'ADMIN');
  seccion('4) El token sirve para consumir un endpoint protegido');
  const p = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token });
  check('GET /usuarios/:id (propio) con el token → 200', p.status === 200 && p.json?.id === a.id);
};

escenarios.D = async () => {
  const a = await usuario('A');
  const adm = await admin();
  let r;
  seccion('1) Password incorrecta');
  secretos.add('password-incorrecta-1');
  r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: a.email, password: 'password-incorrecta-1' } });
  check('→ 401 Unauthorized con código CREDENCIALES_INVALIDAS', r.status === 401 && r.json?.code === 'CREDENCIALES_INVALIDAS');
  check('no se emite ningún token', !r.json?.token);
  const incorrecta = r.json;

  seccion('2) Usuario inexistente: la respuesta es idéntica (no revela cuál de los dos datos falló)');
  r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: `no.existe.${unico()}@example.com`, password: 'password-incorrecta-1' } });
  check('→ 401 con el MISMO código y el MISMO mensaje que la password incorrecta', r.status === 401 && JSON.stringify(r.json) === JSON.stringify(incorrecta));

  seccion('3) Datos de entrada inválidos');
  r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: a.email } });
  check('login sin password → 400 Bad Request con error controlado', r.status === 400 && r.json?.code === 'VALIDACION');
  r = await http('POST', `${URL_.usuarios}/auth/login`, { body: {} });
  check('login sin datos → 400', r.status === 400);

  seccion('4) Cuenta deshabilitada: política documentada = 403, pero solo si la contraseña es correcta');
  const baja = await registrar('USER dado de baja');
  r = await http('DELETE', `${URL_.usuarios}/usuarios/${baja.id}`, { token: adm.token });
  check('el ADMIN da de baja al usuario (baja lógica) → activo=false', r.status === 200 && r.json?.activo === false);
  r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: baja.email, password: baja.password } });
  check('login con la contraseña correcta de una cuenta deshabilitada → 403 CUENTA_DESHABILITADA', r.status === 403 && r.json?.code === 'CUENTA_DESHABILITADA');
  r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: baja.email, password: 'password-incorrecta-1' } });
  check('con contraseña incorrecta sigue siendo 401 genérico (no se revela que la cuenta existe)', r.status === 401 && r.json?.code === 'CREDENCIALES_INVALIDAS');
};

escenarios.E = async () => {
  await admin();
  seccion('1) Un endpoint protegido de cada servicio, sin token');
  for (const p of PROTEGIDOS) {
    const r = await probar(p);
    check(`${p.servicio}: ${p.metodo} ${new URL(p.url()).pathname} → 401 TOKEN_AUSENTE`, r.status === 401 && r.json?.code === 'TOKEN_AUSENTE');
  }
  seccion('2) Encabezado Authorization mal formado');
  for (const [desc, valor] of [['esquema distinto de Bearer', 'Basic dXNlcjpwYXNz'], ['Bearer sin token', 'Bearer'], ['token con espacios de más', 'Bearer abc def']]) {
    const r = await http('GET', `${URL_.usuarios}/usuarios`, { headers: { authorization: valor } });
    check(`${desc} → 401 TOKEN_INVALIDO`, r.status === 401 && r.json?.code === 'TOKEN_INVALIDO');
  }
  seccion('3) Control: no se protege todo; lo público sigue siendo público');
  for (const [desc, url] of [['GET /health de usuarios', `${URL_.usuarios}/health`], ['GET /eventos (catálogo)', `${URL_.eventos}/eventos`], ['GET /api-docs de entradas (Swagger)', `${URL_.entradas}/api-docs/`]]) {
    const r = await http('GET', url, { mostrar: false });
    check(`${desc} → 200 sin token`, r.status === 200);
  }
  seccion('4) El rechazo es controlado: sin stack traces ni detalles internos');
  const r = await http('GET', `${URL_.usuarios}/usuarios`, { mostrar: false });
  check('el cuerpo del 401 solo tiene message y code', Object.keys(r.json || {}).sort().join() === 'code,message' && !/at\s+\S+\s+\(/.test(r.text));
};

escenarios.F = async () => {
  const a = await usuario('A');
  seccion('1) Token propio con el payload modificado a mano (USER → ADMIN), conservando la firma original');
  const [h, , f] = a.token.split('.');
  const alterado = `${h}.${b64u(JSON.stringify({ ...claimsDe(a.token), role: 'ADMIN' }))}.${f}`;
  etiquetas.set(alterado, 'token ALTERADO (role USER→ADMIN)');
  for (const pr of PROTEGIDOS) {
    const r = await probar(pr, { token: alterado });
    check(`${pr.servicio}: la firma ya no valida → 401 TOKEN_INVALIDO`, r.status === 401 && r.json?.code === 'TOKEN_INVALIDO');
  }
  seccion('2) Suplantación: cambiar el sub por el de otra persona');
  const suplantado = `${h}.${b64u(JSON.stringify({ ...claimsDe(a.token), sub: '64b000000000000000000001' }))}.${f}`;
  etiquetas.set(suplantado, 'token ALTERADO (otro sub)');
  const r1 = await http('GET', `${URL_.usuarios}/usuarios/64b000000000000000000001`, { token: suplantado });
  check('→ 401 TOKEN_INVALIDO', r1.status === 401 && r1.json?.code === 'TOKEN_INVALIDO');
  seccion('3) Token firmado con una clave distinta de la configurada');
  const otraClave = fabricar(claimsBase(a.id, 'ADMIN'), { secreto: `otra-clave-${'x'.repeat(40)}`, etiqueta: 'token firmado con OTRA clave' });
  for (const pr of PROTEGIDOS) {
    const r = await probar(pr, { token: otraClave });
    check(`${pr.servicio}: → 401 TOKEN_INVALIDO`, r.status === 401 && r.json?.code === 'TOKEN_INVALIDO');
  }
  seccion('4) Token sin firma (alg: none)');
  const none = fabricar(claimsBase(a.id, 'ADMIN'), { sinFirma: true, etiqueta: 'token SIN FIRMA (alg none)' });
  for (const pr of PROTEGIDOS) {
    const r = await probar(pr, { token: none });
    check(`${pr.servicio}: → 401 TOKEN_INVALIDO`, r.status === 401 && r.json?.code === 'TOKEN_INVALIDO');
  }
  seccion('5) Algoritmo no esperado: firmado con la clave correcta pero con HS512');
  if (!SECRETO) {
    check('JWT_SECRET disponible en el .env de la raíz para fabricar el token', false, 'definí JWT_SECRET en el .env');
  } else {
    const hs512 = fabricar(claimsBase(a.id, 'USER'), { alg: 'HS512', etiqueta: 'token firmado con HS512' });
    const r = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: hs512 });
    check('el servicio solo acepta HS256 → 401 TOKEN_INVALIDO', r.status === 401 && r.json?.code === 'TOKEN_INVALIDO');
  }
  seccion('6) Basura con forma de token');
  const r2 = await http('GET', `${URL_.usuarios}/usuarios`, { headers: { authorization: 'Bearer abc.def.ghi' } });
  check('"abc.def.ghi" → 401 TOKEN_INVALIDO', r2.status === 401 && r2.json?.code === 'TOKEN_INVALIDO');
};

escenarios.G = async () => {
  const a = await usuario('A');
  if (!SECRETO) { check('JWT_SECRET disponible en el .env de la raíz para fabricar el token vencido', false, 'definí JWT_SECRET en el .env'); return; }
  seccion('1) Token con firma VÁLIDA pero vencido (exp en el pasado)');
  const vencido = fabricar({ ...claimsBase(a.id, 'USER'), iat: ahora() - 7200, exp: ahora() - 3600 }, { etiqueta: 'token VENCIDO' });
  nota(`claims: ${JSON.stringify(claimsDe(vencido))}  (venció hace ${ahora() - claimsDe(vencido).exp} s)`);
  for (const pr of PROTEGIDOS) {
    const r = await probar(pr, { token: vencido });
    check(`${pr.servicio}: → 401 TOKEN_VENCIDO`, r.status === 401 && r.json?.code === 'TOKEN_VENCIDO');
  }
  const r1 = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: vencido });
  check('también en un endpoint propio del usuario (GET /usuarios/:id) → 401 TOKEN_VENCIDO', r1.status === 401 && r1.json?.code === 'TOKEN_VENCIDO');
  seccion('2) Contraste: el mismo usuario con un token vigente sí pasa');
  const r2 = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: a.token });
  check('GET /usuarios/:id con el token vigente → 200', r2.status === 200);
  seccion('3) Un token sin vencimiento no se acepta (todo access token debe tener exp)');
  const { exp: _exp, ...sinExp } = claimsBase(a.id, 'USER');
  const sinVencimiento = fabricar(sinExp, { etiqueta: 'token SIN exp' });
  const r3 = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: sinVencimiento });
  check('token sin claim exp → 401 TOKEN_INVALIDO', r3.status === 401 && r3.json?.code === 'TOKEN_INVALIDO');
};

escenarios.H = async () => {
  const a = await usuario('A'); const b = await usuario('B'); const ad = await admin(); const ev = await evento();
  let r;
  seccion('Preparación: el ADMIN le compra una entrada a B (para tener una orden ajena)');
  r = await comprar(ad.token, b.id, ev.id, 1);
  const ordenB = r.json?.orden?.id;
  check('compra del ADMIN para B → 201', r.status === 201 && Boolean(ordenB));

  seccion('1) Un USER autenticado (válido) intenta operaciones exclusivas de ADMIN');
  r = await http('POST', `${URL_.eventos}/eventos`, { token: a.token, body: { nombre: 'Evento no autorizado', fecha: new Date(Date.now() + 864e5 * 30).toISOString(), lugar: 'Sala', precio: 1, aforoTotal: 1 } });
  check('USER crea un evento → 403 PERMISOS_INSUFICIENTES (no 401: su token es válido)', r.status === 403 && r.json?.code === 'PERMISOS_INSUFICIENTES');
  r = await http('PATCH', `${URL_.eventos}/eventos/${ev.id}/cancelar`, { token: a.token });
  check('USER cancela un evento → 403', r.status === 403);
  r = await http('GET', `${URL_.usuarios}/usuarios`, { token: a.token });
  check('USER lista todos los usuarios → 403', r.status === 403);
  r = await http('DELETE', `${URL_.usuarios}/usuarios/${b.id}`, { token: a.token });
  check('USER da de baja a otro usuario → 403', r.status === 403);
  r = await http('POST', `${URL_.entradas}/entradas/validar`, { token: a.token, body: { codigo: 'ABCDEFGHIJ' } });
  check('USER valida tickets en la puerta → 403', r.status === 403);

  seccion('2) Propiedad del recurso: USER A no puede tocar lo de USER B');
  r = await http('GET', `${URL_.usuarios}/usuarios/${b.id}`, { token: a.token });
  check('A consulta el perfil de B → 403', r.status === 403);
  r = await http('POST', `${URL_.entradas}/ordenes`, { token: a.token, body: { usuarioId: b.id, eventoId: ev.id, cantidad: 1 } });
  check('A compra a nombre de B → 403', r.status === 403);
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenB}`, { token: a.token });
  check('A consulta la orden de B → 403', r.status === 403);
  r = await http('DELETE', `${URL_.entradas}/ordenes/${ordenB}`, { token: a.token });
  check('A cancela la orden de B → 403', r.status === 403);
  r = await http('GET', `${URL_.entradas}/entradas?usuarioId=${b.id}`, { token: a.token });
  check('A lista las entradas de B → 403', r.status === 403);

  seccion('3) Nada de lo anterior tuvo efecto');
  r = await http('GET', `${URL_.usuarios}/usuarios/${b.id}`, { token: ad.token, mostrar: false });
  check('B sigue activo (no lo pudieron dar de baja)', r.json?.activo === true);
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenB}`, { token: ad.token, mostrar: false });
  check('la orden de B sigue CONFIRMADA (no la pudieron cancelar)', r.json?.orden?.estado === 'CONFIRMADA');

  seccion('4) Un USER tampoco puede escalar su propio rol');
  r = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: a.token, mostrar: false });
  const { id: _id, role: _role, activo: _activo, createdAt: _c, updatedAt: _u, edad: _e, ...editable } = r.json;
  r = await http('PUT', `${URL_.usuarios}/usuarios/${a.id}`, { token: a.token, body: { ...editable, role: 'ADMIN', activo: true } });
  nota(`la respuesta fue ${r.status}: el servidor ignora o rechaza el campo role`);
  r = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: ad.token, mostrar: false });
  check('el rol de A sigue siendo USER', r.json?.role === 'USER');
};

escenarios.I = async () => {
  const a = await usuario('A'); const ad = await admin(); const ev = await evento();
  let r;
  seccion('1) Rol ADMIN: operaciones de administración');
  r = await http('POST', `${URL_.eventos}/eventos`, { token: ad.token, body: { nombre: `Evento ADMIN ${unico()}`, fecha: new Date(Date.now() + 864e5 * 30).toISOString(), lugar: 'Sala TP7', precio: 100, aforoTotal: 10 } });
  check('ADMIN crea un evento → 201', r.status === 201);
  const nuevo = r.json?.id;
  r = await http('PUT', `${URL_.eventos}/eventos/${nuevo}`, { token: ad.token, body: { lugar: 'Sala B2' } });
  check('ADMIN modifica el evento → 200', r.status === 200 && r.json?.lugar === 'Sala B2');
  r = await http('PATCH', `${URL_.eventos}/eventos/${nuevo}/cancelar`, { token: ad.token });
  check('ADMIN cancela el evento → 200 CANCELADO', r.status === 200 && r.json?.estado === 'CANCELADO');
  r = await http('GET', `${URL_.usuarios}/usuarios`, { token: ad.token, mostrar: false });
  check('ADMIN lista los usuarios → 200 (y ninguno incluye contraseña ni hash)', r.status === 200 && Array.isArray(r.json) && !/passwordHash|"password"/.test(r.text));
  const extra = await registrar('USER descartable');
  r = await http('DELETE', `${URL_.usuarios}/usuarios/${extra.id}`, { token: ad.token });
  check('ADMIN da de baja a un usuario → 200', r.status === 200 && r.json?.activo === false);

  seccion('2) Rol USER: sus propias operaciones');
  r = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: a.token });
  check('USER consulta su propio perfil → 200', r.status === 200 && r.json?.id === a.id);
  r = await comprar(a.token, a.id, ev.id, 1);
  check('USER compra una entrada para sí mismo → 201 CONFIRMADA', r.status === 201 && r.json?.orden?.estado === 'CONFIRMADA');
  const ordenA = r.json?.orden?.id; const codigo = r.json?.tickets?.[0]?.codigo;
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenA}`, { token: a.token, mostrar: false });
  check('USER consulta su propia orden → 200', r.status === 200);
  r = await http('GET', `${URL_.entradas}/entradas?usuarioId=${a.id}`, { token: a.token, mostrar: false });
  check('USER lista sus propias entradas → 200', r.status === 200 && Array.isArray(r.json) && r.json.length > 0);

  seccion('3) Rol ADMIN en Entradas: valida el ticket en la puerta');
  r = await http('POST', `${URL_.entradas}/entradas/validar`, { token: ad.token, body: { codigo } });
  check('ADMIN valida el ticket → 200 (ingreso permitido)', r.status === 200);
  r = await http('POST', `${URL_.entradas}/entradas/validar`, { token: ad.token, body: { codigo }, mostrar: false });
  check('el mismo ticket otra vez → 409 (uso único)', r.status === 409);
};

escenarios.J = async () => {
  await admin();
  seccion('Caso de uso que atraviesa dos servicios: compra en Entradas → Usuarios y Eventos con el token propagado');
  nota('Se ejecuta scripts/tp7/propagacion.js j (su salida completa queda además en docs/evidencias/tp7/j.txt).');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'propagacion.js'), 'j', ...(GUARDAR ? [] : ['--no-guardar'])], { cwd: ROOT, encoding: 'utf8', env: process.env });
  const lineas = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/).map((l) => l.replace(ANSI, ''));
  lineas.filter((l) => /^\s*(▶|✔|✘|log:)/.test(l)).forEach((l) => out(/^\s*✔/.test(l) ? `${verde('  ✔ ')}${l.replace(/^\s*✔\s*/, '')}` : /^\s*✘/.test(l) ? `${rojo('  ✘ ')}${l.replace(/^\s*✘\s*/, '')}` : gris(l)));
  const resultado = lineas.find((l) => /^RESULTADO:/.test(l)) || '(sin resultado)';
  check(`propagacion.js j termina en OK — ${resultado}`, r.status === 0);
};

escenarios.K = async () => {
  const a = await usuario('A'); await admin();
  const tokenAnterior = a.token;
  seccion('1) Estado previo: el usuario A se registró y obtuvo un token antes del reinicio');
  nota('Usuario y token previos al reinicio listos.');
  seccion('2) Reiniciar la solución (se eliminan los contenedores, se CONSERVAN los volúmenes)');
  check('docker compose down', compose(['down']).code === 0);
  check('docker compose up -d', compose(['up', '-d'], { maxLineas: 6 }).code === 0);
  check('los tres servicios vuelven a estar disponibles', await esperar('usuarios, eventos y entradas respondiendo con sus bases conectadas', async () => {
    const l = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (l.status !== 200) return false;
    const e = await http('GET', `${URL_.eventos}/ready`, { mostrar: false, timeout: 3000 });
    const n = await http('GET', `${URL_.entradas}/entradas?usuarioId=${a.id}`, { token: l.json.token, mostrar: false, timeout: 3000 });
    return e.status === 200 && n.status === 200;
  }));

  seccion('3) Los usuarios persistidos siguen disponibles y el sistema vuelve a autenticar');
  let r = await login(a.email, a.password, true);
  check('el usuario registrado ANTES del reinicio inicia sesión con su contraseña → 200', r.status === 200);
  const nuevoToken = r.json?.token;
  if (nuevoToken) etiquetas.set(nuevoToken, 'token de USER A (nuevo)');
  r = await login(ADMIN_EMAIL, ADMIN_PASSWORD, true);
  check('el administrador del seed también → 200 con role ADMIN', r.status === 200 && claimsDe(r.json?.token || '').role === 'ADMIN');
  r = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: nuevoToken });
  check('el token nuevo permite consumir un endpoint protegido → 200', r.status === 200);
  r = await http('GET', `${URL_.usuarios}/usuarios/${a.id}`, { token: tokenAnterior });
  check('el token emitido ANTES del reinicio sigue siendo válido (mismo JWT_SECRET, sin sesiones en memoria) → 200', r.status === 200);

  seccion('4) Todo el circuito (autenticación + propagación) funciona después del reinicio');
  ctx.evento = null;
  const ev = await evento();
  r = await comprar(nuevoToken, a.id, ev.id, 1);
  check('compra del USER con el token nuevo → 201', r.status === 201);
};

escenarios.L = async () => {
  const a = await usuario('A');
  seccion('1) Inspeccionar la colección `usuarios` directamente en la base de usuarios-db');
  const js = `JSON.stringify({u: db.usuarios.findOne({email: "${a.email}"}), conPassword: db.usuarios.countDocuments({password: {$exists: true}}), sinHash: db.usuarios.countDocuments({passwordHash: {$exists: false}}), total: db.usuarios.countDocuments({})})`;
  const r = compose(['exec', '-T', 'usuarios-db', 'mongosh', '--quiet', 'usuarios', '--eval', js], { mostrar: true, maxLineas: 3 });
  let d = null;
  try { d = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { /* se informa abajo */ }
  check('se pudo leer la base de datos de usuarios', Boolean(d && d.u), r.stderr.slice(0, 160));
  if (!d || !d.u) return;
  const hash = d.u.passwordHash;
  nota(`campos del documento: ${Object.keys(d.u).join(', ')}`);
  nota(`passwordHash: ${typeof hash === 'string' ? `${hash.slice(0, 7)}… (${hash.length} caracteres)` : '(no existe)'}`);

  seccion('2) La contraseña está guardada como hash bcrypt y no en texto plano');
  check('existe el campo passwordHash con formato bcrypt ($2a$/$2b$, costo y 60 caracteres)', typeof hash === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(hash) && hash.length === 60);
  check(`el costo de bcrypt coincide con BCRYPT_ROUNDS (${ENV.BCRYPT_ROUNDS || 12})`, typeof hash === 'string' && Number(hash.slice(4, 6)) === Number(ENV.BCRYPT_ROUNDS || 12));
  check('el hash no es la contraseña ni la contiene', typeof hash === 'string' && hash !== a.password && !hash.includes(a.password));
  check('NO existe ningún campo `password` en el documento', !('password' in d.u));
  check('la contraseña no aparece en ninguna parte del documento', !JSON.stringify(d.u).includes(a.password));
  check(`ningún documento de la colección tiene un campo password (${d.total} documentos revisados)`, d.conPassword === 0);
  check('todos los documentos tienen passwordHash', d.sinHash === 0, `${d.sinHash} sin credenciales: ejecutá el seed de usuarios`);
  check('el rol y el estado se guardan junto al hash (role, activo)', d.u.role === 'USER' && d.u.activo === true);
  nota('El hash se generó con un salt propio (bcryptjs lo guarda dentro del propio hash): dos usuarios con la misma contraseña tienen hashes distintos.');
};

// ================================================================== ejecución
async function ejecutar(letra) {
  buffer = []; okActual = 0; fallosActual = 0;
  out(negrita('\n════════════════════════════════════════════════════════════════'));
  out(negrita(` TP7 · escenario ${letra} · ${NOMBRES[letra]}`));
  out(negrita('════════════════════════════════════════════════════════════════'));
  const d = docker(['--version'], { mostrar: false });
  const c = docker(['compose', 'version'], { mostrar: false });
  out(gris(` fecha: ${new Date().toISOString()}   equipo: ${os.platform()} ${os.release()}   node ${process.version}`));
  out(gris(` ${d.stdout.trim() || 'docker: no disponible'}  ·  ${c.stdout.trim() || 'docker compose: no disponible'}`));
  try { await escenarios[letra](); } catch (e) { fallosActual += 1; out(rojo(`\n  ✘ El escenario se interrumpió: ${e.message}`)); }
  const ok = fallosActual === 0;
  out(`\n${ok ? verde(`RESULTADO: ${letra} → OK (${okActual} verificaciones)`) : rojo(`RESULTADO: ${letra} → FALLO (${fallosActual} de ${okActual + fallosActual} verificaciones fallaron)`)}`);
  if (GUARDAR) {
    fs.mkdirSync(EVID_DIR, { recursive: true });
    const archivo = path.join(EVID_DIR, `${letra}-${NOMBRES[letra]}.txt`);
    fs.writeFileSync(archivo, `${buffer.join('\n')}\n`, 'utf8');
    out(gris(`Evidencia guardada en ${path.relative(ROOT, archivo)}`));
  }
  return { letra, ok, verificaciones: okActual + fallosActual, fallos: fallosActual };
}

(async () => {
  const letra = (PRUEBA || '').toUpperCase();
  if (!PRUEBA || (letra !== 'TODO' && !escenarios[letra])) {
    console.log(`Uso: node scripts/tp7/pruebas.js <A..L | todo> [--no-guardar]\n\n${Object.keys(NOMBRES).map((k) => `  ${k}  ${NOMBRES[k]}`).join('\n')}`);
    process.exit(PRUEBA ? 2 : 0);
  }
  const lista = letra === 'TODO' ? Object.keys(NOMBRES) : [letra];
  const resultados = [];
  for (const l of lista) resultados.push(await ejecutar(l));
  if (lista.length > 1) {
    const resumen = resultados.map((r) => `${r.ok ? 'OK   ' : 'FALLO'}  ${r.letra}  ${NOMBRES[r.letra].padEnd(16)} ${r.verificaciones} verificaciones${r.fallos ? `, ${r.fallos} fallidas` : ''}`);
    out(negrita('\n════════════════════════ RESUMEN ════════════════════════'));
    resultados.forEach((r, i) => out(`  ${r.ok ? verde(resumen[i].slice(0, 5)) : rojo(resumen[i].slice(0, 5))}${resumen[i].slice(5)}`));
    if (GUARDAR) {
      fs.mkdirSync(EVID_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVID_DIR, 'resumen.txt'), `TP7 - resumen de los escenarios A-L (${new Date().toISOString()})\n\n${resumen.join('\n')}\n`, 'utf8');
    }
  }
  process.exit(resultados.every((r) => r.ok) ? 0 : 1);
})();
