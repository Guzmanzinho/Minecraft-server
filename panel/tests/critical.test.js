import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
const base=fs.mkdtempSync(path.resolve('tests/.tmp-'));
fs.mkdirSync(path.join(base,'panel/backend'),{recursive:true});
for(const name of ['core.js','manager.js','backups.js'])fs.copyFileSync(path.resolve('backend',name),path.join(base,'panel/backend',name));
fs.writeFileSync(path.join(base,'panel/package.json'),' {"type":"module"}');
for(const name of ['server/backups','server/plugins','config'])fs.mkdirSync(path.join(base,name),{recursive:true});
fs.writeFileSync(path.join(base,'server/server.properties'),'motd=Hola\\u00f1\nlevel-name=world\nlevel-seed=\nserver-port=25565\nonline-mode=true\nwhite-list=true\nenable-rcon=false\n');
const core=await import(pathToFileURL(path.join(base,'panel/backend/core.js')));
const backupModule=await import(pathToFileURL(path.join(base,'panel/backend/backups.js')));
const {Manager,validateCommand}=await import(pathToFileURL(path.join(base,'panel/backend/manager.js')));
after(()=>{core.safePath(path.resolve('tests'),path.basename(base));fs.rmSync(base,{recursive:true});});
test('properties: lectura, Unicode, escritura real y seguridad conservada',()=>{
  assert.equal(core.readProperties().motd,'Holañ');
  core.writeProperties({motd:'Mundo ñ 😀','max-players':10},false);
  const p=core.readProperties();assert.equal(p.motd,'Mundo ñ 😀');assert.equal(p['max-players'],'10');assert.equal(p['online-mode'],'true');assert.equal(p['white-list'],'true');assert.equal(p['enable-rcon'],'false');
  assert.deepEqual({...core.parseProperties('motd=hello\\\n  world\n# ignored\npvp:true\n')},{motd:'helloworld',pvp:'true'});
});
test('26.2: guardar controles gráficos no reintroduce propiedades obsoletas',()=>{
  core.writeProperties({pvp:true,'enable-command-block':false},false);
  const p=core.readProperties();for(const key of ['pvp','enable-command-block','allow-nether'])assert.equal(Object.hasOwn(p,key),false);
});
test('validación: límites, whitelist, puerto del panel, mundo y claves desconocidas',()=>{
  for(const value of [{'max-players':0},{'view-distance':40},{pvp:'yes'},{'white-list':false},{'server-port':3000},{'level-name':'../outside'},{'level-name':'backups'},{'level-name':'NUL'},{motd:'x\ny'},{'online-mode':false},{toString:'evil'}])assert.throws(()=>core.validateProperties(value));
  assert.throws(()=>core.writeProperties({'level-name':'newworld'},true));
  assert.doesNotThrow(()=>core.validateProperties({difficulty:'hard',pvp:true,'level-name':'Survival_2'}));
});
test('configuración persistente: frecuencia, límites RAM y recuperación de corrupción',()=>{
  const file=path.join(base,'config/test.json');const c=core.validateConfig({...core.defaults,intervalMinutes:240});core.atomicWrite(file,JSON.stringify(c));assert.equal(core.loadConfig(file).intervalMinutes,240);
  for(const value of [{ramMin:10,ramMax:8},{ramMax:24},{intervalMinutes:1},{maxAutomatic:0},{backupsEnabled:'true'},{nextBackup:'invalid'}])assert.throws(()=>core.validateConfig({...core.defaults,...value}));
  fs.writeFileSync(file,'broken');assert.equal(core.loadConfig(file).ramMax,8);assert.ok(fs.readdirSync(path.dirname(file)).some(x=>x.startsWith('test.json.corrupt-')));
});
test('próximo backup: cálculo preciso y desactivación',()=>{
  const now=Date.parse('2026-10-04T12:00:00Z');assert.equal(core.nextBackup({...core.defaults,intervalMinutes:180},now),'2026-10-04T15:00:00.000Z');assert.equal(core.nextBackup({...core.defaults,backupsEnabled:false},now),null);
});
test('rotación: retención, antigüedad y protección de manuales',()=>{
  const now=Date.now();const items=Array.from({length:5},(_,i)=>({name:String(i),type:'automatic',created:new Date(now-i*86400000).toISOString()}));items.push({name:'manual',type:'manual',created:'2020-01-01T00:00:00Z'},{name:'safety',type:'pre-restore',created:'2020-01-01T00:00:00Z'});
  assert.deepEqual(backupModule.rotationCandidates(items,{maxAutomatic:2,maxAgeDays:0},now).map(x=>x.name),['2','3','4']);assert.deepEqual(backupModule.rotationCandidates(items,{maxAutomatic:20,maxAgeDays:2},now).map(x=>x.name),['3','4']);
});
test('rutas: traversal, rutas absolutas, ZIP y nombres Windows',()=>{
  assert.throws(()=>core.safePath(base,'../outside'));assert.throws(()=>core.safePath(base,'C:\\Windows'));assert.throws(()=>backupModule.checkedBackup('../bad.zip'));
  const m={worlds:['world']};for(const name of ['../outside','world/../a','world\\bad','C:/bad','world/a:ads','world/CON','world/a.','evil/file'])assert.throws(()=>backupModule.validateEntry(name,m));assert.doesNotThrow(()=>backupModule.validateEntry('world/region/r.0.0.mca',m));
});
test('consola: lista permitida y rechazo de comandos del sistema',()=>{
  for(const command of ['say Hola','time set day','weather clear','whitelist add Player_1','gamemode creative Player_1'])assert.equal(validateCommand(command),command);
  for(const command of ['cmd.exe','powershell whoami','say Hola\nstop','stop','op Player','execute run something','whitelist off'])assert.throws(()=>validateCommand(command));
});
test('estado: offline inicial, jugadores, TPS y limpieza de logs',()=>{
  const manager=new Manager({...core.defaults},()=>{});assert.equal(manager.status().state,'offline');assert.equal(manager.status().metrics,null);
  manager.log('[12:00:00 INFO]: Done (1.1s)! For help, type "help"');assert.equal(manager.state,'online');manager.log('[12:00:00 INFO]: Player joined the game');assert.deepEqual(manager.players,['Player']);manager.log('[12:00:00 INFO]: Player left the game');assert.deepEqual(manager.players,[]);manager.log('[12:00:00 INFO]: TPS from last 1m, 5m, 15m: 20.0, 19.9, 20.0');assert.deepEqual(manager.tps.values,[20,19.9,20]);
});
test('instancias: lock exclusivo y rechazo de segundo inicio',async()=>{
  const lock=path.join(base,'config/test.lock');core.acquireLock(lock);assert.throws(()=>core.acquireLock(lock));fs.unlinkSync(lock);
  const manager=new Manager({...core.defaults},()=>{});manager.state='starting';await assert.rejects(manager.start());manager.state='online';await assert.rejects(manager.start());manager.state='offline';manager.busy='backup';await assert.rejects(manager.start());
});
test('inicio sin EULA: no crea Java y recupera estado offline',async()=>{
  const manager=new Manager({...core.defaults},()=>{});await assert.rejects(manager.start());assert.equal(manager.child,null);assert.equal(manager.state,'offline');assert.equal(fs.existsSync(manager.lock),false);
});
test('detención: envía stop y espera confirmación del proceso, sin kill',async()=>{
  const manager=new Manager({...core.defaults},()=>{});manager.state='online';let command='';let killed=false;
  manager.child={stdin:{write(text){command=text;setImmediate(()=>{manager.child=null;manager.state='offline';manager.emit('stopped');});}},kill(){killed=true;}};
  await manager.stop();assert.equal(command,'stop\n');assert.equal(killed,false);assert.equal(manager.state,'offline');
});
test('reinicio: espera la detención antes de solicitar inicio',async()=>{
  const manager=new Manager({...core.defaults},()=>{}),calls=[];
  manager.stop=async()=>{calls.push('stop');};manager.start=async()=>{calls.push('start');return 'ok';};
  assert.equal(await manager.restart(),'ok');assert.deepEqual(calls,['stop','start']);
  manager.stop=async()=>{throw Error('no stop');};calls.length=0;await assert.rejects(manager.restart());assert.deepEqual(calls,[]);
});
test('Minecraft 26.2: PvP y command blocks aplicados por gamerules en tres dimensiones',async()=>{
  const manager=new Manager({...core.defaults},()=>{});manager.state='online';const commands=[];manager.confirmed=async command=>commands.push(command);await manager.applyWorldSettings();
  assert.equal(commands.length,6);assert.ok(commands.includes('execute in minecraft:the_end run gamerule minecraft:command_blocks_work false'));assert.ok(commands.includes('execute in minecraft:the_nether run gamerule minecraft:pvp true'));assert.equal(manager.busy,null);assert.equal(manager.config.restartRequired,false);
  manager.confirmed=async()=>{throw Error('no confirmation');};await assert.rejects(manager.applyWorldSettings());assert.equal(manager.busy,null);
});
class FakeManager extends EventEmitter{constructor(){super();this.state='offline';this.child=null;this.busy=null;this.commands=[];}unmanaged(){return false;}raw(c){this.commands.push(c);}async confirmed(c){this.commands.push(c);if(this.fail)throw Error('simulated flush failure');}log(){} }
test('TPS con coma decimal: conserva valores completos',()=>{
  const m=new Manager({...core.defaults},()=>{});m.log('TPS from last 1m, 5m, 15m: 20,0, 19,9, 18,75');assert.deepEqual(m.tps.values,[20,19.9,18.75]);
});
test('consultas gamerule: permite solo dimensiones y reglas conocidas sin mutaciones',()=>{
 assert.doesNotThrow(()=>validateCommand('execute in minecraft:the_nether run gamerule minecraft:allow_entering_nether_using_portals'));
 assert.throws(()=>validateCommand('execute in minecraft:the_nether run gamerule minecraft:pvp false'));
 assert.throws(()=>validateCommand('execute in minecraft:overworld run op FakePlayer'));
});
test('26.2: almacenamiento y ZIP incluyen dimensiones dentro del mundo único',async()=>{
 const name='modern';fs.mkdirSync(path.join(base,'server',name),{recursive:true});fs.writeFileSync(path.join(base,'server',name,'level.dat'),'fixture');fs.writeFileSync(path.join(base,'server',name,'session.lock'),'transient-lock');
 for(const dimension of ['overworld','the_nether','the_end']){const folder=path.join(base,'server',name,'dimensions/minecraft',dimension,'region');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'r.0.0.mca'),'fixture-'+dimension);}
 const storage=core.worldStorage(name);assert.ok(storage.worlds.every(w=>w.exists&&w.bytes>0));assert.equal(storage.worlds[1].path,'modern/dimensions/minecraft/the_nether');
 const before=fs.readFileSync(path.join(base,'server/server.properties'),'utf8');fs.writeFileSync(path.join(base,'server/server.properties'),'level-name=modern\n');
 try{const backups=new backupModule.Backups(new FakeManager(),{...core.defaults},()=>{}),result=await backups.create();const meta=JSON.parse(fs.readFileSync(backupModule.checkedBackup(result.name)+'.json'));assert.deepEqual(meta.worlds,['modern']);const dest=path.join(base,'modern-check');fs.mkdirSync(dest);await backupModule.extractValidated(backupModule.checkedBackup(result.name),dest,meta);assert.equal(fs.existsSync(path.join(dest,'modern/session.lock')),false);for(const dimension of ['overworld','the_nether','the_end'])assert.equal(fs.readFileSync(path.join(dest,'modern/dimensions/minecraft',dimension,'region/r.0.0.mca'),'utf8'),'fixture-'+dimension);
 }finally{fs.writeFileSync(path.join(base,'server/server.properties'),before);}
});
let savedBackup;
test('backup comprimido: todas las dimensiones, configuración y SHA-256',async()=>{
  for(const world of ['world','world_nether','world_the_end']){fs.mkdirSync(path.join(base,'server',world),{recursive:true});fs.writeFileSync(path.join(base,'server',world,'level.dat'),'original-'+world);}
  const manager=new FakeManager(),config={...core.defaults};const backups=new backupModule.Backups(manager,config,()=>{});savedBackup=(await backups.create()).name;const meta=JSON.parse(fs.readFileSync(path.join(base,'server/backups',savedBackup+'.json'),'utf8'));assert.deepEqual(meta.worlds,['world','world_nether','world_the_end']);assert.equal(meta.sha256,await backupModule.digest(backupModule.checkedBackup(savedBackup)));assert.equal(backups.list()[0].type,'manual');assert.equal(manager.busy,null);
});
test('backup online simulado: save-on siempre, incluso con flush fallido',async()=>{
  const manager=new FakeManager();manager.state='online';manager.child={};const backups=new backupModule.Backups(manager,{...core.defaults},()=>{});
  manager.fail=true;await assert.rejects(backups.create());assert.deepEqual(manager.commands,['save-off','save-all flush','save-on']);assert.equal(manager.busy,null);
  manager.fail=false;manager.commands=[];await backups.create();assert.deepEqual(manager.commands,['save-off','save-all flush','save-on']);
});
test('restauración real de archivos de prueba: copia previa, dimensiones y bloqueo online',async()=>{
  const manager=new FakeManager(),backups=new backupModule.Backups(manager,{...core.defaults},()=>{});
  manager.state='online';await assert.rejects(backups.restore(savedBackup,'RESTAURAR'));manager.state='offline';await assert.rejects(backups.restore(savedBackup,'wrong'));
  fs.writeFileSync(path.join(base,'server/world/level.dat'),'changed');const restored=await backups.restore(savedBackup,'RESTAURAR');assert.ok(restored.safety);assert.equal(fs.readFileSync(path.join(base,'server/world/level.dat'),'utf8'),'original-world');assert.equal(backups.list().find(x=>x.name===restored.safety).type,'pre-restore');assert.equal(manager.busy,null);
});
test('restauración: detecta ZIP alterado sin tocar mundos',async()=>{
  const manager=new FakeManager(),backups=new backupModule.Backups(manager,{...core.defaults},()=>{});const result=await backups.create();fs.appendFileSync(backupModule.checkedBackup(result.name),'tampered');await assert.rejects(backups.restore(result.name,'RESTAURAR'),/checksum/);assert.equal(manager.busy,null);assert.equal(fs.readFileSync(path.join(base,'server/world/level.dat'),'utf8'),'original-world');
});
test('programación automática: ejecución vencida, persistencia y desactivación',async()=>{
  const manager=new FakeManager(),config={...core.defaults,nextBackup:new Date(Date.now()-60000).toISOString(),maxAutomatic:1};let persisted=0;const backups=new backupModule.Backups(manager,config,()=>persisted++);await backups.tick();assert.equal(backups.list().filter(x=>x.type==='automatic').length,1);assert.ok(Date.parse(config.nextBackup)>Date.now());assert.ok(persisted>=2);const count=backups.list().length;config.backupsEnabled=false;config.nextBackup=new Date(0).toISOString();await backups.tick();assert.equal(backups.list().length,count);
});
