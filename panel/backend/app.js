import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, SERVER, CONFIG, configWarning, loadConfig, atomicWrite, validateConfig, nextBackup, readProperties, writeProperties, schema, safePath, worldStorage, audit } from './core.js';
import { Manager, JAVA, validateCommand } from './manager.js';
import { Backups, checkedBackup } from './backups.js';
import {playitStatus} from './playit.js';
import {Hardcore,RUNS} from './hardcore.js';
const config=loadConfig();
const persist=()=>atomicWrite(CONFIG,JSON.stringify(config,null,2));
const manager=new Manager(config,persist),backups=new Backups(manager,config,persist);
const hardcore=new Hardcore(manager,backups,config,persist);
const app=express(), token=crypto.randomBytes(32).toString('hex');
const origins=new Set(['http://127.0.0.1:3000','http://localhost:3000']);
app.disable('x-powered-by');
app.use((req,res,next)=>{
  if(!['127.0.0.1:3000','localhost:3000'].includes(req.headers.host))return res.status(403).json({error:'Host no permitido.'});
  if(req.headers.origin&&!origins.has(req.headers.origin))return res.status(403).json({error:'Origen no permitido.'});
  if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Petición externa bloqueada.'});
  res.set({'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
  if(req.method!=='GET'&&req.headers['x-panel-token']!==token)return res.status(403).json({error:'Recarga el panel para obtener una sesión válida.'});
  if(req.method!=='GET'&&closing)return res.status(503).json({error:'El panel se está cerrando; espera antes de iniciar otra operación.'});
  if(req.method!=='GET'&&manager.hardcoreLocked&&req.path!=='/api/hardcore/recover')return res.status(409).json({error:'Reset Hardcore pendiente. Revisa Hardcore antes de ejecutar otras operaciones.'});
  next();
});
app.use(express.json({limit:'16kb'}));
const javaVersion=spawnSync(JAVA,['-version'],{encoding:'utf8',windowsHide:true}).stderr?.split(/\r?\n/)[0]||'No disponible';
let versions={};try{versions=JSON.parse(fs.readFileSync(path.join(ROOT,'config/versions.json'),'utf8').replace(/^\uFEFF/,''));}catch{}
let storage={worlds:[],worldBytes:0,backupBytes:0,at:null};
function storageInfo(){try{const name=readProperties()['level-name'];storage={...worldStorage(name),backupBytes:backups.list().reduce((n,b)=>n+b.bytes,0),at:new Date().toISOString()};}catch(e){audit('error lectura de almacenamiento',e.message);}}
function readList(file){const target=safePath(SERVER,file);if(!fs.existsSync(target))return [];const result=JSON.parse(fs.readFileSync(target,'utf8'));if(!Array.isArray(result))throw Error('Lista de jugadores corrupta.');return result;}
app.get('/api/session',(_req,res)=>res.json({token}));
app.get('/api/playit',async(_req,res)=>res.json(await playitStatus()));
app.get('/api/hardcore',(_req,res)=>res.json(hardcore.status()));
app.post('/api/hardcore/reset',(req,res)=>res.json({message:hardcore.manual(req.body.confirm)}));
app.post('/api/hardcore/recover',async(req,res)=>res.json({message:await hardcore.recover(req.body.confirm)}));
app.get('/api/hardcore/archive/:name',(req,res)=>{
  if(!hardcore.data.history.some(run=>run.archive===req.params.name)||!/^[a-zA-Z0-9._-]+\.zip$/.test(req.params.name))throw Error('Archivo de run no permitido.');
  res.download(safePath(RUNS,req.params.name));
});
app.post('/api/hardcore/config',(req,res)=>{
  if(manager.busy)throw Error('Espera a que finalice la operación actual.');
  const keys=['hardcoreResetEnabled','hardcoreSeedMode','hardcoreArchive','hardcoreCountdown'];
  for(const key of Object.keys(req.body))if(!keys.includes(key))throw Error('Preferencia Hardcore no editable.');
  Object.assign(config,validateConfig({...config,...req.body}));persist();hardcore.control();audit('ajustes Hardcore modificados');res.json({message:'Configuración Hardcore guardada.'});
});
app.get('/api/status',(_req,res)=>res.json({...manager.status(),busy:manager.hardcoreLocked?'reset Hardcore':manager.busy,config,properties:{...readProperties(),pvp:String(config.pvp),'enable-command-block':String(config.commandBlocks)},versions,javaVersion,nodeVersion:process.version,storage,warning:[configWarning,manager.warning].filter(Boolean).join(' ')||null,eulaAccepted:fs.existsSync(path.join(SERVER,'eula.txt'))&&/^eula=true\s*$/m.test(fs.readFileSync(path.join(SERVER,'eula.txt'),'utf8'))}));
app.get('/api/schema',(_req,res)=>res.json(schema));
app.get('/api/logs',(req,res)=>{const after=Number(req.query.after)||0;res.json(manager.logs.filter(x=>x.id>after));});
app.get('/api/audit',(_req,res)=>{const file=safePath(ROOT,'panel/logs/admin.jsonl');res.json(fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').slice(-100).map(x=>JSON.parse(x)):[]);});
app.post('/api/server/:action',async(req,res)=>{
  const action=req.params.action;
  if(!['start','stop','restart','force','shutdown'].includes(action))throw Error('Acción desconocida.');
  if(['stop','restart'].includes(action)&&req.body.confirm!==true)throw Error('Confirma la interrupción del juego.');
  if(action==='shutdown'){if(manager.child||manager.unmanaged()||manager.busy)throw Error('Detén Paper antes de cerrar el servicio del panel.');res.json({message:'Servicio del panel cerrado.'});setTimeout(()=>shutdown(),200);return;}
  const message=action==='force'?manager.force(req.body.confirm):await manager[action]();res.json({message});
});
app.post('/api/properties',(req,res)=>{if(manager.busy)throw Error('Espera a que termine la operación actual.');const changed=writeProperties(req.body,manager.state!=='offline'||manager.unmanaged());if('pvp' in req.body&&config.pvp!==req.body.pvp){config.pvp=req.body.pvp;changed.push('pvp');}if('enable-command-block' in req.body&&config.commandBlocks!==req.body['enable-command-block']){config.commandBlocks=req.body['enable-command-block'];changed.push('commandBlocks');}if(changed.length)config.restartRequired=true;persist();storageInfo();res.json({message:'Configuración guardada. Se aplicará al siguiente inicio o reinicio.',restartRequired:config.restartRequired});});
app.post('/api/config',(req,res)=>{
  if(manager.busy)throw Error('Espera a que termine el backup.');
  const allowed=['ramMin','ramMax','backupsEnabled','intervalMinutes','maxAutomatic','maxAgeDays'];for(const k of Object.keys(req.body))if(!allowed.includes(k))throw Error('Preferencia no editable.');
  const updated=validateConfig({...config,...req.body});const ramChanged=updated.ramMin!==config.ramMin||updated.ramMax!==config.ramMax;
  const scheduleChanged=updated.backupsEnabled!==config.backupsEnabled||updated.intervalMinutes!==config.intervalMinutes;
  Object.assign(config,updated);if(ramChanged)config.restartRequired=true;if(scheduleChanged)config.nextBackup=nextBackup(config);persist();audit('preferencias del panel modificadas',Object.keys(req.body).join(', '));res.json({message:ramChanged?'RAM guardada. Se aplicará al siguiente inicio.':'Preferencias guardadas.',config});
});
app.post('/api/command',(req,res)=>{if(manager.busy)throw Error('Consola bloqueada durante backup/restauración.');const command=validateCommand(req.body.command);manager.raw(command);audit('comando Minecraft',command);res.json({message:'Comando enviado. Revisa la respuesta en Consola.'});});
app.get('/api/players',(_req,res)=>{
  const whitelist=readList('whitelist.json'),ops=readList('ops.json'),bans=readList('banned-players.json'),cache=readList('usercache.json');
  const names=[...new Set([...manager.players,...whitelist.map(x=>x.name),...ops.map(x=>x.name),...bans.map(x=>x.name)])];
  res.json(names.map(name=>({name,uuid:[...cache,...whitelist,...ops,...bans].find(x=>x.name.toLowerCase()===name.toLowerCase())?.uuid||null,online:manager.players.includes(name),op:ops.some(x=>x.name===name),whitelist:whitelist.some(x=>x.name===name),banned:bans.some(x=>x.name===name)})));
});
app.post('/api/players',(req,res)=>{
  const {name,action,confirm}=req.body;const commands={whitelistAdd:'whitelist add',whitelistRemove:'whitelist remove',op:'op',deop:'deop',kick:'kick',ban:'ban',unban:'pardon'};
  if(typeof name!=='string'||!/^[A-Za-z0-9_]{1,16}$/.test(name)||!Object.hasOwn(commands,action))throw Error('Jugador o acción inválidos.');
  if(manager.busy)throw Error('Operación en curso.');if(action!=='whitelistAdd'&&confirm!==true)throw Error('Se requiere confirmación.');
  manager.raw(commands[action]+' '+name);audit('acción jugador',action+' '+name);res.json({message:'Acción enviada a Paper. Comprueba la consola si el nombre aún no está validado.'});
});
const gamerules=['minecraft:keep_inventory','minecraft:advance_time','minecraft:advance_weather','minecraft:mob_griefing','minecraft:spawn_mobs','minecraft:show_advancement_messages'];
app.get('/api/gamerules',(_req,res)=>res.json(gamerules));
app.post('/api/world',(req,res)=>{if(manager.busy)throw Error('Espera a que termine el backup.');if(req.body.action==='save'){manager.raw('save-all flush');res.json({message:'Guardado solicitado; revisa la consola.'});return;}if(req.body.action==='seed'){manager.raw('seed');res.json({message:'Seed solicitada. Consulta Consola.'});return;}if(!gamerules.includes(req.body.rule)||typeof req.body.value!=='boolean')throw Error('Gamerule inválida.');manager.raw(`gamerule ${req.body.rule} ${req.body.value}`);audit('gamerule',req.body.rule+'='+req.body.value);res.json({message:'Gamerule enviada. Se aplica al mundo principal de la consola; verifica la respuesta.'});});
app.get('/api/backups',(_req,res)=>res.json(backups.list()));
app.post('/api/backups',async(_req,res)=>{const result=await backups.create();storageInfo();res.json(result);});
app.get('/api/backups/:name/download',(req,res)=>res.download(checkedBackup(req.params.name)));
app.post('/api/backups/:name/delete',(req,res)=>{if(req.body.confirm!=='ELIMINAR')throw Error('Escribe ELIMINAR para confirmar.');backups.remove(req.params.name);storageInfo();res.json({message:'Backup eliminado.'});});
app.post('/api/backups/:name/restore',async(req,res)=>{const result=await backups.restore(req.params.name,req.body.confirm);storageInfo();res.json(result);});
app.get('/api/plugins',(_req,res)=>res.json(fs.readdirSync(safePath(SERVER,'plugins')).filter(x=>x.endsWith('.jar')).map(name=>{const s=fs.statSync(safePath(SERVER,'plugins',name));return{name,bytes:s.size,modified:s.mtime.toISOString(),state:'Archivo encontrado; carga no verificada'};})));
app.use(express.static(path.join(ROOT,'panel/frontend'),{dotfiles:'deny',etag:false}));
app.use((error,req,res,_next)=>{audit('error',req.path+' / '+error.message);if(!res.headersSent)res.status(400).json({error:error.message.length<350?error.message:'Operación fallida. Consulta el registro administrativo.'});});
let intervals=[],closing=false;
const server=app.listen(3000,'127.0.0.1',(error)=>{
  if(error)return;
  storageInfo();console.log('Panel local: http://127.0.0.1:3000');audit('panel iniciado');
  if(config.backupsEnabled&&!config.nextBackup){config.nextBackup=nextBackup(config);persist();}
  intervals=[setInterval(()=>manager.sample().catch(e=>audit('error métricas',e.message)),10000),setInterval(()=>backups.tick().catch(e=>audit('error backups',e.message)),15000),setInterval(storageInfo,60000),setInterval(()=>hardcore.tick().catch(e=>audit('error Hardcore',e.message)),250)];
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'El panel ya está abierto o el puerto 3000 está ocupado.':e.message);process.exitCode=1;});
async function shutdown(){if(closing)return;closing=true;intervals.forEach(clearInterval);try{
  if(hardcore.pendingTask)await hardcore.pendingTask;
  while(manager.busy||manager.state==='starting')await new Promise(r=>setTimeout(r,500));
  if(manager.state==='online')await manager.stop(true);
  if(manager.child){console.error('Paper sigue activo: el panel permanece abierto para evitar pérdida de datos.');closing=false;return;}
  audit('panel cerrado');server.close(()=>process.exit(0));
}catch(e){audit('cierre pendiente',e.message);console.error(e.message);closing=false;}}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
