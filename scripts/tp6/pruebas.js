#!/usr/bin/env node
/*
 * TP6 - Pruebas obligatorias (seccion 18 de la consigna), reproducibles con un comando.
 *
 *   node scripts/tp6/pruebas.js <prueba> [opciones]
 *
 * Requisitos: Node 20+ y Docker. No instala dependencias (usa solo modulos nativos).
 * Cada prueba imprime los comandos que ejecuta y el resultado (OK / FALLO), y guarda la
 * salida completa en docs/evidencias/tp6/<prueba>.txt para adjuntarla como evidencia.
 *
 * Pruebas (el nombre entre parentesis es la fila de la tabla del punto 18):
 *   build              (Build individual)           docker build de cada Dockerfile
 *   inicio             (Inicio con Compose)         docker compose up --build y estado de los 7 contenedores
 *   health             (Health)                     /health de cada servicio
 *   datos              (Datos de prueba)            deja un estado inicial conocido (seeds)
 *   negocio            (CRUD / negocio + Comunicacion)  operaciones principales y compra entre los 3 servicios
 *   datos-propios      (Propiedad de datos)         cada servicio solo ve su base
 *   swagger            (Swagger)                    /api-docs de cada servicio
 *   fallo-dependencia  (Fallo de dependencia)       se detiene usuarios-service (prueba 15.1)
 *   fallo-redis        (Startup / disponibilidad)   se detiene Redis
 *   fallo-db           (Startup / disponibilidad)   se detiene usuarios-db
 *   fallo-parcial      (Fallo parcial)              orden PENDIENTE por falla en una etapa intermedia
 *   logs               (Logs)                       docker compose logs de cada servicio
 *   persistencia       (Persistencia)               down / up conservando volumenes
 *   todo               ejecuta todas, en el orden correcto, y muestra un resumen
 *
 * Opciones:
 *   --con-down-v   (solo persistencia) ademas demuestra que `down -v` BORRA los datos
 *   --no-guardar   no escribe archivos de evidencia
 *
 * Config: lee el .env de la raiz (mismas variables que docker-compose.yml) para los puertos.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ------------------------------------------------------------------ configuracion
const ROOT = path.resolve(__dirname, '..', '..');
const EVID_DIR = path.join(ROOT, 'docs', 'evidencias', 'tp6');

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

// TP7: casi todos los endpoints exigen token. Estas pruebas operan como el ADMIN del seed (puede todo) y obtienen
// el token UNA vez, antes de detener ningun servicio. Hace falta SEED_ADMIN_PASSWORD (o ADMIN_PASSWORD) en el .env.
const ADMIN_EMAIL = ENV.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || ENV.SEED_ADMIN_PASSWORD;
let tokenAdminCache = null;
const PREFIJO = ENV.IMAGE_PREFIX || 'grupo';
const SERVICIOS = ['usuarios-service', 'eventos-service', 'entradas-service'];
const URL_ = {
  usuarios: `http://localhost:${ENV.USUARIOS_HOST_PORT || 3001}`,
  eventos: `http://localhost:${ENV.EVENTOS_HOST_PORT || 3002}`,
  entradas: `http://localhost:${ENV.ENTRADAS_HOST_PORT || 3003}`,
};
const VOLUMENES = ['usuarios-data', 'eventos-data', 'entradas-data'];

const args = process.argv.slice(2);
const FLAGS = new Set(args.filter((a) => a.startsWith('--')));
const PRUEBA = args.find((a) => !a.startsWith('--'));
const GUARDAR = !FLAGS.has('--no-guardar');

// ------------------------------------------------------------------ salida
const ANSI = /\x1b\[[0-9;]*m/g;
const color = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const verde = color(32);
const rojo = color(31);
const gris = color(90);
const azul = color(36);
const negrita = color(1);

let buffer = [];
let okActual = 0;
let fallosActual = 0;

function out(linea = '') {
  console.log(linea);
  buffer.push(String(linea).replace(ANSI, ''));
}
const recortar = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(desc, cond, detalle = '') {
  if (cond) {
    okActual += 1;
    out(`${verde('  ✔ ')}${desc}`);
  } else {
    fallosActual += 1;
    out(`${rojo('  ✘ ')}${desc}${detalle ? gris(`   → ${detalle}`) : ''}`);
  }
  return Boolean(cond);
}
const seccion = (t) => out(`\n${azul(`▶ ${t}`)}`);
const nota = (t) => out(gris(`  ${t}`));

// ------------------------------------------------------------------ docker / http
function docker(argv, { mostrar = true, maxLineas = 25 } = {}) {
  if (mostrar) out(gris(`  $ docker ${argv.join(' ')}`));
  const r = spawnSync('docker', argv, { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (r.error) {
    out(rojo(`  No se pudo ejecutar docker: ${r.error.message}`));
    return { code: -1, stdout: '', stderr: r.error.message };
  }
  const texto = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (mostrar && texto) {
    const lineas = texto.split(/\r?\n/);
    if (lineas.length > maxLineas) out(gris(`    … (${lineas.length - maxLineas} líneas anteriores omitidas)`));
    for (const l of lineas.slice(-maxLineas)) out(gris(`    ${l}`));
  }
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const compose = (argv, opts) => docker(['compose', ...argv], opts);

async function tokenAdmin() {
  if (tokenAdminCache) return tokenAdminCache;
  if (!ADMIN_PASSWORD) return null;
  try {
    const res = await fetch(`${URL_.usuarios}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }), signal: AbortSignal.timeout(8000),
    });
    if (res.ok) tokenAdminCache = (await res.json()).token;
  } catch { /* sin usuarios-service no hay token: los pedidos darán 401 y la prueba lo informará */ }
  return tokenAdminCache;
}

async function http(metodo, url, cuerpo, { mostrar = true, timeout = 8000 } = {}) {
  const token = await tokenAdmin();
  if (mostrar) {
    const h = token ? ' -H "Authorization: Bearer <token de ADMIN>"' : '';
    const d = cuerpo !== undefined ? ` -H "content-type: application/json" -d '${JSON.stringify(cuerpo).replace(/"password":"[^"]*"/g, '"password":"***"')}'` : '';
    out(gris(`  $ curl -s -X ${metodo} ${url}${h}${d}`));
  }
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    if (mostrar) out(gris(`  ← sin respuesta (${e.cause?.code || e.name})`));
    return { status: 0, json: null, text: '', error: e };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  if (mostrar) out(gris(`  ← ${res.status} ${recortar(text, 230)}`));
  return { status: res.status, json, text };
}

async function esperar(desc, fn, { timeoutMs = 120000, cadaMs = 2000 } = {}) {
  const t0 = Date.now();
  nota(`… esperando: ${desc}`);
  while (Date.now() - t0 < timeoutMs) {
    try { if (await fn()) { nota(`… listo (${Math.round((Date.now() - t0) / 1000)} s)`); return true; } } catch { /* reintenta */ }
    await sleep(cadaMs);
  }
  out(rojo(`  … tiempo agotado esperando: ${desc}`));
  return false;
}

// "Listo" = el servicio responde Y su base esta conectada (no solo que el proceso este vivo).
const listo = {
  usuarios: async () => (await http('GET', `${URL_.usuarios}/usuarios`, undefined, { mostrar: false, timeout: 3000 })).status === 200,
  eventos: async () => (await http('GET', `${URL_.eventos}/ready`, undefined, { mostrar: false, timeout: 3000 })).status === 200,
  entradas: async () => (await http('GET', `${URL_.entradas}/entradas?usuarioId=ping`, undefined, { mostrar: false, timeout: 3000 })).status === 200,
};
const esperarServicio = (n) => esperar(`${n}-service listo (con su base conectada)`, listo[n]);
async function esperarTodos() {
  const r = [];
  for (const n of ['usuarios', 'eventos', 'entradas']) r.push(await esperarServicio(n));
  return r.every(Boolean);
}

async function requerirStack() {
  for (const [n, u] of Object.entries(URL_)) {
    const r = await http('GET', `${u}/health`, undefined, { mostrar: false, timeout: 3000 });
    if (r.status !== 200) {
      out(rojo(`\n  ${n}-service no responde en ${u}. Primero ejecutá:  node scripts/tp6/pruebas.js inicio`));
      throw new Error('stack no levantado');
    }
  }
}

function contenedores() {
  const r = compose(['ps', '--all', '--format', 'json'], { mostrar: false });
  const t = r.stdout.trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [j];
  } catch {
    return t.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
}

// ------------------------------------------------------------------ datos de prueba
const SUF = Date.now().toString(36);
let contador = 0;
const unico = () => `${SUF}${(contador += 1)}`;
const dniAleatorio = () => String(10000000 + Math.floor(Math.random() * 89999999));
const datosUsuario = (extra = {}) => {
  const u = unico();
  return { nombre: 'Prueba', apellido: `Tp6${u}`, email: `tp6.${u}@example.com`, dni: dniAleatorio(), fechaNacimiento: '1995-04-12', direccion: 'Calle Falsa 123', password: 'Clave-Prueba-Tp6-1', ...extra };
};
const datosEvento = (aforoTotal = 5) => ({
  nombre: `Evento TP6 ${unico()}`, fecha: new Date(Date.now() + 30 * 864e5).toISOString(), lugar: 'Sala TP6', precio: 2500, aforoTotal,
});

async function crearUsuario(extra) {
  const r = await http('POST', `${URL_.usuarios}/usuarios`, datosUsuario(extra), { mostrar: false });
  if (r.status !== 201) throw new Error(`no se pudo crear el usuario de prueba (HTTP ${r.status}): ${r.text}`);
  return r.json;
}
async function crearEvento(aforo) {
  const r = await http('POST', `${URL_.eventos}/eventos`, datosEvento(aforo), { mostrar: false });
  if (r.status !== 201) throw new Error(`no se pudo crear el evento de prueba (HTTP ${r.status}): ${r.text}`);
  return r.json;
}
const comprar = (usuarioId, eventoId, cantidad, mostrar = true) =>
  http('POST', `${URL_.entradas}/ordenes`, { usuarioId, eventoId, cantidad }, { mostrar });

// ================================================================== PRUEBAS
const pruebas = {};

pruebas.build = async () => {
  for (const s of SERVICIOS) {
    seccion(`Build de ${s}`);
    const r = docker(['build', '-t', `${PREFIJO}/${s}:tp6`, `./services/${s}`], { maxLineas: 6 });
    check(`docker build de ${s} termina correctamente`, r.code === 0, `código de salida ${r.code}`);
  }
  seccion('Imágenes generadas');
  const r = docker(['image', 'ls', '--filter', `reference=${PREFIJO}/*-service`]);
  for (const s of SERVICIOS) check(`existe la imagen ${PREFIJO}/${s}:tp6`, r.stdout.includes(s));
};

pruebas.inicio = async () => {
  seccion('Validar el archivo Compose');
  check('docker compose config es válido', compose(['config', '--quiet']).code === 0);
  seccion('Construir e iniciar toda la solución');
  const up = compose(['up', '--build', '-d'], { maxLineas: 14 });
  check('docker compose up --build -d termina sin errores', up.code === 0, `código ${up.code}`);
  seccion('Esperar a que los servicios estén disponibles');
  check('los 3 servicios responden y tienen su base conectada', await esperarTodos());
  const esperados = ['usuarios-db', 'usuarios-service', 'eventos-db', 'redis', 'eventos-service', 'entradas-db', 'entradas-service'];
  // El healthcheck de Docker corre cada 10 s: un servicio que ya responde puede figurar "starting" unos segundos.
  const estaSano = (s) => { const c = contenedores().find((x) => x.Service === s); return !!c && c.State === 'running' && (!c.Health || c.Health === 'healthy'); };
  await esperar('los 7 contenedores en estado healthy', async () => esperados.every(estaSano), { timeoutMs: 90000, cadaMs: 3000 });
  seccion('Estado de los contenedores');
  compose(['ps']);
  const lista = contenedores();
  for (const s of esperados) {
    const c = lista.find((x) => x.Service === s);
    const ok = c && c.State === 'running' && (!c.Health || c.Health === 'healthy');
    check(`${s}: running${c && c.Health ? ' / healthy' : ''}`, ok, c ? `${c.State} ${c.Health || ''}` : 'no existe');
  }
};

pruebas.health = async () => {
  await requerirStack();
  seccion('GET /health de cada microservicio');
  for (const [n, u] of Object.entries(URL_)) {
    const r = await http('GET', `${u}/health`);
    check(`${n}-service responde 200 {service, status:"ok"}`, r.status === 200 && r.json?.status === 'ok' && r.json?.service === `${n}-service`);
  }
  seccion('eventos-service además informa el estado de Mongo y Redis (/ready)');
  const r = await http('GET', `${URL_.eventos}/ready`);
  check('/ready: mongodb up y redis up', r.status === 200 && r.json?.dependencies?.mongodb === 'up' && r.json?.dependencies?.redis === 'up');
  seccion('Healthchecks de Docker Compose');
  await esperar('todos los contenedores en estado healthy', async () => contenedores().every((c) => c.State === 'running' && (!c.Health || c.Health === 'healthy')), { timeoutMs: 60000, cadaMs: 3000 });
  compose(['ps']);
  for (const c of contenedores()) check(`${c.Service}: ${c.State}${c.Health ? ` (${c.Health})` : ''}`, c.State === 'running' && (!c.Health || c.Health === 'healthy'));
};

pruebas.datos = async () => {
  await requerirStack();
  seccion('Seed de usuarios-service (IDs fijos 64b000000000000000000001 … 05)');
  let r = compose(['exec', '-T', 'usuarios-service', 'npm', 'run', 'seed']);
  check('seed de usuarios aplicado', r.code === 0 && /Seed OK/.test(r.stdout));
  seccion('Seed de eventos-service (5 eventos con aforo conocido)');
  r = compose(['exec', '-T', 'eventos-service', 'npm', 'run', 'seed']);
  check('seed de eventos aplicado', r.code === 0 && /Seed aplicado/.test(r.stdout));
  seccion('Limpiar órdenes y tickets de entradas-service (no tiene seed propio)');
  r = compose(['exec', '-T', 'entradas-db', 'mongosh', '--quiet', 'entradas', '--eval', 'db.ordens.deleteMany({}); db.tickets.deleteMany({})']);
  check('colecciones ordens y tickets vaciadas', r.code === 0);
  seccion('Verificar el estado inicial por la API');
  const u = await http('GET', `${URL_.usuarios}/usuarios?activo=true`, undefined, { mostrar: false });
  check('usuarios-service tiene los usuarios del seed (4 activos + 1 inactivo)', Array.isArray(u.json) && u.json.some((x) => x.id === '64b000000000000000000001'));
  const e = await http('GET', `${URL_.eventos}/eventos`, undefined, { mostrar: false });
  const taller = Array.isArray(e.json) && e.json.find((x) => x.nombre === 'Taller de Node.js');
  check('eventos-service tiene "Taller de Node.js" con 5 lugares disponibles', taller && taller.disponibles === 5, taller ? `disponibles=${taller.disponibles}` : 'no encontrado');
  nota('Procedimiento reproducible: este mismo comando deja siempre el mismo estado inicial.');
};

pruebas.negocio = async () => {
  await requerirStack();
  const U = URL_.usuarios; const E = URL_.eventos; const N = URL_.entradas;
  let r;

  seccion('usuarios-service: CRUD');
  const u = datosUsuario();
  r = await http('POST', `${U}/usuarios`, u);
  check('POST /usuarios → 201, queda activo=true', r.status === 201 && r.json?.activo === true && r.json?.id);
  const uid = r.json?.id;
  r = await http('GET', `${U}/usuarios/${uid}`);
  check('GET /usuarios/:id → 200', r.status === 200 && r.json?.email === u.email);
  r = await http('PUT', `${U}/usuarios/${uid}`, { ...u, direccion: 'Calle Nueva 456' });
  check('PUT /usuarios/:id → 200 con el dato modificado', r.status === 200 && r.json?.direccion === 'Calle Nueva 456');
  r = await http('POST', `${U}/usuarios`, u);
  check('POST con email repetido → 409', r.status === 409 && r.json?.code === 'EMAIL_DUPLICADO');
  r = await http('POST', `${U}/usuarios`, { nombre: 'A' });
  check('POST con datos inválidos → 400 con lista de errores', r.status === 400 && Array.isArray(r.json?.errors));
  r = await http('GET', `${U}/usuarios`, undefined, { mostrar: false });
  check('GET /usuarios lista al usuario creado', r.status === 200 && r.json.some((x) => x.id === uid));
  r = await http('DELETE', `${U}/usuarios/${uid}`);
  check('DELETE /usuarios/:id → baja lógica (200, activo=false)', r.status === 200 && r.json?.activo === false);
  r = await http('GET', `${U}/usuarios/${uid}`, undefined, { mostrar: false });
  check('el usuario dado de baja sigue existiendo (GET → 200, activo=false)', r.status === 200 && r.json?.activo === false);

  seccion('eventos-service: CRUD');
  r = await http('POST', `${E}/eventos`, datosEvento(10));
  check('POST /eventos → 201 PUBLICADO', r.status === 201 && r.json?.estado === 'PUBLICADO');
  const eid = r.json?.id;
  r = await http('GET', `${E}/eventos/${eid}`);
  check('GET /eventos/:id → 200', r.status === 200 && r.json?.disponibles === 10);
  r = await http('PUT', `${E}/eventos/${eid}`, { lugar: 'Sala B2' });
  check('PUT /eventos/:id → 200 con el dato modificado', r.status === 200 && r.json?.lugar === 'Sala B2');
  r = await http('PATCH', `${E}/eventos/${eid}/cancelar`);
  check('PATCH /eventos/:id/cancelar → CANCELADO', r.status === 200 && r.json?.estado === 'CANCELADO');

  seccion('Compra de entradas: comunicación entradas → usuarios y entradas → eventos (HTTP)');
  const comprador = await crearUsuario();
  const otro = await crearUsuario();
  const ev = await crearEvento(5);
  nota(`comprador=${comprador.id}  evento=${ev.id} (aforo 5)`);

  r = await comprar(comprador.id, ev.id, 2);
  check('POST /ordenes (2 entradas) → 201 CONFIRMADA con 2 tickets', r.status === 201 && r.json?.orden?.estado === 'CONFIRMADA' && r.json?.tickets?.length === 2);
  const orden1 = r.json?.orden?.id; const ticket = r.json?.tickets?.[0]?.codigo;
  check('el precio se congeló desde eventos-service (precioUnitario = 2500)', r.json?.orden?.precioUnitario === 2500);
  r = await http('GET', `${E}/eventos/${ev.id}`);
  check('eventos-service descontó el aforo: disponibles = 3 (lo pidió entradas por HTTP)', r.json?.disponibles === 3, `disponibles=${r.json?.disponibles}`);
  r = await http('GET', `${N}/ordenes/${orden1}`, undefined, { mostrar: false });
  check('GET /ordenes/:id → 200 con la orden y sus tickets', r.status === 200 && r.json?.tickets?.length === 2);
  r = await http('GET', `${N}/entradas?usuarioId=${comprador.id}`, undefined, { mostrar: false });
  check('GET /entradas?usuarioId= lista las 2 entradas', r.status === 200 && r.json?.length === 2);

  r = await http('POST', `${N}/entradas/validar`, { codigo: ticket });
  check('POST /entradas/validar → 200 (ingreso permitido)', r.status === 200);
  r = await http('POST', `${N}/entradas/validar`, { codigo: ticket });
  check('validar el mismo ticket otra vez → 409 (uso único)', r.status === 409);

  r = await comprar(comprador.id, ev.id, 1);
  const orden2 = r.json?.orden?.id;
  check('segunda compra (1 entrada) → 201', r.status === 201 && Boolean(orden2));
  r = await http('DELETE', `${N}/ordenes/${orden2}`);
  check('DELETE /ordenes/:id → 200 CANCELADA', r.status === 200 && r.json?.orden?.estado === 'CANCELADA');
  r = await http('GET', `${E}/eventos/${ev.id}`, undefined, { mostrar: false });
  check('el aforo se devolvió: disponibles = 3 (liberar-aforo)', r.json?.disponibles === 3, `disponibles=${r.json?.disponibles}`);

  seccion('Reglas de cada servicio (quién decide qué)');
  r = await comprar(otro.id, ev.id, 4);
  check('pedir más lugares que el aforo → 409 SIN_AFORO (decide eventos)', r.status === 409 && r.json?.code === 'SIN_AFORO');
  r = await comprar(comprador.id, ev.id, 3);
  check('superar el máximo por usuario → 409 (decide entradas)', r.status === 409 && r.json?.code === 'MAXIMO_ENTRADAS_EXCEDIDO');
  r = await comprar('64b0000000000000000000ff', ev.id, 1);
  check('usuario inexistente → 404 USUARIO_NO_ENCONTRADO (decide usuarios)', r.status === 404 && r.json?.code === 'USUARIO_NO_ENCONTRADO');
  r = await comprar('64b000000000000000000004', ev.id, 1);
  check('usuario inactivo (Diego, del seed) → 409 USUARIO_INACTIVO (decide usuarios)', r.status === 409 && r.json?.code === 'USUARIO_INACTIVO', 'ejecutá antes la prueba "datos"');
  r = await comprar(otro.id, '64b0000000000000000000ee', 1);
  check('evento inexistente → 404 EVENTO_NO_ENCONTRADO (decide eventos)', r.status === 404 && r.json?.code === 'EVENTO_NO_ENCONTRADO');
};

pruebas['datos-propios'] = async () => {
  await requerirStack();
  seccion('Cada servicio tiene su propia base (según docker compose config)');
  const cfg = compose(['config', '--format', 'json'], { mostrar: false });
  let svc = {};
  try { svc = JSON.parse(cfg.stdout).services; } catch { /* se informa abajo */ }
  check('se pudo leer la configuración de Compose', Object.keys(svc).length > 0);
  for (const n of ['usuarios', 'eventos', 'entradas']) {
    const uri = svc[`${n}-service`]?.environment?.MONGODB_URI || '';
    nota(`${n}-service  MONGODB_URI=${uri}`);
    check(`${n}-service usa únicamente ${n}-db`, uri.includes(`//${n}-db:`));
  }
  const pub = Object.entries(svc).filter(([, s]) => (s.ports || []).length).map(([k]) => k).sort();
  check('solo los 3 microservicios publican puertos (bases y Redis no)', pub.join() === SERVICIOS.slice().sort().join(), `publican: ${pub.join(', ')}`);

  seccion('Colecciones de cada base (cada una contiene solo datos de su servicio)');
  const bases = { usuarios: 'usuarios', eventos: 'eventos', entradas: 'entradas' };
  const colecciones = {};
  for (const [n, base] of Object.entries(bases)) {
    const r = compose(['exec', '-T', `${n}-db`, 'mongosh', '--quiet', base, '--eval', 'JSON.stringify(db.getCollectionNames())']);
    try { colecciones[n] = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { colecciones[n] = []; }
    check(`${n}-db tiene colecciones propias: ${colecciones[n].join(', ') || '(ninguna)'}`, colecciones[n].length > 0);
  }
  const todas = Object.values(colecciones).flat();
  check('ninguna colección aparece en más de una base', new Set(todas).size === todas.length);

  seccion('Aislamiento de red: un servicio no puede ni resolver la base de otro');
  const dns = 'require("dns").lookup(process.argv[1],(e,a)=>{console.log(e?"ERROR "+e.code:"RESUELVE "+a);process.exit(0)})';
  for (const [desde, hacia] of [['entradas', 'usuarios-db'], ['entradas', 'eventos-db'], ['usuarios', 'entradas-db'], ['eventos', 'usuarios-db']]) {
    const r = compose(['exec', '-T', `${desde}-service`, 'node', '-e', dns, hacia]);
    check(`${desde}-service NO resuelve ${hacia}`, /ERROR/.test(r.stdout), r.stdout.trim());
  }
  const r = compose(['exec', '-T', 'entradas-service', 'node', '-e', dns, 'usuarios-service']);
  check('(control) entradas-service SÍ resuelve usuarios-service (comunicación HTTP permitida)', /RESUELVE/.test(r.stdout), r.stdout.trim());
};

pruebas.swagger = async () => {
  await requerirStack();
  seccion('Swagger UI de cada microservicio');
  for (const [n, u] of Object.entries(URL_)) {
    const r = await http('GET', `${u}/api-docs/`, undefined, { mostrar: false });
    out(gris(`  $ abrir en el navegador: ${u}/api-docs`));
    check(`${n}-service: ${u}/api-docs → 200 (Swagger UI)`, r.status === 200 && /swagger/i.test(r.text));
  }
  nota('Tomá una captura de cada una abierta en el navegador y ejecutá un GET desde "Try it out".');
};

pruebas['fallo-dependencia'] = async () => {
  await requerirStack();
  const comprador = await crearUsuario();
  const ev = await crearEvento(20);
  seccion('1) Validar el caso de uso con todo levantado');
  let r = await comprar(comprador.id, ev.id, 1);
  check('compra OK → 201', r.status === 201);

  seccion('2) Detener únicamente el servicio destino (usuarios-service)');
  check('docker compose stop usuarios-service', compose(['stop', 'usuarios-service']).code === 0);

  seccion('3) Repetir la operación desde el servicio origen (entradas-service)');
  r = await comprar(comprador.id, ev.id, 1);
  check('responde 503 controlado (no 500, no se cuelga)', r.status === 503 && r.json?.code === 'DEPENDENCIA_NO_DISPONIBLE', `status ${r.status}`);

  seccion('4) El servicio origen sigue vivo');
  r = await http('GET', `${URL_.entradas}/health`);
  check('entradas-service /health → 200', r.status === 200);
  r = await http('GET', `${URL_.eventos}/health`, undefined, { mostrar: false });
  check('eventos-service no se vio afectado', r.status === 200);
  compose(['ps']);
  seccion('   El fallo es observable en los logs de entradas-service');
  const logs = compose(['logs', '--no-color', '--no-log-prefix', '--tail', '40', 'entradas-service'], { mostrar: false }).stdout;
  const lineas = logs.split(/\r?\n/).filter((l) => /dependencia no disponible/.test(l)).slice(-2);
  lineas.forEach((l) => out(gris(`    ${recortar(l, 220)}`)));
  check('hay un log "dependencia no disponible" con el servicio remoto', lineas.length > 0);

  seccion('5) Reiniciar el servicio destino y comprobar la recuperación');
  check('docker compose start usuarios-service', compose(['start', 'usuarios-service']).code === 0);
  check('usuarios-service vuelve a estar disponible', await esperarServicio('usuarios'));
  r = await comprar(comprador.id, ev.id, 1);
  check('la compra vuelve a funcionar → 201 (sin reiniciar entradas-service)', r.status === 201);
};

pruebas['fallo-redis'] = async () => {
  await requerirStack();
  const comprador = await crearUsuario();
  const ev = await crearEvento(20);
  seccion('1) Con Redis funcionando');
  let r = await http('GET', `${URL_.eventos}/ready`);
  check('/ready → mongodb up, redis up', r.status === 200 && r.json?.dependencies?.redis === 'up');
  r = await comprar(comprador.id, ev.id, 1);
  check('compra OK → 201', r.status === 201);

  seccion('2) Detener Redis (el coordinador del lock de aforo)');
  check('docker compose stop redis', compose(['stop', 'redis']).code === 0);
  await esperar('eventos-service detecta que Redis no está (/ready → 503)', async () => (await http('GET', `${URL_.eventos}/ready`, undefined, { mostrar: false, timeout: 3000 })).status === 503, { timeoutMs: 30000, cadaMs: 1000 });

  seccion('3) Comportamiento de eventos-service sin Redis');
  r = await http('GET', `${URL_.eventos}/health`);
  check('/health → 200 (el proceso sigue vivo, no se cayó)', r.status === 200);
  r = await http('GET', `${URL_.eventos}/ready`);
  check('/ready → 503 degraded, redis down', r.status === 503 && r.json?.dependencies?.redis === 'down');
  r = await http('GET', `${URL_.eventos}/eventos`, undefined, { mostrar: false });
  check('las lecturas (GET /eventos) siguen funcionando: no necesitan el lock', r.status === 200);
  r = await http('POST', `${URL_.eventos}/eventos/${ev.id}/reservar-aforo`, { cantidad: 1, referencia: `redis-down-${unico()}` });
  check('reservar-aforo (necesita el lock) → 503 REDIS_NO_DISPONIBLE, no un 500', r.status === 503 && r.json?.code === 'REDIS_NO_DISPONIBLE');
  r = await comprar(comprador.id, ev.id, 1);
  check('la compra desde entradas → 503 controlado', r.status === 503, `status ${r.status}`);
  const logs = compose(['logs', '--no-color', '--no-log-prefix', '--tail', '40', 'eventos-service'], { mostrar: false }).stdout;
  const l = logs.split(/\r?\n/).filter((x) => /Redis no disponible/.test(x)).slice(-1);
  l.forEach((x) => out(gris(`    ${recortar(x, 220)}`)));
  check('queda registrado en los logs de eventos-service', l.length > 0);

  seccion('4) Reiniciar Redis: recuperación automática');
  check('docker compose start redis', compose(['start', 'redis']).code === 0);
  check('eventos-service vuelve a "ready" solo (sin reiniciarlo)', await esperar('/ready → 200', async () => (await http('GET', `${URL_.eventos}/ready`, undefined, { mostrar: false })).status === 200, { timeoutMs: 60000, cadaMs: 2000 }));
  r = await comprar(comprador.id, ev.id, 1);
  check('la compra vuelve a funcionar → 201', r.status === 201);
};

pruebas['fallo-db'] = async () => {
  await requerirStack();
  seccion('1) Con la base funcionando');
  let r = await http('GET', `${URL_.usuarios}/usuarios`, undefined, { mostrar: false });
  check('GET /usuarios → 200', r.status === 200);
  seccion('2) Detener usuarios-db (la base propia de usuarios-service)');
  check('docker compose stop usuarios-db', compose(['stop', 'usuarios-db']).code === 0);
  // El driver tarda unos segundos en notar que la base se fue (la primera consulta espera hasta
  // MONGODB_TIMEOUT_MS): se espera a que la caída sea detectada en lugar de dormir un tiempo fijo.
  await esperar('usuarios-service detecta que su base no está', async () => (await http('GET', `${URL_.usuarios}/usuarios`, undefined, { mostrar: false, timeout: 15000 })).status !== 200, { timeoutMs: 40000, cadaMs: 1000 });
  seccion('3) usuarios-service sigue vivo y responde de forma controlada');
  r = await http('GET', `${URL_.usuarios}/health`);
  check('/health → 200', r.status === 200);
  r = await http('GET', `${URL_.usuarios}/usuarios`, undefined, { timeout: 15000 });
  check('GET /usuarios → 503 DB_NO_DISPONIBLE (no 500, no se cuelga)', r.status === 503 && r.json?.code === 'DB_NO_DISPONIBLE', `status ${r.status}`);
  r = await http('GET', `${URL_.usuarios}/api-docs/`, undefined, { mostrar: false });
  check('/api-docs sigue disponible', r.status === 200);
  seccion('4) Reiniciar la base: recuperación automática');
  check('docker compose start usuarios-db', compose(['start', 'usuarios-db']).code === 0);
  check('usuarios-service se reconecta solo', await esperarServicio('usuarios'));
};

pruebas['fallo-parcial'] = async () => {
  await requerirStack();
  nota('Caso de uso: comprar entradas = entradas (crea orden) → eventos (reserva aforo) → entradas (emite tickets).');
  nota('Se simula una falla en la etapa intermedia (reservar aforo) deteniendo Redis.');
  const comprador = await crearUsuario();
  const ev = await crearEvento(10);
  let r = await http('GET', `${URL_.eventos}/eventos/${ev.id}`, undefined, { mostrar: false });
  const antes = r.json?.disponibles;
  nota(`aforo antes: ${antes}`);

  seccion('1) Provocar la falla en la etapa 2');
  check('docker compose stop redis', compose(['stop', 'redis']).code === 0);
  await esperar('eventos-service detecta que Redis no está (/ready → 503)', async () => (await http('GET', `${URL_.eventos}/ready`, undefined, { mostrar: false, timeout: 3000 })).status === 503, { timeoutMs: 30000, cadaMs: 1000 });
  r = await comprar(comprador.id, ev.id, 2);
  check('la compra responde 503 ORDEN_PENDIENTE', r.status === 503 && r.json?.code === 'ORDEN_PENDIENTE', `status ${r.status}`);
  const ordenId = r.json?.details?.ordenId;

  seccion('2) Estado en que quedó el sistema');
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenId}`);
  check('la orden existe y quedó PENDIENTE (etapa 1 confirmada, etapa 3 nunca ocurrió)', r.status === 200 && r.json?.orden?.estado === 'PENDIENTE');
  check('no se emitió ningún ticket', r.json?.tickets?.length === 0);
  r = await http('GET', `${URL_.eventos}/eventos/${ev.id}`);
  check(`el aforo no cambió (disponibles = ${antes})`, r.json?.disponibles === antes, `disponibles=${r.json?.disponibles}`);

  seccion('3) Recuperar la dependencia y ver qué pasa con la orden');
  check('docker compose start redis', compose(['start', 'redis']).code === 0);
  await esperar('eventos-service ready', async () => (await http('GET', `${URL_.eventos}/ready`, undefined, { mostrar: false })).status === 200, { timeoutMs: 60000 });
  r = await http('GET', `${URL_.entradas}/ordenes/${ordenId}`);
  check('la orden SIGUE PENDIENTE: no hay recuperación automática (queda como mejora futura)', r.json?.orden?.estado === 'PENDIENTE');
  r = await comprar(comprador.id, ev.id, 2);
  check('una compra nueva funciona (el sistema no quedó bloqueado)', r.status === 201);

  seccion('Análisis (para el informe, punto 15.3)');
  [
    'Estado parcial: orden PENDIENTE sin tickets y sin aforo descontado; no hay datos corruptos pero sí una orden "colgada".',
    'La orden PENDIENTE cuenta para el máximo por usuario y evento, así que puede restar capacidad de compra al usuario.',
    'Para recuperar/compensar haría falta: un proceso que reintente reservar-aforo con la misma referencia (ordenId),',
    'que es idempotente, o liberar-aforo; y un campo con la fecha/intentos de la orden para detectar las vencidas.',
  ].forEach((t) => nota(t));
};

pruebas.logs = async () => {
  await requerirStack();
  seccion('docker compose logs de cada microservicio (JSON por stdout, con el nombre del servicio)');
  for (const s of SERVICIOS) {
    const r = compose(['logs', '--no-color', '--no-log-prefix', '--tail', '6', s], { maxLineas: 6 });
    const parseadas = r.stdout.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    check(`${s}: logs con service, level y message`, parseadas.some((x) => x.service === s && x.level && x.message));
  }
  seccion('Eventos relevantes disponibles en los logs');
  const e = compose(['logs', '--no-color', '--no-log-prefix', 'entradas-service'], { mostrar: false }).stdout;
  check('entradas-service registró órdenes ("orden creada"/"orden confirmada")', /orden (creada|confirmada)/.test(e), 'ejecutá antes la prueba "negocio"');
  nota('Comandos útiles:  docker compose logs <servicio>   |   docker compose logs -f <servicio>');
};

pruebas.persistencia = async () => {
  await requerirStack();
  seccion('1) Crear datos persistentes');
  const u = await http('POST', `${URL_.usuarios}/usuarios`, datosUsuario());
  const ev = await http('POST', `${URL_.eventos}/eventos`, datosEvento(7));
  check('usuario y evento creados', u.status === 201 && ev.status === 201);
  const uid = u.json?.id; const eid = ev.json?.id;

  seccion('2) Detener y ELIMINAR los contenedores conservando los volúmenes');
  check('docker compose down', compose(['down']).code === 0);
  const vol = docker(['volume', 'ls', '--filter', 'name=tp6-eventos-entradas']);
  for (const v of VOLUMENES) check(`el volumen ${v} sigue existiendo`, vol.stdout.includes(v));

  seccion('3) Volver a crear los contenedores');
  check('docker compose up -d', compose(['up', '-d'], { maxLineas: 10 }).code === 0);
  check('los servicios están disponibles', await esperarTodos());

  seccion('4) Consultar los mismos datos');
  let r = await http('GET', `${URL_.usuarios}/usuarios/${uid}`);
  check('el usuario creado antes sigue disponible', r.status === 200 && r.json?.id === uid);
  r = await http('GET', `${URL_.eventos}/eventos/${eid}`);
  check('el evento creado antes sigue disponible', r.status === 200 && r.json?.id === eid);

  if (FLAGS.has('--con-down-v')) {
    seccion('5) Diferencia: docker compose down -v ELIMINA los volúmenes');
    check('docker compose down -v', compose(['down', '-v']).code === 0);
    const v2 = docker(['volume', 'ls', '--filter', 'name=tp6-eventos-entradas']);
    check('ya no existen los volúmenes', !VOLUMENES.some((v) => v2.stdout.includes(v)));
    check('docker compose up -d', compose(['up', '-d'], { maxLineas: 6 }).code === 0);
    check('los servicios están disponibles', await esperarTodos());
    r = await http('GET', `${URL_.usuarios}/usuarios/${uid}`);
    check('el usuario ya NO existe (404): los datos se borraron', r.status === 404);
    nota('Los datos quedaron vacíos: ejecutá  node scripts/tp6/pruebas.js datos  para volver al estado inicial.');
  } else {
    nota('Para demostrar también la diferencia con `down -v` ejecutá esta prueba con --con-down-v.');
  }
};

// ================================================================== ejecucion
function cabecera(nombre) {
  out(negrita(`\n════════════════════════════════════════════════════════════════`));
  out(negrita(` TP6 · prueba: ${nombre}`));
  out(negrita(`════════════════════════════════════════════════════════════════`));
  out(gris(` fecha: ${new Date().toISOString()}   equipo: ${os.platform()} ${os.release()}   node ${process.version}`));
  const d = docker(['--version'], { mostrar: false });
  const c = docker(['compose', 'version'], { mostrar: false });
  out(gris(` ${d.stdout.trim() || 'docker: no disponible'}  ·  ${c.stdout.trim() || 'docker compose: no disponible'}`));
}

async function ejecutar(nombre) {
  buffer = []; okActual = 0; fallosActual = 0;
  cabecera(nombre);
  try {
    await pruebas[nombre]();
  } catch (e) {
    fallosActual += 1;
    out(rojo(`\n  ✘ La prueba se interrumpió: ${e.message}`));
  }
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

const ORDEN_TODO = ['build', 'inicio', 'health', 'datos', 'negocio', 'datos-propios', 'swagger', 'fallo-dependencia', 'fallo-redis', 'fallo-db', 'fallo-parcial', 'logs', 'persistencia'];

(async () => {
  if (!PRUEBA || (PRUEBA !== 'todo' && !pruebas[PRUEBA])) {
    console.log(`Uso: node scripts/tp6/pruebas.js <prueba> [--con-down-v] [--no-guardar]\n\nPruebas: ${Object.keys(pruebas).join(', ')}, todo`);
    process.exit(PRUEBA ? 2 : 0);
  }
  const lista = PRUEBA === 'todo' ? ORDEN_TODO : [PRUEBA];
  const resultados = [];
  for (const n of lista) resultados.push(await ejecutar(n));

  if (lista.length > 1) {
    out(negrita('\n════════════════════════ RESUMEN ════════════════════════'));
    for (const r of resultados) out(`  ${r.ok ? verde('OK   ') : rojo('FALLO')}  ${r.nombre.padEnd(20)} ${r.verificaciones} verificaciones${r.fallos ? `, ${r.fallos} fallidas` : ''}`);
    if (GUARDAR) {
      fs.mkdirSync(EVID_DIR, { recursive: true });
      const resumen = resultados.map((r) => `${r.ok ? 'OK   ' : 'FALLO'}  ${r.nombre.padEnd(20)} ${r.verificaciones} verificaciones${r.fallos ? `, ${r.fallos} fallidas` : ''}`);
      fs.writeFileSync(path.join(EVID_DIR, 'resumen.txt'), `TP6 - resumen de pruebas (${new Date().toISOString()})\n\n${resumen.join('\n')}\n`, 'utf8');
    }
  }
  process.exit(resultados.every((r) => r.ok) ? 0 : 1);
})();
