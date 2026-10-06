import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const base=fs.mkdtempSync(path.resolve('tests/.tmp-hardcore-'));
fs.mkdirSync(path.join(base,'panel/backend'),{recursive:true});
for(const file of ['core.js','backups.js','hardcore.js'])fs.copyFileSync(path.resolve('backend',file),path.join(base,'panel/backend',file));
fs.writeFileSync(path.join(base,'panel/package.json'),'{"type":"module"}');
const core=await import(pathToFileURL(path.join(base,'panel/backend/core.js')));
const {Hardcore,activeWorldRoots,requireOffline,nextSeed,RUNS}=await import(pathToFileURL(path.join(base,'panel/backend/hardcore.js')));
const {Backups,digest}=await import(pathToFileURL(path.join(base,'panel/backend/backups.js')));
after(()=>{core.safePath(path.resolve('tests'),path.basename(base));fs.rmSync(base,{recursive:true});});
function fresh({archive=true,seedMode='random',failure=null,protectedRun=false}={}){
  for(const folder of ['server','config','runs']){const target=core.safePath(base,folder);fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});}
  fs.mkdirSync(path.join(base,'server/backups'));fs.mkdirSync(path.join(base,'server/plugins'));
  fs.writeFileSync(path.join(base,'server/server.properties'),core.serializeProperties({'level-name':'acere','level-seed':'old','online-mode':'true','white-list':'true','enable-rcon':'false','server-port':'25565',hardcore:'true',difficulty:'hard',gamemode:'survival'}));
  fs.writeFileSync(path.join(base,'server/whitelist.json'),'[{"name":"realPlayer","uuid":"unchanged"}]');
  fs.writeFileSync(path.join(base,'server/banned-players.json'),'[{"name":"banned"}]');
  createWorld('old');
  const config=core.validateConfig({...core.defaults,hardcoreArchive:archive,hardcoreSeedMode:seedMode});
  const persist=()=>core.atomicWrite(core.CONFIG,JSON.stringify(config));persist();
  const order=[];
  const manager={state:'online',child:{pid:123},players:[],busy:null,unmanaged:()=>false,raw(command){order.push(command);},confirmed:async(command)=>{order.push(command);},log(){},async stop(internal){assert.equal(internal,true);order.push('stop');this.child=null;this.state='offline';},async start(internal){assert.equal(internal,true);assert.equal(this.state,'offline');assert.equal(fs.existsSync(path.join(base,'server/acere/players/player.dat')),false);order.push('start');createWorld('new');this.state='online';this.child={pid:456};}};
  const backups=new Backups(manager,config,persist);const original=backups.create.bind(backups);
  backups.create=async(...args)=>{order.push('archive');if(failure==='backup')throw Error('No space');return original(...args);};
  const hc=new Hardcore(manager,backups,config,persist,{countdown:async()=>{},verify:async()=>{if(failure==='verify')throw Error('Generation failed');hc.data.current.seed=seedMode==='same'?'-1234567890123456789':'987654321';}});
  hc.data.current={id:crypto.randomUUID(),number:1,startedAt:new Date(Date.now()-60000).toISOString(),seed:'-1234567890123456789',protected:protectedRun};hc.data.sequence=1;hc.save();hc.control();
  const event={eventId:crypto.randomUUID(),runId:hc.data.current.id,player:'realPlayer',uuid:crypto.randomUUID(),at:new Date().toISOString(),seed:hc.data.current.seed,seconds:10,cause:'Real API message'};
  return {hc,manager,backups,config,persist,event,order};
}
function createWorld(label){
  const root=path.join(base,'server/acere');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'level.dat'),label);
  for(const dim of ['overworld','the_nether','the_end']){const dir=path.join(root,'dimensions/minecraft',dim);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'region.marker'),label);}
  if(label==='old'){fs.mkdirSync(path.join(root,'players'));fs.writeFileSync(path.join(root,'players/player.dat'),'inventory ender chest xp spectator');}
}
test('muerte válida termina la run y segunda muerte no duplica reset; whitelist, bans y tres dimensiones se conservan/reemplazan',async()=>{
  const {hc,manager,event,order}=fresh();
  assert.equal(hc.death(event),true);assert.equal(hc.data.phase,'countdown');assert.equal(manager.hardcoreLocked,true);assert.equal(hc.death({...event,eventId:crypto.randomUUID()}),false);
  await hc.pendingTask;assert.equal(hc.data.phase,'idle');assert.equal(hc.data.sequence,2);assert.equal(manager.hardcoreLocked,false);
  assert.match(fs.readFileSync(path.join(base,'server/whitelist.json'),'utf8'),/unchanged/);assert.match(fs.readFileSync(path.join(base,'server/banned-players.json'),'utf8'),/banned/);
  for(const dim of ['overworld','the_nether','the_end'])assert.equal(fs.readFileSync(path.join(base,'server/acere/dimensions/minecraft',dim,'region.marker'),'utf8'),'new');
  assert.equal(fs.existsSync(path.join(base,'server/acere/players/player.dat')),false);
  assert.ok(order.indexOf('archive')<order.indexOf('stop'));assert.ok(order.indexOf('stop')<order.indexOf('start'));
  assert.ok(hc.data.history[0].duration>=60000);assert.equal(hc.data.history[0].death.player,'realPlayer');
});
test('archivo final real incluye dimensiones y metadatos de muerte, fuera de rotación automática',async()=>{
  const {hc,event,backups}=fresh();hc.death(event);await hc.pendingTask;
  const file=path.join(RUNS,hc.data.history[0].archive);const meta=JSON.parse(fs.readFileSync(file+'.json'));
  assert.equal(meta.sha256,await digest(file));assert.equal(meta.run.death.player,'realPlayer');assert.equal(meta.run.seed,event.seed);assert.deepEqual(meta.worlds,['acere']);
  const yauzl=(await import('yauzl')).default;const entries=await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);const names=[];zip.on('entry',e=>{names.push(e.fileName);zip.readEntry();});zip.on('end',()=>resolve(names));zip.on('error',reject);zip.readEntry();}));
  for(const dim of ['overworld','the_nether','the_end'])assert.ok(entries.includes('acere/dimensions/minecraft/'+dim+'/region.marker'));
  assert.ok(entries.includes('acere/players/player.dat'));backups.rotate();assert.equal(fs.existsSync(file),true);
});
test('seed aleatoria deja level-seed vacío; misma seed conserva exactitud de 64 bits',async()=>{
  let f=fresh({archive:false});f.hc.death(f.event);await f.hc.pendingTask;assert.equal(core.readProperties()['level-seed'],'');
  f=fresh({archive:false,seedMode:'same'});f.hc.death(f.event);await f.hc.pendingTask;assert.equal(core.readProperties()['level-seed'],f.event.seed);
  assert.throws(()=>nextSeed('same',null));assert.throws(()=>nextSeed('same','9223372036854775808'));
});
test('archivo desactivado no crea ZIP; borra únicamente staging tras verificación exitosa',async()=>{
  const {hc,event,order}=fresh({archive:false});hc.death(event);await hc.pendingTask;
  assert.equal(order.includes('archive'),false);assert.deepEqual(fs.readdirSync(RUNS),[]);assert.equal(hc.data.history[0].archive,undefined);
});
test('acere protegido y evento de otra run no disparan reset',()=>{
  let f=fresh({protectedRun:true});assert.equal(f.hc.death(f.event),false);assert.equal(f.hc.data.phase,'idle');
  f=fresh();assert.equal(f.hc.death({...f.event,runId:crypto.randomUUID()}),false);
});
test('reset manual requiere confirmación fuerte y produce nueva run',async()=>{
  const {hc}=fresh({archive:false,protectedRun:true});assert.throws(()=>hc.manual('REINICIAR'));
  assert.match(hc.manual('REINICIAR RUN'),/Cuenta atrás/);await hc.pendingTask;assert.equal(hc.data.phase,'idle');assert.equal(hc.data.current.protected,false);assert.equal(hc.data.history[0].reason,'manual');
});
test('Paper debe terminar antes de mover el mundo; bloqueo de proceso sin controlar',()=>{
  const {manager}=fresh();assert.throws(()=>requireOffline(manager));manager.state='offline';assert.throws(()=>requireOffline(manager));manager.child=null;assert.doesNotThrow(()=>requireOffline(manager));manager.unmanaged=()=>true;assert.throws(()=>requireOffline(manager));
});
test('fallo de backup conserva mundo y seed; estado recuperable sin reset paralelo',async()=>{
  const {hc,event,manager}=fresh({failure:'backup'});hc.death(event);await hc.pendingTask;
  assert.equal(hc.data.phase,'failed');assert.equal(manager.state,'offline');assert.equal(manager.hardcoreLocked,true);assert.equal(core.readProperties()['level-seed'],'old');
  assert.equal(fs.readFileSync(path.join(base,'server/acere/players/player.dat'),'utf8'),'inventory ender chest xp spectator');
  assert.equal(hc.death(event),false);await hc.recover('RECUPERAR');assert.equal(hc.data.current.protected,true);assert.equal(hc.data.phase,'idle');
});
test('fallo tras generar mundo recupera exactamente el anterior y propiedades; arranque posterior detecta journal pendiente',async()=>{
  const f=fresh({failure:'verify',archive:false});f.hc.death(f.event);await f.hc.pendingTask;
  assert.equal(f.hc.data.phase,'failed');assert.equal(f.manager.state,'offline');
  const restarted=new Hardcore(f.manager,f.backups,f.config,f.persist);assert.equal(restarted.data.phase,'failed');assert.equal(f.manager.hardcoreLocked,true);
  await restarted.recover('RECUPERAR');assert.equal(core.readProperties()['level-seed'],'old');assert.equal(fs.readFileSync(path.join(base,'server/acere/level.dat'),'utf8'),'old');assert.equal(fs.existsSync(path.join(base,'server/acere/players/player.dat')),true);
});
test('configuración Hardcore persiste y cuenta atrás acepta únicamente 5–60 segundos',()=>{
  const {config,persist}=fresh();Object.assign(config,{hardcoreSeedMode:'same',hardcoreArchive:false,hardcoreCountdown:60});persist();assert.equal(core.loadConfig().hardcoreCountdown,60);assert.equal(core.loadConfig().hardcoreSeedMode,'same');assert.equal(core.loadConfig().hardcoreArchive,false);
  for(const value of [4,61,10.5,'10'])assert.throws(()=>core.validateConfig({...config,hardcoreCountdown:value}));for(const value of [5,10,60])assert.equal(core.validateConfig({...config,hardcoreCountdown:value}).hardcoreCountdown,value);
});
test('layout moderno usa solo raíz activa; no mueve mundos ajenos ni hermanos antiguos',()=>{
  fresh();fs.mkdirSync(path.join(base,'server/acere_nether'));fs.mkdirSync(path.join(base,'server/world'));assert.deepEqual(activeWorldRoots('acere'),['acere']);assert.throws(()=>activeWorldRoots('../world'));
});
