import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SERVER = path.join(ROOT, 'server');
export const CONFIG = path.join(ROOT, 'config/panel-config.json');
export let configWarning = null;
export function safePath(base, ...parts) {
  const target = path.resolve(base, ...parts);
  if (target !== path.resolve(base) && !target.startsWith(path.resolve(base) + path.sep)) throw Error('Ruta fuera del proyecto.');
  let current = target;
  while (current.startsWith(path.resolve(base))) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('No se permiten enlaces ni junctions.');
    if (current === path.resolve(base)) break;
    current = path.dirname(current);
  }
  return target;
}
export function atomicWrite(file, data) {
  safePath(ROOT, path.relative(ROOT, file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}
export const defaults = { ramMin: 4, ramMax: 8, pvp: true, commandBlocks: false, backupsEnabled: true, intervalMinutes: 180, maxAutomatic: 24, maxAgeDays: 0, nextBackup: null, lastBackup: null, restartRequired: false, hardcoreResetEnabled:true, hardcoreSeedMode:'random', hardcoreArchive:true, hardcoreCountdown:10 };
export function integer(v, min, max, label) {
  if (!Number.isInteger(v) || v < min || v > max) throw Error(`${label}: utiliza un entero entre ${min} y ${max}.`);
  return v;
}
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Configuración inválida.');
  const result = { ...defaults, ...input };
  for (const k of Object.keys(result)) if (!Object.hasOwn(defaults,k)) throw Error('Preferencia desconocida.');
  integer(result.ramMin, 1, 12, 'RAM mínima'); integer(result.ramMax, 2, 12, 'RAM máxima');
  if (result.ramMin > result.ramMax) throw Error('RAM mínima mayor que RAM máxima.');
  integer(result.intervalMinutes, 15, 10080, 'Frecuencia en minutos'); integer(result.maxAutomatic, 1, 200, 'Retención'); integer(result.maxAgeDays, 0, 365, 'Antigüedad');
  integer(result.hardcoreCountdown,5,60,'Cuenta atrás Hardcore');
  if(!['random','same'].includes(result.hardcoreSeedMode))throw Error('Modo de seed Hardcore inválido.');
  for(const key of ['hardcoreResetEnabled','hardcoreArchive'])if(typeof result[key]!=='boolean')throw Error('Preferencia Hardcore inválida.');
  for (const k of ['pvp','commandBlocks','backupsEnabled', 'restartRequired']) if (typeof result[k] !== 'boolean') throw Error('Valor booleano inválido.');
  for (const k of ['nextBackup', 'lastBackup']) if (result[k] !== null && (typeof result[k] !== 'string' || !Number.isFinite(Date.parse(result[k])))) throw Error('Fecha inválida.');
  return result;
}
export function nextBackup(config, now = Date.now()) { return config.backupsEnabled ? new Date(now + config.intervalMinutes * 60000).toISOString() : null; }
export function loadConfig(file = CONFIG) {
  try { return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))); }
  catch (e) {
    if (fs.existsSync(file)) { fs.copyFileSync(file, file + `.corrupt-${Date.now()}`); configWarning='La configuración del panel estaba corrupta. Se conservó una copia y se aplicaron valores seguros. Revisa RAM y backups.'; console.error(configWarning, e.message); }
    const config = { ...defaults }; config.nextBackup = nextBackup(config); atomicWrite(file, JSON.stringify(config, null, 2)); return config;
  }
}
export function audit(action, details = '') {
  const file = safePath(ROOT, 'panel/logs/admin.jsonl'); fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.statSync(file).size > 2000000) fs.renameSync(file, file + '.' + Date.now());
  fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), action, details }) + '\n');
}
const unescapeProp = s => s.replace(/\\u([0-9a-f]{4})|\\(.)/gi, (_, hex, ch) => hex ? String.fromCharCode(parseInt(hex, 16)) : ({ n: '\n', r: '\r', t: '\t' }[ch] ?? ch));
export function parseProperties(text) {
  const out = Object.create(null);
  const lines = text.replace(/^\uFEFF/, '').replace(/\\\r?\n\s*/g, '').split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*[#!]/.test(line) || !line.trim()) continue;
    const match = line.match(/^\s*([^=:\s]+)\s*(?:[=:]\s*|\s+)(.*)$/);
    if (match) out[match[1]] = unescapeProp(match[2]);
  } return out;
}
function escapeProp(value) { return String(value).replace(/\\/g, '\\\\').replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); }
export function serializeProperties(values) { return '# Administrado por el panel local\n' + Object.entries(values).map(([k,v]) => `${k}=${escapeProp(v)}`).join('\n') + '\n'; }
export const schema = {
  motd: ['text', 120], 'max-players': ['number', 1, 20], gamemode: ['select', 'survival', 'creative', 'adventure', 'spectator'], difficulty: ['select', 'peaceful', 'easy', 'normal', 'hard'],
  hardcore: ['boolean'], pvp: ['boolean'], 'white-list': ['locked'], 'allow-flight': ['boolean'], 'enable-command-block': ['boolean'], 'spawn-protection': ['number', 0, 64],
  'view-distance': ['number', 3, 16], 'simulation-distance': ['number', 3, 12], 'server-port': ['number', 1024, 65535], 'level-name': ['world'], 'level-seed': ['seed']
};
export function validateProperties(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Propiedades inválidas.');
  const result = {};
  for (const [k,v] of Object.entries(input)) {
    const rule = schema[k]; if (!Object.hasOwn(schema,k)) throw Error('Propiedad no permitida.');
    if (rule[0] === 'number') { integer(v, rule[1], rule[2], k); if (k === 'server-port' && v === 3000) throw Error('El puerto 3000 está reservado al panel.'); }
    if (rule[0] === 'boolean' && typeof v !== 'boolean') throw Error(`${k}: booleano requerido.`);
    if (rule[0] === 'locked' && v !== true) throw Error('La whitelist es obligatoria.');
    if (rule[0] === 'select' && !rule.slice(1).includes(v)) throw Error(`${k}: opción inválida.`);
    if (rule[0] === 'text' && (typeof v !== 'string' || v.length > rule[1] || /[\r\n\x00]/.test(v))) throw Error('MOTD inválido.');
    if (rule[0] === 'world' && (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(v) || /^(plugins|logs|backups|config|cache|libraries|versions|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v))) throw Error('Nombre del mundo inválido.');
    if (rule[0] === 'seed' && (typeof v !== 'string' || v.length > 64 || /[\r\n\x00]/.test(v))) throw Error('Seed inválida.');
    result[k] = String(v);
  } return result;
}
export function readProperties() { return parseProperties(fs.readFileSync(safePath(SERVER, 'server.properties'), 'utf8')); }
export function writeProperties(input, running) {
  const changes = validateProperties(input); const before = readProperties();
  for (const k of ['level-name', 'level-seed']) if (k in changes && changes[k] !== before[k] && running) throw Error('Detén Paper antes de cambiar el mundo o la seed.');
  if ('level-name' in changes && changes['level-name'] !== before['level-name'] && fs.existsSync(safePath(SERVER, changes['level-name']))) throw Error('Ese mundo ya existe: utiliza restauración para recuperarlo.');
  const changed = Object.keys(changes).filter(k => changes[k] !== before[k]);
  const values = { ...before, ...changes, 'online-mode': 'true', 'white-list': 'true', 'enforce-whitelist': 'true', 'enable-rcon': 'false', 'management-server-enabled':'false' };
  // Desde 1.21.9 estos controles son gamerules; el panel conserva sus preferencias en JSON.
  for (const key of ['pvp','enable-command-block','allow-nether']) delete values[key];
  atomicWrite(path.join(SERVER, 'server.properties'), serializeProperties(values));
  audit('configuración modificada', changed.join(', ')); return changed;
}
export function processAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
export function acquireLock(file, pid = process.pid) {
  safePath(ROOT, path.relative(ROOT, file));
  if (fs.existsSync(file)) {
    let owner; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('Lock corrupto. Revisión manual necesaria.'); }
    if (!Number.isInteger(owner.pid) || processAlive(owner.pid)) throw Error('Ya existe una instancia activa o un proceso que necesita revisión.');
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify({ pid, time: new Date().toISOString() }), { flag: 'wx' });
}
export function treeInfo(folder) {
  if (!fs.existsSync(folder)) return { bytes: 0, modified: null };
  safePath(ROOT, path.relative(ROOT, folder)); let bytes = 0, modified = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = safePath(folder, entry.name); const stat = fs.statSync(file);
    if (entry.isDirectory()) { const info = treeInfo(file); bytes += info.bytes; modified = Math.max(modified, Date.parse(info.modified) || 0); }
    else { bytes += stat.size; modified = Math.max(modified, stat.mtimeMs); }
  } return { bytes, modified: modified ? new Date(modified).toISOString() : null };
}
export function worldStorage(name) {
  validateProperties({'level-name':name});
  const modern=fs.existsSync(safePath(SERVER,name,'dimensions'));
  const worlds=['overworld','the_nether','the_end'].map((dimension,i)=>{
    const relative=modern?`${name}/dimensions/minecraft/${dimension}`:[name,name+'_nether',name+'_the_end'][i];
    const folder=safePath(SERVER,relative);
    return {name:modern?`minecraft:${dimension}`:relative,path:relative,...treeInfo(folder),exists:fs.existsSync(folder)};
  });
  const roots=[name,name+'_nether',name+'_the_end'].filter(w=>fs.existsSync(safePath(SERVER,w)));
  return {worlds,worldBytes:roots.reduce((n,w)=>n+treeInfo(safePath(SERVER,w)).bytes,0)};
}
