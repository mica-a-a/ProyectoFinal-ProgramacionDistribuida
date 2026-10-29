#!/usr/bin/env node
/*
 * TP7 - Integración entre microservicios y propagación del token (escenario J y sección 12 de la consigna).
 *
 *   node scripts/tp7/propagacion.js <prueba> [--no-guardar]
 *
 * Requisitos: Node 20+, Docker y la solución levantada (docker compose up --build -d) con los datos de prueba:
 *   docker compose exec -T usuarios-service npm run seed      (crea al administrador admin@example.com)
 *   docker compose exec -T eventos-service npm run seed
 * Lee el .env de la raíz (JWT_SECRET, SEED_ADMIN_PASSWORD, puertos), igual que Docker Compose.
 *
 * Pruebas:
 *   j                (Escenario J)   Un caso de uso que atraviesa dos servicios conserva la identidad
 *   disponibilidad   (Sección 12)    Qué pasa si Usuarios cae DESPUÉS de haber emitido el token
 *   logs-seguridad   (Sección 17)    Los logs no contienen tokens, contraseñas ni hashes
 *   todo             las tres, en orden, con resumen
 *
 * Cada prueba imprime los comandos que ejecuta y guarda la salida en docs/evidencias/tp7/<prueba>.txt.
 * SEGURIDAD (sección 15): todo lo que se imprime y se guarda tiene los tokens y contraseñas ENMASCARADOS,
 * así que esas evidencias se pueden adjuntar al informe y subir a Git.
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
const ADMIN_EMAIL = ENV.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || ENV.SEED_ADMIN_PASSWORD;
const PASSWORD_USUARIOS = 'Clave-Prueba-Tp7-1';

const args = process.argv.slice(2);
const FLAGS = new Set(args.filter((a) => a.startsWith('--')));
const PRUEBA = args.find((a) => !a.startsWith('--'));
const GUARDAR = !FLAGS.has('--no-guardar');

// ------------------------------------------------------------------ salida (con enmascarado de secretos)
const ANSI = /\x1b\[[0-9;]*m/g;
const color = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const verde = color(32); const rojo = color(31); const gris = color(90); const azul = color(36); const negrita = color(1);

const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const JWT_SUELTO = /eyJ[\w-]+\.[\w-]+\.[\w-]+/; // sin /g: .test() no arrastra estado
const secretos = new Set(); // contraseñas que se usaron en esta corrida
function enmascarar(t) {
  let s = String(t).replace(JWT_RE, 'eyJ…<JWT enmascarado>');
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
const etiquetas = new Map(); // token -> nombre legible para mostrar en los comandos
const b64u = (x) => Buffer.from(x).toString('base64url');
const claimsDe = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };

// HS256 a mano (sin dependencias): permite fabricar tokens vencidos o alterados para las pruebas de rechazo.
function firmarHS256(payload, secreto) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac('sha256', secreto).update(`${h}.${p}`).digest('base64url')}`;
}

// ------------------------------------------------------------------ http / docker
async function http(metodo, url, { body, token, mostrar = true, timeout = 8000 } = {}) {
  if (mostrar) {
    const h = token ? ` -H "Authorization: Bearer <${etiquetas.get(token) || 'token'}>"` : '';
    const d = body !== undefined ? ` -H "content-type: application/json" -d '${JSON.stringify(body)}'` : '';
    out(gris(`  $ curl -s -X ${metodo} ${url}${h}${d}`));
  }
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
  if (mostrar) out(gris(`  ← ${res.status} ${recortar(text, 230)}`));
  return { status: res.status, json, text };
}

function docker(argv, { mostrar = true, maxLineas = 12 } = {}) {
  if (mostrar) out(gris(`  $ docker ${argv.join(' ')}`));
  const r = spawnSync('docker', argv, { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (r.error) { out(rojo(`  No se pudo ejecutar docker: ${r.error.message}`)); return { code: -1, stdout: '', stderr: r.error.message }; }
  const texto = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (mostrar && texto) texto.split(/\r?\n/).slice(-maxLineas).forEach((l) => out(gris(`    ${l}`)));
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const compose = (argv, opts) => docker(['compose', ...argv], opts);

// Eventos de log (JSON por stdout) de un servicio, tal como los ve `docker compose logs`.
async function logsDe(servicio, tail = 400) {
  await sleep(400); // los logs de "request" se escriben al terminar la respuesta
  const r = compose(['logs', '--no-color', '--no-log-prefix', '--tail', String(tail), servicio], { mostrar: false });
  return r.stdout.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const resumenLog = (l) => `${l.service} ${l.method || ''} ${l.path || l.message} → ${l.status || ''} sub=${l.sub || '-'} role=${l.role || '-'}`.replace(/\s+/g, ' ');
function mostrarLogs(lineas) { lineas.slice(-2).forEach((l) => out(gris(`    log: ${resumenLog(l)}`))); }

async function esperar(desc, fn, { timeoutMs = 90000, cadaMs = 2000 } = {}) {
  const t0 = Date.now();
  nota(`… esperando: ${desc}`);
  while (Date.now() - t0 < timeoutMs) {
    try { if (await fn()) { nota(`… listo (${Math.round((Date.now() - t0) / 1000)} s)`); return true; } } catch { /* reintenta */ }
    await sleep(cadaMs);
  }
  out(rojo(`  … tiempo agotado esperando: ${desc}`));
  return false;
}

// ------------------------------------------------------------------ preparación (se hace una sola vez)
const SUF = Date.now().toString(36);
const ctx = {};

async function login(email, password, mostrar = false) {
  secretos.add(password);
  return http('POST', `${URL_.usuarios}/auth/login`, { body: { email, password }, mostrar });
}

async function registrar(letra) {
  const u = `${SUF}${letra}`;
  const datos = {
    nombre: `Prueba${letra}`, apellido: `Tp7${u}`, email: `tp7.${u}@example.com`,
    dni: String(20000000 + Math.floor(Math.random() * 9e6)), fechaNacimiento: '1995-04-12', password: PASSWORD_USUARIOS,
  };
  secretos.add(PASSWORD_USUARIOS);
  const r = await http('POST', `${URL_.usuarios}/auth/register`, { body: datos, mostrar: false });
  if (r.status !== 201) throw new Error(`no se pudo registrar al usuario ${letra} (HTTP ${r.status}): ${r.text}`);
  const l = await login(datos.email, PASSWORD_USUARIOS);
  if (l.status !== 200) throw new Error(`no se pudo iniciar sesión con el usuario ${letra} (HTTP ${l.status})`);
  etiquetas.set(l.json.token, `token de USER ${letra}`);
  return { letra, id: r.json.id, email: datos.email, token: l.json.token };
}

async function preparar() {
  if (ctx.listo) return;
  seccion('Preparación: iniciar sesión como administrador y registrar a dos usuarios');
  for (const [n, u] of Object.entries(URL_)) {
    const r = await http('GET', `${u}/health`, { mostrar: false, timeout: 3000 });
    if (r.status !== 200) throw new Error(`${n}-service no responde en ${u}. Ejecutá primero: docker compose up --build -d`);
  }
  if (!ADMIN_PASSWORD) throw new Error('Falta la contraseña del administrador: definí SEED_ADMIN_PASSWORD en el .env de la raíz.');
  const a = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (a.status !== 200) throw new Error(`no se pudo iniciar sesión como ${ADMIN_EMAIL} (HTTP ${a.status}). ¿Corriste el seed de usuarios con la misma SEED_ADMIN_PASSWORD?`);
  ctx.admin = { id: claimsDe(a.json.token).sub, token: a.json.token };
  etiquetas.set(ctx.admin.token, 'token de ADMIN');
  ctx.A = await registrar('A');
  ctx.B = await registrar('B');
  for (const [n, t] of [['ADMIN', ctx.admin.token], ['USER A', ctx.A.token], ['USER B', ctx.B.token]]) {
    const c = claimsDe(t);
    nota(`${n}: claims { sub: ${c.sub}, role: ${c.role}, iss: ${c.iss}, vence en ${c.exp - c.iat} s }`);
  }
  const ev = await http('POST', `${URL_.eventos}/eventos`, {
    token: ctx.admin.token, mostrar: false,
    body: { nombre: `Evento TP7 ${SUF}`, fecha: new Date(Date.now() + 30 * 864e5).toISOString(), lugar: 'Sala TP7', precio: 2500, aforoTotal: 10 },
  });
  if (ev.status !== 201) throw new Error(`el ADMIN no pudo crear el evento de prueba (HTTP ${ev.status}): ${ev.text}`);
  ctx.eventoId = ev.json.id;
  nota(`evento de prueba ${ctx.eventoId} (aforo 10)`);
  ctx.listo = true;
}

const aforo = async () => (await http('GET', `${URL_.eventos}/eventos/${ctx.eventoId}`, { mostrar: false })).json?.disponibles;
const comprar = (token, usuarioId, cantidad) => http('POST', `${URL_.entradas}/ordenes`, { token, body: { usuarioId, eventoId: ctx.eventoId, cantidad } });

// ================================================================== PRUEBAS
const pruebas = {};

pruebas.j = async () => {
  await preparar();
  const { admin, A, B } = ctx;
  let r;

  seccion('1) Sin identidad no pasa nada: Entradas rechaza antes de llamar a otro servicio');
  r = await comprar(undefined, A.id, 1);
  check('POST /ordenes sin token → 401 TOKEN_AUSENTE', r.status === 401 && r.json?.code === 'TOKEN_AUSENTE');
  check('el aforo no cambió (10)', (await aforo()) === 10);

  seccion('2) USER A compra para sí mismo: Entradas propaga SU token a Usuarios y a Eventos');
  r = await comprar(A.token, A.id, 2);
  check('POST /ordenes (2 entradas) → 201 CONFIRMADA con 2 tickets', r.status === 201 && r.json?.orden?.estado === 'CONFIRMADA' && r.json?.tickets?.length === 2);
  const ordenA = r.json?.orden?.id;
  check('Eventos descontó el aforo: disponibles = 8', (await aforo()) === 8);
  nota('Evidencia de que la identidad llegó a los otros servicios (logs de request con sub y role):');
  let l = (await logsDe('usuarios-service')).filter((x) => x.path === `/usuarios/${A.id}` && x.sub === A.id);
  mostrarLogs(l);
  check('usuarios-service recibió GET /usuarios/:id autenticado como USER A (200)', l.some((x) => x.status === 200 && x.role === 'USER'));
  l = (await logsDe('eventos-service')).filter((x) => x.path === `/eventos/${ctx.eventoId}/reservar-aforo` && x.sub === A.id);
  mostrarLogs(l);
  check('eventos-service recibió reservar-aforo autenticado como USER A (200)', l.some((x) => x.status === 200 && x.role === 'USER'));

  seccion('3) Contraste: los servicios internos exigen identidad; por eso Entradas tiene que propagarla');
  r = await http('GET', `${URL_.usuarios}/usuarios/${A.id}`);
  check('GET /usuarios/:id directo y sin token → 401 TOKEN_AUSENTE', r.status === 401 && r.json?.code === 'TOKEN_AUSENTE');
  r = await http('POST', `${URL_.eventos}/eventos/${ctx.eventoId}/reservar-aforo`, { body: { cantidad: 1, referencia: `sin-token-${SUF}` } });
  check('POST reservar-aforo directo y sin token → 401 TOKEN_AUSENTE', r.status === 401 && r.json?.code === 'TOKEN_AUSENTE');
  check('el aforo sigue en 8', (await aforo()) === 8);

  seccion('4) Propiedad del recurso: USER A no puede comprar a nombre de B (403, sin tocar a nadie)');
  r = await comprar(A.token, B.id, 1);
  check('POST /ordenes de A para B → 403 PERMISOS_INSUFICIENTES', r.status === 403 && r.json?.code === 'PERMISOS_INSUFICIENTES');
  l = (await logsDe('usuarios-service')).filter((x) => x.path === `/usuarios/${B.id}`);
  check('usuarios-service NO recibió ninguna consulta sobre B (Entradas cortó antes)', l.length === 0, `${l.length} consultas`);
  check('el aforo sigue en 8', (await aforo()) === 8);

  seccion('5) ADMIN compra para B: viaja la identidad del ADMIN y Usuarios lo autoriza por su rol');
  r = await comprar(admin.token, B.id, 1);
  check('POST /ordenes del ADMIN para B → 201 CONFIRMADA', r.status === 201 && r.json?.orden?.estado === 'CONFIRMADA');
  const ordenB = r.json?.orden?.id;
  l = (await logsDe('usuarios-service')).filter((x) => x.path === `/usuarios/${B.id}`);
  mostrarLogs(l);
  check('usuarios-service recibió GET /usuarios/:idB como ADMIN (sub = id del ADMIN, 200)', l.some((x) => x.sub === admin.id && x.role === 'ADMIN' && x.status === 200));
  check('Eventos descontó el aforo: disponibles = 7', (await aforo()) === 7);

  seccion('6) La autorización se conserva al consultar lo comprado');
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenB}`, { token: A.token });
  check('USER A consulta la orden de B → 403', r.status === 403);
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenB}`, { token: B.token, mostrar: false });
  check('USER B consulta su propia orden → 200', r.status === 200);
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenB}`, { token: admin.token, mostrar: false });
  check('ADMIN consulta la orden de B → 200', r.status === 200);

  seccion('7) Cancelar también propaga el token (liberar-aforo)');
  r = await http('DELETE', `${URL_.entradas}/ordenes/${ordenA}`, { token: A.token });
  check('USER A cancela su orden → 200 CANCELADA', r.status === 200 && r.json?.orden?.estado === 'CANCELADA');
  l = (await logsDe('eventos-service')).filter((x) => x.path === `/eventos/${ctx.eventoId}/liberar-aforo` && x.sub === A.id);
  mostrarLogs(l);
  check('eventos-service recibió liberar-aforo autenticado como USER A (200)', l.some((x) => x.status === 200));
  check('el aforo volvió a 9', (await aforo()) === 9);

  seccion('8) Un token inválido no se propaga: se rechaza en la puerta de Entradas');
  const secreto = ENV.JWT_SECRET;
  if (!secreto) {
    nota('JWT_SECRET no está en el .env de la raíz: se omiten los tokens fabricados.');
  } else {
    const aforoAntes = await aforo();
    const ahora = Math.floor(Date.now() / 1000);
    const vencido = firmarHS256({ sub: A.id, role: 'USER', iss: 'usuarios-service', iat: ahora - 7200, exp: ahora - 3600 }, secreto);
    etiquetas.set(vencido, 'token VENCIDO');
    r = await comprar(vencido, A.id, 1);
    check('token vencido → 401 TOKEN_VENCIDO', r.status === 401 && r.json?.code === 'TOKEN_VENCIDO');
    const [h, p, f] = A.token.split('.');
    const alterado = `${h}.${b64u(JSON.stringify({ ...claimsDe(A.token), role: 'ADMIN' }))}.${f}`;
    etiquetas.set(alterado, 'token ALTERADO (USER→ADMIN)');
    r = await comprar(alterado, A.id, 1);
    check('token con el rol alterado a mano → 401 TOKEN_INVALIDO', r.status === 401 && r.json?.code === 'TOKEN_INVALIDO');
    check(`el aforo no cambió (${aforoAntes}): nada llegó a Eventos`, (await aforo()) === aforoAntes);
  }
};

pruebas.disponibilidad = async () => {
  await preparar();
  const { admin, A } = ctx;
  let r;
  seccion('1) Con todo levantado: A compra y se obtiene una orden');
  r = await comprar(A.token, A.id, 1);
  check('compra → 201', r.status === 201);
  const ordenA = r.json?.orden?.id;

  seccion('2) Detener únicamente usuarios-service (el emisor de tokens) DESPUÉS de haber emitido los tokens');
  check('docker compose stop usuarios-service', compose(['stop', 'usuarios-service']).code === 0);

  seccion('3) Lo que SIGUE funcionando: la validación del token es local en cada servicio');
  r = await http('POST', `${URL_.eventos}/eventos`, {
    token: admin.token,
    body: { nombre: `Evento sin Usuarios ${SUF}`, fecha: new Date(Date.now() + 30 * 864e5).toISOString(), lugar: 'Sala TP7', precio: 100, aforoTotal: 5 },
  });
  check('ADMIN crea un evento → 201 (Eventos valida el token por sí mismo)', r.status === 201);
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenA}`, { token: A.token });
  check('USER A consulta su orden → 200 (Entradas valida el token por sí mismo)', r.status === 200);
  r = await http('GET', `${URL_.eventos}/eventos`, { mostrar: false });
  check('el catálogo público sigue disponible → 200', r.status === 200);

  seccion('4) Lo que DEJA de funcionar: lo que depende de Usuarios, con error controlado');
  r = await comprar(A.token, A.id, 1);
  check('comprar → 503 DEPENDENCIA_NO_DISPONIBLE (no un 500; Entradas no se cae)', r.status === 503 && r.json?.code === 'DEPENDENCIA_NO_DISPONIBLE');
  const l = (await logsDe('entradas-service')).filter((x) => x.message === 'dependencia no disponible' && x.dependency === 'usuarios-service');
  mostrarLogs(l.map((x) => ({ ...x, path: `dependencia ${x.dependency} (${x.cause})` })));
  check('el fallo queda en el log de Entradas con la dependencia remota', l.length > 0);
  r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: A.email, password: PASSWORD_USUARIOS } });
  check('el login no está disponible (el servicio emisor está caído)', r.status === 0 || r.status >= 500);

  seccion('5) Reiniciar usuarios-service: el token emitido ANTES de la caída sigue siendo válido');
  check('docker compose start usuarios-service', compose(['start', 'usuarios-service']).code === 0);
  check('usuarios-service vuelve a responder', await esperar('login disponible', async () => (await login(A.email, PASSWORD_USUARIOS)).status === 200));
  r = await http('GET', `${URL_.usuarios}/usuarios/${A.id}`, { token: A.token });
  check('el token viejo de A sigue valiendo: GET /usuarios/:id → 200 (no hay sesión que perder)', r.status === 200);
  r = await comprar(A.token, A.id, 1);
  check('la compra vuelve a funcionar con el mismo token → 201', r.status === 201);
};

pruebas['logs-seguridad'] = async () => {
  await preparar();
  seccion('1) Provocar un login fallido y uno exitoso para que existan eventos de autenticación');
  let r = await http('POST', `${URL_.usuarios}/auth/login`, { body: { email: ctx.A.email, password: 'password-incorrecta-1' } });
  check('login con contraseña incorrecta → 401 CREDENCIALES_INVALIDAS (mensaje genérico)', r.status === 401 && r.json?.code === 'CREDENCIALES_INVALIDAS');
  secretos.add('password-incorrecta-1');

  seccion('2) Revisar los logs de los tres servicios');
  const todos = {};
  for (const s of ['usuarios-service', 'eventos-service', 'entradas-service']) {
    const bruto = (compose(['logs', '--no-color', '--no-log-prefix', '--tail', '2000', s], { mostrar: false }).stdout);
    todos[s] = bruto;
    nota(`${s}: ${bruto.split(/\r?\n/).filter(Boolean).length} líneas revisadas`);
  }
  const usuariosLog = (await logsDe('usuarios-service', 2000));
  check('hay eventos de login exitoso registrados', usuariosLog.some((x) => x.message === 'login exitoso'));
  const fallido = usuariosLog.filter((x) => x.message === 'login fallido').slice(-1);
  fallido.forEach((x) => out(gris(`    log: ${JSON.stringify(x)}`)));
  check('hay eventos de login fallido registrados (con el motivo técnico, sin la contraseña)', fallido.length > 0);

  for (const [s, texto] of Object.entries(todos)) {
    check(`${s}: ningún JWT en los logs`, !JWT_SUELTO.test(texto));
    check(`${s}: ninguna contraseña en los logs`, ![...secretos].some((p) => p && texto.includes(p)));
    check(`${s}: ningún hash bcrypt en los logs`, !/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,}/.test(texto));
  }
  if (ENV.JWT_SECRET) check('ningún log contiene el JWT_SECRET', !Object.values(todos).some((t) => t.includes(ENV.JWT_SECRET)));
};

// ================================================================== ejecución
async function ejecutar(nombre) {
  buffer = []; okActual = 0; fallosActual = 0;
  out(negrita('\n════════════════════════════════════════════════════════════════'));
  out(negrita(` TP7 · prueba: ${nombre}`));
  out(negrita('════════════════════════════════════════════════════════════════'));
  const d = docker(['--version'], { mostrar: false });
  const c = docker(['compose', 'version'], { mostrar: false });
  out(gris(` fecha: ${new Date().toISOString()}   equipo: ${os.platform()} ${os.release()}   node ${process.version}`));
  out(gris(` ${d.stdout.trim() || 'docker: no disponible'}  ·  ${c.stdout.trim() || 'docker compose: no disponible'}`));
  try { await pruebas[nombre](); } catch (e) { fallosActual += 1; out(rojo(`\n  ✘ La prueba se interrumpió: ${e.message}`)); }
  const ok = fallosActual === 0;
  out(`\n${ok ? verde(`RESULTADO: ${nombre} → OK (${okActual} verificaciones)`) : rojo(`RESULTADO: ${nombre} → FALLO (${fallosActual} de ${okActual + fallosActual} verificaciones fallaron)`)}`);
  if (GUARDAR) {
    fs.mkdirSync(EVID_DIR, { recursive: true });
    const archivo = path.join(EVID_DIR, `${nombre}.txt`);
    fs.writeFileSync(archivo, `${buffer.join('\n')}\n`, 'utf8');
    out(gris(`Evidencia guardada en ${path.relative(ROOT, archivo)}`));
  }
  return { nombre, ok, verificaciones: okActual + fallosActual, fallos: fallosActual };
}

(async () => {
  const orden = ['j', 'disponibilidad', 'logs-seguridad'];
  if (!PRUEBA || (PRUEBA !== 'todo' && !pruebas[PRUEBA])) {
    console.log(`Uso: node scripts/tp7/propagacion.js <prueba> [--no-guardar]\n\nPruebas: ${orden.join(', ')}, todo`);
    process.exit(PRUEBA ? 2 : 0);
  }
  const lista = PRUEBA === 'todo' ? orden : [PRUEBA];
  const resultados = [];
  for (const n of lista) resultados.push(await ejecutar(n));
  if (lista.length > 1) {
    out(negrita('\n════════════════════════ RESUMEN ════════════════════════'));
    for (const r of resultados) out(`  ${r.ok ? verde('OK   ') : rojo('FALLO')}  ${r.nombre.padEnd(18)} ${r.verificaciones} verificaciones${r.fallos ? `, ${r.fallos} fallidas` : ''}`);
  }
  process.exit(resultados.every((r) => r.ok) ? 0 : 1);
})();
