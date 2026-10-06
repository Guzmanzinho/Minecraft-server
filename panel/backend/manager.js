import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import pidusage from 'pidusage';
import { ROOT, SERVER, safePath, acquireLock, audit, readProperties, processAlive } from './core.js';
export const JAVA = 'C:\\Program Files\\Eclipse Adoptium\\jdk-25.0.3.9-hotspot\\bin\\java.exe';
export function portAvailable(port) { return new Promise(resolve => { const probe = net.createServer(); probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); }); }
export class Manager extends EventEmitter {
  constructor(config, persist) { super(); this.config = config; this.persist = persist; this.child = null; this.state = 'offline'; this.logs = []; this.sequence = 0; this.players = []; this.started = null; this.tps = null; this.mspt = null; this.metrics = null; this.samples = []; this.busy = null; this.lock = path.join(ROOT, 'config/paper.lock'); }
  unmanaged() { if (!this.child && fs.existsSync(this.lock)) { try { return processAlive(JSON.parse(fs.readFileSync(this.lock)).pid); } catch { return true; } } return false; }
  log(line) {
    line = line.replace(/\x1b\[[0-9;]*m/g, ''); const entry = { id: ++this.sequence, time: new Date().toISOString(), text: line };
    this.logs.push(entry); if (this.logs.length > 1500) this.logs.shift(); this.emit('line', line);
    if (/Done \([\d.,]+s\)!/.test(line) && this.state !== 'online') { this.state = 'online'; if(this.child){this.applyWorldSettings().catch(e=>{this.warning='Paper no confirmó PvP/bloques de comandos. Revisa Consola antes de jugar.';this.config.restartRequired=true;this.persist();audit('reglas pendientes',e.message);this.log(this.warning);});}else{this.config.restartRequired=false;this.persist();} audit('servidor preparado'); }
    const list = line.match(/There are \d+ of a max of \d+ players online:\s*(.*)/); if (list) this.players = list[1].split(',').map(x => x.trim()).filter(Boolean);
    const joined = line.match(/: ([A-Za-z0-9_]{1,16}) joined the game/); if (joined && !this.players.includes(joined[1])) this.players.push(joined[1]);
    const left = line.match(/: ([A-Za-z0-9_]{1,16}) left the game/); if (left) this.players = this.players.filter(x => x !== left[1]);
    if (/TPS from last/.test(line)) { const values = line.split(':').at(-1).match(/\d+(?:[.,]\d+)?/g); if (values?.length >= 3) this.tps = { values: values.slice(0,3).map(v=>Number(v.replace(',','.'))), at: entry.time }; }
  }
  raw(command) { if (!this.child || !['online', 'stopping'].includes(this.state)) throw Error('Paper todavía no está preparado.'); this.child.stdin.write(command + '\n'); }
  async applyWorldSettings() {
    this.busy='aplicando reglas'; this.warning=null;
    try{
      for(const dimension of ['minecraft:overworld','minecraft:the_nether','minecraft:the_end']) {
        await this.confirmed(`execute in ${dimension} run gamerule minecraft:pvp ${this.config.pvp}`,/Game\s?rule.*now set to|Game rule.*updated/i,15000);
        await this.confirmed(`execute in ${dimension} run gamerule minecraft:command_blocks_work ${this.config.commandBlocks}`,/Game\s?rule.*now set to|Game rule.*updated/i,15000);
      }
      this.config.restartRequired=false;this.persist();audit('reglas de mundo aplicadas','PvP y bloques de comandos en las tres dimensiones');
    }finally{this.busy=null;}
  }
  async start(internal=false) {
    if(this.hardcoreLocked&&!internal)throw Error('Reset Hardcore pendiente: revisa Hardcore antes de iniciar Paper.');
    if (this.busy || this.child || this.state !== 'offline' || this.unmanaged()) throw Error('Paper está activo o hay una operación en curso.');
    this.state = 'starting';
    try {
      const eulaFile=safePath(SERVER,'eula.txt');const eula = fs.existsSync(eulaFile)?fs.readFileSync(eulaFile, 'utf8'):''; if (!/^eula=true\s*$/m.test(eula)) throw Error('Debes leer el EULA y cambiar personalmente eula=false a eula=true en server/eula.txt.');
      const p = readProperties(); if (p['online-mode'] !== 'true' || p['white-list'] !== 'true' || p['enable-rcon'] !== 'false') throw Error('Configuración de seguridad alterada. Revisa online-mode, whitelist y RCON.');
      if (!await portAvailable(Number(p['server-port']))) throw Error('El puerto de Minecraft ya está ocupado.');
      if (!fs.existsSync(safePath(SERVER, 'server.jar'))) throw Error('No se encuentra server.jar.');
      acquireLock(this.lock);
      const child = spawn(JAVA, [`-Xms${this.config.ramMin}G`, `-Xmx${this.config.ramMax}G`, '-jar', 'server.jar', '--nogui'], { cwd: SERVER, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      this.child = child; this.started = Date.now(); this.activeRam = { min: this.config.ramMin, max: this.config.ramMax }; this.activePort = Number(p['server-port']);
      child.once('spawn', () => fs.writeFileSync(this.lock, JSON.stringify({ pid: child.pid, time: new Date().toISOString() })));
      for (const stream of [child.stdout, child.stderr]) { let pending = ''; stream.setEncoding('utf8'); stream.on('data', data => { pending += data; const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const line of lines) this.log(line); }); stream.on('end', () => { if (pending) this.log(pending); }); }
      child.stdin.on('error', e => this.log('Error de consola: ' + e.message));
      child.once('error', e => { this.log('Java no pudo iniciar: ' + e.message); });
      child.once('close', code => { this.child = null; this.state = 'offline'; this.started = null; this.metrics = null; this.tps = null; this.players = []; if (fs.existsSync(this.lock)) fs.unlinkSync(this.lock); this.log('Paper finalizado. Código: ' + code); audit('servidor finalizado', String(code)); this.emit('stopped'); });
      audit('servidor iniciado'); return 'Inicio solicitado. Consulta la consola hasta ONLINE.';
    } catch (e) { this.state = 'offline'; if (!this.child && fs.existsSync(this.lock)) { try { if (JSON.parse(fs.readFileSync(this.lock)).pid === process.pid) fs.unlinkSync(this.lock); } catch {} } throw e; }
  }
  async stop(internal=false) {
    if(this.hardcoreLocked&&!internal)throw Error('Reset Hardcore en curso.');
    if (this.busy) throw Error('Espera a que finalice el backup o restauración.');
    if (this.state !== 'online') throw Error('Espera a que Paper esté ONLINE para detenerlo correctamente.');
    this.state = 'stopping'; this.raw('stop'); audit('detención solicitada');
    await new Promise((resolve, reject) => { const done = () => { clearTimeout(timer); resolve(); }; const timer = setTimeout(() => { this.off('stopped', done); reject(Error('Paper tarda en detenerse. No se ha forzado el cierre.')); }, 90000); this.once('stopped', done); });
    return 'Servidor detenido y mundo guardado.';
  }
  async restart() { await this.stop(); return this.start(); }
  force(confirm) { if (confirm !== 'FORZAR' || !this.child || this.busy) throw Error('Confirmación FORZAR necesaria, sin backups activos.'); audit('terminación forzada'); this.child.kill('SIGKILL'); return 'Cierre forzado solicitado. El mundo puede necesitar recuperación.'; }
  async confirmed(command, pattern, timeout = 30000) {
    return new Promise((resolve, reject) => { const listener = line => { if (pattern.test(line)) { clearTimeout(timer); this.off('line', listener); resolve(); } }; const timer = setTimeout(() => { this.off('line', listener); reject(Error('Paper no confirmó el guardado; operación cancelada.')); }, timeout); this.on('line', listener); try { this.raw(command); } catch(e) { clearTimeout(timer); this.off('line', listener); reject(e); } });
  }
  async sample() {
    if (this.child?.pid) try { const stat = await pidusage(this.child.pid); this.metrics = { cpu: stat.cpu, memory: stat.memory, at: new Date().toISOString() }; this.samples.push(this.metrics); if (this.samples.length > 120) this.samples.shift(); } catch { this.metrics = null; }
    if (this.state === 'online' && !this.busy) { this.raw('list'); this.raw('tps'); }
  }
  status() { return { state: this.unmanaged() ? 'unmanaged' : this.state, warning:this.warning||null, busy: this.busy, uptime: this.started ? Date.now()-this.started : 0, players: this.players, metrics: this.metrics, samples: this.samples, tps: this.tps, mspt: this.mspt, activeRam: this.activeRam || null, activePort: this.child ? this.activePort : null, pid: this.child?.pid || null }; }
}
export function validateCommand(input) {
  if (typeof input !== 'string' || input.length > 240 || /[\r\n\x00-\x1f]/.test(input)) throw Error('Comando inválido.');
  const command = input.trim().replace(/^\//, '');
  const patterns = [ /^say [^\r\n]{1,200}$/, /^time set (day|night|noon|midnight|\d{1,6})$/, /^weather (clear|rain|thunder)( \d{1,6})?$/, /^gamemode (survival|creative|adventure|spectator) [A-Za-z0-9_]{1,16}$/, /^(list|tps|mspt|seed|difficulty|defaultgamemode|save-all(?: flush)?)$/, /^whitelist (list|on)$/, /^whitelist (add|remove) [A-Za-z0-9_]{1,16}$/, /^(?:execute in minecraft:(?:overworld|the_nether|the_end) run )?gamerule minecraft:(?:pvp|command_blocks_work|allow_entering_nether_using_portals)$/ ];
  if (!patterns.some(p => p.test(command))) throw Error('Comando no permitido. Usa Jugadores para OP, bans y kick, y los botones para detener.'); return command;
}
