#!/usr/bin/env node
/*
 * TP6 - Prueba de concurrencia: sin sobreventa del aforo (lock en Redis + descuento atomico).
 *
 *   node scripts/tp6/concurrencia.js
 *
 * Crea un evento con aforo 3 y 10 usuarios, y dispara 10 compras de 1 entrada AL MISMO TIEMPO.
 * Esperado: exactamente 3 respuestas 201 y el resto 409 SIN_AFORO (o 423 EVENTO_OCUPADO si el
 * lock estaba tomado), disponibles final = 0 y nunca negativo. Requiere la solucion levantada.
 * Si cambiaste los puertos publicados, definilos con USUARIOS_HOST_PORT, EVENTOS_HOST_PORT y ENTRADAS_HOST_PORT.
 * TP7: opera como el ADMIN del seed (admin@example.com); lee SEED_ADMIN_PASSWORD del .env de la raiz.
 */
const fs=require('node:fs'), path=require('node:path');
const dotenv={}; try{ for(const l of fs.readFileSync(path.join(__dirname,'..','..','.env'),'utf8').split(/\r?\n/)){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if(m&&!l.trim().startsWith('#')) dotenv[m[1]]=m[2].replace(/^["']|["']$/g,''); } }catch{}
const P={...dotenv,...process.env}; const U=`http://localhost:${P.USUARIOS_HOST_PORT||3001}`, E=`http://localhost:${P.EVENTOS_HOST_PORT||3002}`, N=`http://localhost:${P.ENTRADAS_HOST_PORT||3003}`;
let TOKEN=null;
const j=(m,u,b)=>fetch(u,{method:m,headers:{'content-type':'application/json',...(TOKEN?{authorization:`Bearer ${TOKEN}`}:{})},body:b?JSON.stringify(b):undefined}).then(async r=>({s:r.status,j:await r.json().catch(()=>null)}));
(async()=>{
  const pass=P.ADMIN_PASSWORD||P.SEED_ADMIN_PASSWORD;
  if(!pass){ console.error('Falta SEED_ADMIN_PASSWORD en el .env de la raiz (contraseña del administrador del seed).'); process.exit(2); }
  const login=await j('POST',`${U}/auth/login`,{email:P.ADMIN_EMAIL||'admin@example.com',password:pass});
  if(login.s!==200){ console.error(`No se pudo iniciar sesion como administrador (HTTP ${login.s}). Corriste el seed de usuarios?`); process.exit(2); }
  TOKEN=login.j.token;
  const AFORO=3, COMPRADORES=10, sufijo=Date.now().toString(36);
  const ev=(await j('POST',`${E}/eventos`,{nombre:'Concurrencia '+sufijo,fecha:new Date(Date.now()+30*864e5).toISOString(),lugar:'Sala',precio:100,aforoTotal:AFORO})).j;
  const us=[]; for(let i=0;i<COMPRADORES;i++){ us.push((await j('POST',`${U}/usuarios`,{nombre:'Con',apellido:'Cu'+i,email:`cc${sufijo}${i}@example.com`,dni:String(20000000+Math.floor(Math.random()*9e6)),fechaNacimiento:'1990-01-01',password:'Clave-Prueba-Tp6-1'})).j.id); }
  const t0=Date.now();
  const r=await Promise.all(us.map(id=>j('POST',`${N}/ordenes`,{usuarioId:id,eventoId:ev.id,cantidad:1})));
  const cuenta={}; r.forEach(x=>{const k=x.s+(x.j&&x.j.code?' '+x.j.code:''); cuenta[k]=(cuenta[k]||0)+1;});
  const fin=(await j('GET',`${E}/eventos/${ev.id}`)).j;
  console.log(`aforo=${AFORO}, ${COMPRADORES} compras simultáneas de 1 entrada (${Date.now()-t0} ms)`); console.log(cuenta);
  console.log(`disponibles final=${fin.disponibles}  estado=${fin.estado}`);
  const conf=r.filter(x=>x.s===201).length;
  console.log(conf<=AFORO && fin.disponibles>=0 && fin.disponibles===AFORO-conf ? 'OK: sin sobreventa y aforo consistente' : 'FALLO: inconsistencia');
})();
