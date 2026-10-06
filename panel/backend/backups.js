import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { ROOT, SERVER, CONFIG, safePath, treeInfo, readProperties, atomicWrite, audit, nextBackup, validateProperties, serializeProperties } from './core.js';
export const BACKUPS = path.join(SERVER, 'backups');
export const backupName = /^backup-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d-\d{3}-[a-f0-9]{8}\.zip$/;
export function checkedBackup(name) { if (typeof name !== 'string' || !backupName.test(name)) throw Error('Nombre de backup inválido.'); return safePath(BACKUPS, name); }
export async function digest(file) { const hash = crypto.createHash('sha256'); for await (const data of fs.createReadStream(file)) hash.update(data); return hash.digest('hex'); }
function walk(folder, prefix, archive) {
  safePath(ROOT, path.relative(ROOT, folder));
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    // Paper mantiene este bloqueo exclusivo abierto en Windows; se recrea al iniciar.
    if (entry.name === 'session.lock') continue;
    const file = safePath(folder, entry.name), name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(file, name, archive);
    else if (entry.isFile()) archive.file(file, { name });
    else throw Error('Tipo de archivo no permitido.');
  }
}
export function rotationCandidates(items, config, now = Date.now()) {
  const auto = items.filter(x => x.type === 'automatic').sort((a,b) => Date.parse(b.created)-Date.parse(a.created));
  return auto.filter((x,i) => i >= config.maxAutomatic || config.maxAgeDays > 0 && now-Date.parse(x.created) > config.maxAgeDays*86400000);
}
export function validateEntry(name, manifest) {
  if (typeof name !== 'string' || name.includes('\\') || name.includes(':') || name.includes('\0') || name.startsWith('/') || name.split('/').some(x => x === '..' || x === '.' || /[. ]$/.test(x) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x))) throw Error('ZIP con ruta insegura.');
  if (name === 'manifest.json') return;
  const first = name.split('/')[0];
  if (!manifest.worlds.includes(first) && !['settings'].includes(first)) throw Error('ZIP con contenido no permitido.');
}
export class Backups {
  constructor(manager, config, persist) { this.manager=manager; this.config=config; this.persist=persist; fs.mkdirSync(BACKUPS, {recursive:true}); }
  list() {
    return fs.readdirSync(BACKUPS).filter(x=>backupName.test(x)).map(name => {
      let meta; try { meta=JSON.parse(fs.readFileSync(safePath(BACKUPS,name+'.json'),'utf8')); } catch { meta={ type:'unknown', created:fs.statSync(checkedBackup(name)).mtime.toISOString() }; }
      return {name, created:meta.created, type:meta.type, bytes:fs.statSync(checkedBackup(name)).size};
    }).sort((a,b)=>Date.parse(b.created)-Date.parse(a.created));
  }
  available() { if (this.manager.busy || this.manager.hardcoreLocked || ['starting','stopping'].includes(this.manager.state) || this.manager.unmanaged()) throw Error('Espera: Paper o los backups están ocupados, o hay un proceso sin controlar.'); }
  async create(type='manual', internal=false, options={}) {
    if (!internal) this.available();
    const prev=this.manager.busy; this.manager.busy=type==='pre-restore' ? 'restauración' : 'backup';
    let savingDisabled=false, file, output, archive;
    try {
      const properties=readProperties(); const name=properties['level-name']; validateProperties({'level-name':name});
      const worlds=options.worlds||[name,name+'_nether',name+'_the_end'].filter(w=>fs.existsSync(safePath(SERVER,w)));
      if(worlds.some(w=>![name,name+'_nether',name+'_the_end'].includes(w)))throw Error('Mundos no permitidos para backup.');
      const sourceBytes=worlds.reduce((n,w)=>n+treeInfo(safePath(SERVER,w)).bytes,0);
      const space=await fsp.statfs(BACKUPS); if (Number(space.bavail)*Number(space.bsize)<sourceBytes+512*1024*1024) throw Error('Espacio insuficiente para un backup seguro.');
      if (this.manager.state==='online') {
        savingDisabled=true; this.manager.raw('save-off');
        await this.manager.confirmed('save-all flush', /Saved the game|Saved the world/);
      }
      const created=new Date().toISOString();
      const stamp=created.replace('T','_').replace(/:/g,'-').replace('Z','').replace('.', '-');
      file=checkedBackup(`backup-${stamp}-${crypto.randomBytes(4).toString('hex')}.zip`);
      output=fs.createWriteStream(file+'.partial',{flags:'wx'}); archive=archiver('zip',{zlib:{level:4}});
      const completed=new Promise((resolve,reject)=>{output.on('close',resolve); output.on('error',reject);archive.on('error',reject);archive.on('warning',reject);});
      completed.catch(()=>{});
      archive.pipe(output);
      const manifest={format:1,created,type,worldName:name,worlds,...(options.run?{run:options.run}:{})}; archive.append(JSON.stringify(manifest,null,2),{name:'manifest.json'});
      for (const world of worlds) walk(safePath(SERVER,world),world,archive);
      for (const item of ['server.properties','whitelist.json','ops.json','banned-players.json','banned-ips.json','bukkit.yml','spigot.yml']) if(fs.existsSync(safePath(SERVER,item))) archive.file(safePath(SERVER,item),{name:'settings/'+item});
      if (fs.existsSync(safePath(SERVER,'config'))) walk(safePath(SERVER,'config'),'settings/config',archive);
      if(fs.existsSync(safePath(ROOT,'config/panel-config.json')))archive.file(CONFIG,{name:'settings/panel-config.json'});
      await Promise.all([archive.finalize(),completed]);
      fs.renameSync(file+'.partial',file);
      atomicWrite(file+'.json',JSON.stringify({...manifest,sha256:await digest(file)},null,2));
      this.config.lastBackup=created; this.persist(); audit('backup creado',path.basename(file)+' / '+type);
      if(type==='automatic') this.rotate();
      return {name:path.basename(file),message:worlds.length?'Backup completado.':'Backup de configuración completado. El mundo todavía no ha sido generado.'};
    } catch(e) {
      archive?.abort(); output?.destroy(); if(file&&fs.existsSync(file+'.partial')) try{fs.unlinkSync(file+'.partial');}catch{}
      throw e;
    } finally {
      if(savingDisabled && this.manager.child) { try{this.manager.raw('save-on');audit('guardado automático reactivado');}catch(e){this.manager.log('ATENCIÓN: envía save-on desde la consola local. '+e.message);audit('error reactivando guardado',e.message);} }
      this.manager.busy=prev;
    }
  }
  rotate() { for(const item of rotationCandidates(this.list(),this.config)) this.remove(item.name,true); }
  remove(name, internal=false) {
    if(!internal)this.available(); const file=checkedBackup(name); fs.unlinkSync(file); const meta=safePath(BACKUPS,name+'.json'); if(fs.existsSync(meta))fs.unlinkSync(meta);audit('backup eliminado',name);
  }
  async tick() {
    if(!this.config.backupsEnabled || !this.config.nextBackup || Date.parse(this.config.nextBackup)>Date.now() || this.manager.busy || this.manager.hardcoreLocked) return;
    try { await this.create('automatic'); } catch(e) { audit('backup automático fallido',e.message); this.manager.log('Backup automático: '+e.message); }
    finally { this.config.nextBackup=nextBackup(this.config);this.persist(); }
  }
  async restore(name, confirmation) {
    this.available(); if(this.manager.state!=='offline' || this.manager.child || confirmation!=='RESTAURAR')throw Error('Detén Paper y confirma escribiendo RESTAURAR.');
    const file=checkedBackup(name); this.manager.busy='restauración';let stage,previous,manifest;const movedOld=[],movedNew=[];
    try {
      const meta=JSON.parse(fs.readFileSync(safePath(BACKUPS,name+'.json'),'utf8'));
      if(meta.sha256!==await digest(file))throw Error('El checksum del ZIP no coincide. No se restauró nada.');
      manifest=meta;
      validateProperties({'level-name':manifest.worldName});
      if(manifest.format!==1 || !Array.isArray(manifest.worlds) || !manifest.worlds.length || !manifest.worlds.includes(manifest.worldName) || manifest.worlds.some(w=>![manifest.worldName,manifest.worldName+'_nether',manifest.worldName+'_the_end'].includes(w)))throw Error('Backup sin mundo válido.');
      stage=safePath(BACKUPS,'.restore-'+crypto.randomUUID()); fs.mkdirSync(stage);
      await extractValidated(file,stage,manifest);
      const inside=JSON.parse(fs.readFileSync(safePath(stage,'manifest.json'),'utf8'));
      if(JSON.stringify(inside.worlds)!==JSON.stringify(manifest.worlds)||inside.worldName!==manifest.worldName)throw Error('Manifiesto inconsistente.');
      for(const w of manifest.worlds)if(!fs.existsSync(safePath(stage,w,'level.dat')))throw Error('Falta level.dat en una dimensión.');
      const safety=await this.create('pre-restore',true);
      const properties=readProperties();previous=safePath(BACKUPS,'.previous-'+crypto.randomUUID());fs.mkdirSync(previous);
      const current=properties['level-name'];validateProperties({'level-name':current});
      const all=[...new Set([current,current+'_nether',current+'_the_end',manifest.worldName,manifest.worldName+'_nether',manifest.worldName+'_the_end'])];
      for(const w of all)if(fs.existsSync(safePath(SERVER,w))){fs.renameSync(safePath(SERVER,w),safePath(previous,w));movedOld.push(w);}
      for(const w of manifest.worlds){fs.renameSync(safePath(stage,w),safePath(SERVER,w));movedNew.push(w);}
      atomicWrite(path.join(SERVER,'server.properties'),serializeProperties({...properties,'level-name':manifest.worldName}));
      audit('backup restaurado',name+'; seguridad: '+safety.name);
      try{safePath(BACKUPS,path.basename(previous));fs.rmSync(previous,{recursive:true});}catch(e){audit('limpieza de restauración pendiente',path.basename(previous)+' / '+e.message);}previous=null;
      return {message:'Mundos restaurados. Configuración, whitelist y OP actuales conservados; sus copias están dentro del ZIP.',safety:safety.name};
    } catch(e) {
      if(previous&&fs.existsSync(previous)) {
        for(const w of movedNew){const target=safePath(SERVER,w);if(fs.existsSync(target))fs.renameSync(target,safePath(stage,'failed-'+w));}
        for(const w of movedOld)fs.renameSync(safePath(previous,w),safePath(SERVER,w));
        audit('restauración revertida',e.message);
      }
      throw e;
    } finally {this.manager.busy=null;if(stage&&fs.existsSync(stage)){safePath(BACKUPS,path.basename(stage));fs.rmSync(stage,{recursive:true});}}
  }
}
export function extractValidated(file,destination,manifest) {
  return new Promise((resolve,reject)=>{
    yauzl.open(file,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
      if(error)return reject(error);let total=0;const seen=new Set();let failed=false;
      function fail(e){if(failed)return;failed=true;zip.close();reject(e);}
      zip.on('error',fail);zip.on('end',resolve);
      zip.on('entry',async entry=>{
        try {
          validateEntry(entry.fileName,manifest);
          const key=entry.fileName.toLowerCase();if(seen.has(key))throw Error('ZIP con entradas duplicadas.');seen.add(key);
          const mode=(entry.externalFileAttributes>>>16)&0xf000;if(mode===0xa000)throw Error('ZIP con enlaces simbólicos.');
          total+=entry.uncompressedSize;if(total>64*1024**3||entry.uncompressedSize>16*1024**3)throw Error('ZIP excede límites de tamaño.');
          const target=safePath(destination,entry.fileName);
          if(entry.fileName.endsWith('/')) {fs.mkdirSync(target,{recursive:true});zip.readEntry();return;}
          const space=await fsp.statfs(destination);if(Number(space.bavail)*Number(space.bsize)<entry.uncompressedSize+512*1024**2)throw Error('Espacio insuficiente para restauración.');
          fs.mkdirSync(path.dirname(target),{recursive:true});
          zip.openReadStream(entry,async(e,stream)=>{if(e)return fail(e);try{await pipeline(stream,fs.createWriteStream(target,{flags:'wx'}));zip.readEntry();}catch(e){fail(e);}});
        }catch(e){fail(e);}
      });zip.readEntry();
    });
  });
}
