import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT,SERVER,safePath,atomicWrite,readProperties,writeProperties,validateProperties,audit} from './core.js';
const STATE=safePath(ROOT,'config/hardcore-state.json');
export const RUNS=safePath(ROOT,'runs');
const BRIDGE=safePath(SERVER,'plugins/HardcoreReset');
const iso=()=>new Date().toISOString();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export function activeWorldRoots(name){
  validateProperties({'level-name':name});
  if(fs.existsSync(safePath(SERVER,name,'dimensions')))return [name];
  return [name,name+'_nether',name+'_the_end'].filter(w=>fs.existsSync(safePath(SERVER,w)));
}
export function requireOffline(manager){
  if(manager.child||manager.state!=='offline'||manager.unmanaged())throw Error('Paper debe haber terminado antes de reemplazar el mundo.');
}
export function nextSeed(mode,seed){
  if(mode==='random')return '';
  if(mode!=='same'||typeof seed!=='string'||!/^[-]?\d{1,19}$/.test(seed))throw Error('No se conoce una seed fiable para reutilizar.');
  const value=BigInt(seed);if(value<-(2n**63n)||value>2n**63n-1n)throw Error('Seed fuera de rango.');
  return seed;
}
export class Hardcore {
  constructor(manager,backups,config,persist,hooks={}){
    Object.assign(this,{manager,backups,config,persist,hooks});
    fs.mkdirSync(BRIDGE,{recursive:true});fs.mkdirSync(RUNS,{recursive:true});
    this.data=fs.existsSync(STATE)?json(STATE):{format:1,phase:'idle',sequence:0,current:{id:'protected-'+crypto.randomUUID(),number:0,startedAt:null,seed:null,protected:true},history:[],pending:null,lastDeath:null};
    if(this.data.format!==1||!Array.isArray(this.data.history)||!this.data.current?.id)throw Error('Estado Hardcore corrupto: revisión necesaria.');
    if(this.data.phase!=='idle'){this.data.phase='failed';this.data.error='Una operación quedó pendiente. Recupera la run con Paper detenido antes de continuar.';manager.hardcoreLocked=true;}
    this.save();this.control();
  }
  save(){atomicWrite(STATE,JSON.stringify(this.data,null,2));}
  control(){atomicWrite(path.join(BRIDGE,'control.json'),JSON.stringify({runId:this.data.current.id,armed:!this.data.current.protected&&this.data.phase==='idle',enabled:this.config.hardcoreResetEnabled,seconds:this.config.hardcoreCountdown,ended:this.data.phase!=='idle'&&this.data.current.id===this.data.pending?.previous.id,initializing:this.data.phase!=='idle'&&this.data.current.id===this.data.pending?.next?.id}));}
  readSnapshot(){try{const s=json(path.join(BRIDGE,'snapshot.json'));if(s.runId!==this.data.current.id||Date.now()-Date.parse(s.at)>5000)return null;return s;}catch{return null;}}
  status(){const snapshot=this.readSnapshot(),main=snapshot?.worlds?.find(w=>w.key==='minecraft:overworld');
    return {...this.data,settings:{enabled:this.config.hardcoreResetEnabled,seedMode:this.config.hardcoreSeedMode,archive:this.config.hardcoreArchive,countdown:this.config.hardcoreCountdown},plugin:snapshot?.version||null,hardcore:main?.hardcore??null,difficulty:main?.difficulty??null,players:this.manager.players.length,elapsed:this.data.current.startedAt?Date.now()-Date.parse(this.data.current.startedAt):null,totalRuns:this.data.sequence};
  }
  async tick(){
    if(this.pendingTask)return;
    const s=this.readSnapshot();const main=s?.worlds?.find(w=>w.key==='minecraft:overworld');
    if(main&&this.data.current.seed!==main.seed){this.data.current.seed=main.seed;this.save();}
    const file=path.join(BRIDGE,'death.json');if(!fs.existsSync(file))return;
    let e;try{e=json(file);}catch{return;}
    this.death(e);
  }
  death(event){
    if(this.data.phase!=='idle'||this.data.current.protected||!this.config.hardcoreResetEnabled)return false;
    if(event?.runId!==this.data.current.id||typeof event.eventId!=='string'||!/^[a-f0-9-]{36}$/.test(event.eventId)||!/^\w{1,16}$/.test(event.player||'')||!/^[a-f0-9-]{36}$/.test(event.uuid||'')||!Number.isFinite(Date.parse(event.at)))return false;
    if(!Number.isInteger(event.seconds)||event.seconds<5||event.seconds>60)return false;
    this.data.lastDeath={player:event.player,uuid:event.uuid,at:event.at,cause:typeof event.cause==='string'?event.cause.slice(0,500):null};
    this.launch(event);return true;
  }
  manual(confirmation){
    if(confirmation!=='REINICIAR RUN')throw Error('Confirma escribiendo REINICIAR RUN. Esta operación elimina el progreso de todos.');
    if(this.data.phase!=='idle'||this.manager.busy||this.manager.unmanaged()||!['online','offline'].includes(this.manager.state))throw Error('Hay una operación pendiente.');
    const e={runId:this.data.current.id,eventId:crypto.randomUUID(),at:iso(),seconds:this.config.hardcoreCountdown,manual:true};
    if(this.config.hardcoreSeedMode==='same')nextSeed('same',this.data.current.seed);
    this.launch(e);return 'Cuenta atrás iniciada. La nueva run se verificará antes de darla por preparada.';
  }
  launch(event){
    this.manager.hardcoreLocked=true;
    this.data.phase='countdown';this.data.error=null;
    this.data.pending={event,previous:structuredClone(this.data.current),properties:fs.readFileSync(safePath(SERVER,'server.properties'),'utf8'),roots:activeWorldRoots(readProperties()['level-name']),archive:null,moved:[],next:null};
    this.save();this.control();
    this.pendingTask=this.reset().catch(async e=>{
      this.data.phase='failed';this.data.error=e.message;this.save();this.control();audit('reset Hardcore fallido',e.message);
      try{if(this.manager.state==='online'&&!this.manager.busy)await this.manager.stop(true);}catch(stop){this.data.error+=' / '+stop.message;this.save();}
    }).finally(()=>{this.pendingTask=null;});
  }
  phase(value){this.data.phase=value;this.save();}
  async waitFor(test,label,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(test())return;await delay(250);}throw Error(label+' no se confirmó; reset pausado.');}
  async countdown(){
    const e=this.data.pending.event;
    if(this.hooks.countdown)return this.hooks.countdown(e);
    if(this.manager.state==='offline'){await delay(e.seconds*1000);return;}
    if(e.manual)atomicWrite(path.join(BRIDGE,'manual.json'),JSON.stringify({runId:e.runId,eventId:e.eventId,seconds:e.seconds}));
    await this.waitFor(()=>{try{const ready=json(path.join(BRIDGE,'ready.json'));return ready.runId===e.runId&&ready.eventId===e.eventId;}catch{return false;}},'La cuenta atrás del plugin',(e.seconds+90)*1000);
  }
  async reset(){
    const p=this.data.pending,e=p.event;
    if(this.manager.state==='online'&&!this.readSnapshot()&&!this.hooks.verify)throw Error('El plugin Hardcore no responde. No se modifica el mundo.');
    await this.countdown();
    await this.waitFor(()=>!this.manager.busy,'Las operaciones pendientes');
    const properties=readProperties();
    if(properties['level-name']!==p.roots[0])throw Error('El mundo activo cambió; revisión necesaria.');
    const seed=nextSeed(this.config.hardcoreSeedMode,e.seed||p.previous.seed);
    const ended={...p.previous,endedAt:e.at,duration:p.previous.startedAt?Math.max(0,Date.parse(e.at)-Date.parse(p.previous.startedAt)):null,seed:e.seed||p.previous.seed,death:e.manual?null:this.data.lastDeath,reason:e.manual?'manual':'death'};
    this.phase('archiving');
    if(this.config.hardcoreArchive){
      const created=await this.backups.create('hardcore-run',true,{worlds:p.roots,run:ended});
      const name=`run-${String(p.previous.number).padStart(4,'0')}-${e.at.replace(/[:.]/g,'-')}-${e.eventId}.zip`;
      for(const suffix of ['', '.json'])fs.renameSync(safePath(SERVER,'backups',created.name+suffix),safePath(RUNS,name+suffix));
      p.archive=name;ended.archive=name;this.save();
    }
    this.phase('stopping');
    if(this.manager.state==='online')await this.manager.stop(true);
    requireOffline(this.manager);
    this.phase('moving');
    const stage=safePath(RUNS,'.staging-'+e.eventId);p.stage=path.basename(stage);this.save();fs.mkdirSync(stage,{recursive:true});
    for(const name of p.roots){
      requireOffline(this.manager);const source=safePath(SERVER,name),target=safePath(stage,name);
      fs.renameSync(source,target);p.moved.push(name);this.save();
    }
    requireOffline(this.manager);
    writeProperties({'level-seed':seed,hardcore:true,difficulty:'hard',gamemode:'survival'},false);
    p.next={id:crypto.randomUUID(),number:this.data.sequence+1,startedAt:null,seed:null,protected:false};
    this.data.current=p.next;this.control();this.phase('starting');
    await this.manager.start(true);
    await this.waitFor(()=>this.manager.state==='online'&&!this.manager.busy,'Paper ONLINE');
    this.phase('verifying');
    if(this.hooks.verify)await this.hooks.verify(this.data.current);
    else await this.waitFor(()=>{
      const snapshot=this.readSnapshot();if(!snapshot?.worlds||snapshot.ended)return false;
      for(const key of ['minecraft:overworld','minecraft:the_nether','minecraft:the_end']){
        const w=snapshot.worlds.find(w=>w.key===key);if(!w||!w.hardcore||w.difficulty!=='HARD')return false;
        const target=safePath(SERVER,properties['level-name'],'dimensions',...key.split(':'));
        if(path.resolve(w.folder)!==target||!fs.existsSync(target))return false;
      }
      const main=snapshot.worlds.find(w=>w.key==='minecraft:overworld');
      if(this.config.hardcoreSeedMode==='same'&&main.seed!==seed)throw Error('La seed nueva no coincide.');
      this.data.current.seed=main.seed;return true;
    },'Las tres dimensiones Hardcore');
    this.data.current.startedAt=iso();this.data.sequence=this.data.current.number;
    this.data.history.push(ended);this.data.pending=null;this.data.phase='idle';this.data.error=null;this.save();this.control();
    this.manager.hardcoreLocked=false;
    try{safePath(RUNS,p.stage);fs.rmSync(stage,{recursive:true});}catch(e){audit('staging Hardcore pendiente de limpieza',e.message);}
    audit('nueva run Hardcore',String(this.data.sequence));
  }
  async recover(confirmation){
    if(confirmation!=='RECUPERAR'||this.data.phase!=='failed'||this.pendingTask)throw Error('Confirma RECUPERAR con una operación fallida sin tareas activas.');
    if(this.manager.state==='online')await this.manager.stop(true);
    requireOffline(this.manager);
    const p=this.data.pending;if(!p)throw Error('Falta el diario de recuperación.');
    if(p.stage){
      const stage=safePath(RUNS,p.stage),quarantine=safePath(RUNS,'.failed-'+p.event.eventId);fs.mkdirSync(quarantine,{recursive:true});
      for(const name of p.roots){
        const old=safePath(stage,name);if(!fs.existsSync(old))continue;
        const live=safePath(SERVER,name);if(fs.existsSync(live))fs.renameSync(live,safePath(quarantine,name));
        fs.renameSync(old,live);
      }
    }
    atomicWrite(safePath(SERVER,'server.properties'),p.properties);
    this.data.current={...p.previous,protected:true};this.data.phase='idle';this.data.pending=null;this.data.error=null;this.save();this.control();this.manager.hardcoreLocked=false;
    audit('run Hardcore recuperada','Mundo previo recuperado y reset automático desarmado. Paper permanece detenido.');
    return 'Mundo previo recuperado. Paper detenido y reset automático desarmado; revisa antes de iniciar.';
  }
}
