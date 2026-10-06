// Explicit integration test. Never invoked by npm test; destructive operations use a private fixture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {ROOT,parseProperties,serializeProperties} from '../backend/core.js';
if(process.env.HARDCORE_LIVE_FIXTURE!=='YES')throw Error('Requires explicit HARDCORE_LIVE_FIXTURE=YES; temporarily pauses the real server.');
const base='http://127.0.0.1:3000',fixture=path.join(ROOT,'panel/tests/.tmp-hardcore-live-'+crypto.randomUUID());
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let token,child,fixtureActive=false;const results=[];
async function get(route){const r=await fetch(base+route);if(!r.ok)throw Error(await r.text());return r.json();}
async function session(){token=(await get('/api/session')).token;}
async function post(route,body={}){const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-panel-token':token},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
async function wait(check,label,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(500);}throw Error('Timeout: '+label);}
function launch(root){const logs=path.join(root,'panel/logs');fs.mkdirSync(logs,{recursive:true});return spawn(process.execPath,[path.join(root,'panel/backend/app.js')],{cwd:path.join(root,'panel'),windowsHide:true,stdio:['ignore',fs.openSync(path.join(logs,'service-out.log'),'a'),fs.openSync(path.join(logs,'service-error.log'),'a')]});}
async function stopPanel(){const s=await get('/api/status');if(s.state==='online'){await post('/api/server/stop',{confirm:true});}await wait(async()=> (await get('/api/status')).state==='offline','Java exit');await post('/api/server/shutdown');await wait(async()=>{try{await get('/api/status');return false;}catch{return true;}},'panel exit');}
async function online(){await wait(async()=>{const s=await get('/api/status');return s.state==='online'&&!s.busy;},'ONLINE');}
const before=await get('/api/status');assert.equal(before.players.length,0,'Do not interrupt active players');assert.equal(before.properties['level-name'],'acere');
const personal=Object.fromEntries(['whitelist.json','banned-players.json','banned-ips.json'].map(name=>[name,fs.readFileSync(path.join(ROOT,'server',name),'utf8')]));
fs.mkdirSync(fixture,{recursive:true});
for(const directory of ['config','panel/backend','panel/frontend','panel/logs','server/plugins','server/backups'])fs.mkdirSync(path.join(fixture,directory),{recursive:true});
fs.cpSync(path.join(ROOT,'panel/backend'),path.join(fixture,'panel/backend'),{recursive:true});
fs.copyFileSync(path.join(ROOT,'panel/package.json'),path.join(fixture,'panel/package.json'));
for(const name of ['server.jar','eula.txt'])fs.copyFileSync(path.join(ROOT,'server',name),path.join(fixture,'server',name));
for(const name of ['libraries','versions','cache'])fs.cpSync(path.join(ROOT,'server',name),path.join(fixture,'server',name),{recursive:true});
fs.copyFileSync(path.join(ROOT,'server/plugins/hardcore-reset-1.0.0.jar'),path.join(fixture,'server/plugins/hardcore-reset-1.0.0.jar'));
fs.writeFileSync(path.join(fixture,'config/panel-config.json'),JSON.stringify({...before.config,ramMin:1,ramMax:2,backupsEnabled:false,nextBackup:null,hardcoreCountdown:5,hardcoreSeedMode:'random',hardcoreArchive:true}));
fs.writeFileSync(path.join(fixture,'server/server.properties'),serializeProperties({...before.properties,'level-name':'trial','level-seed':'1234567890123456789','server-ip':'127.0.0.1',hardcore:'true',difficulty:'hard',gamemode:'survival'}));
fs.writeFileSync(path.join(fixture,'server/whitelist.json'),'[]');
console.log('Fixture prepared: '+fixture);
try{
  await stopPanel();child=launch(fixture);fixtureActive=true;
  await wait(async()=>{try{await session();return true;}catch{return false;}},'fixture panel');
  await post('/api/server/start');await online();
  const initial=await get('/api/hardcore');assert.equal(initial.current.protected,true);assert.equal(initial.hardcore,true);
  fs.mkdirSync(path.join(fixture,'server/trial/players'),{recursive:true});fs.writeFileSync(path.join(fixture,'server/trial/players/old-run-marker'),'fixture-only');
  const whitelist=fs.readFileSync(path.join(fixture,'server/whitelist.json'),'utf8');
  await post('/api/hardcore/reset',{confirm:'REINICIAR RUN'});
  await wait(async()=>{const h=await get('/api/hardcore');if(h.phase==='failed')throw Error(h.error);return h.phase==='idle'&&h.sequence===1;},'random reset complete');
  const first=await get('/api/hardcore');assert.notEqual(first.current.seed,initial.current.seed);assert.equal(first.current.protected,false);
  assert(!fs.existsSync(path.join(fixture,'server/trial/players/old-run-marker')));
  assert.equal(fs.readFileSync(path.join(fixture,'server/whitelist.json'),'utf8'),whitelist);
  assert(fs.existsSync(path.join(fixture,'runs',first.history[0].archive)));
  for(const dim of ['overworld','the_nether','the_end'])assert(fs.existsSync(path.join(fixture,'server/trial/dimensions/minecraft',dim)));
  results.push({test:'Real online reset, safe final archive, random seed, clean playerdata, three dimensions, whitelist preserved',passed:true,seed:first.current.seed,archive:first.history[0].archive});console.log('Random + archive: PASS');
  await post('/api/hardcore/config',{hardcoreSeedMode:'same',hardcoreArchive:false});
  await post('/api/hardcore/reset',{confirm:'REINICIAR RUN'});
  await wait(async()=>{const h=await get('/api/hardcore');if(h.phase==='failed')throw Error(h.error);return h.phase==='idle'&&h.sequence===2;},'same reset complete');
  const second=await get('/api/hardcore');assert.equal(second.current.seed,first.current.seed);assert.equal(second.history[1].archive,undefined);assert.equal(fs.readdirSync(path.join(fixture,'runs')).filter(n=>n.endsWith('.zip')).length,1);
  results.push({test:'Real online reset with exact 64-bit seed reused and final archive disabled',passed:true,seed:second.current.seed});console.log('Same + archive OFF: PASS');
  await post('/api/server/restart',{confirm:true});await online();const restarted=await get('/api/hardcore');assert.equal(restarted.current.id,second.current.id);assert.equal(restarted.current.seed,second.current.seed);assert.equal(restarted.sequence,2);
  results.push({test:'Normal Paper restart preserves world and run identity',passed:true});console.log('Normal restart: PASS');
}catch(e){results.push({passed:false,error:e.message});console.error(e);process.exitCode=1;}
finally{
  if(fixtureActive){await session();const h=await get('/api/hardcore');if(h.phase==='failed')await post('/api/hardcore/recover',{confirm:'RECUPERAR'});await stopPanel();await wait(()=>child.exitCode!==null,'fixture process exit');}
  launch(ROOT);await wait(async()=>{try{await session();return true;}catch{return false;}},'real panel');
  if(before.state==='online'){await post('/api/server/start');await online();}
  for(const [name,value] of Object.entries(personal))assert.equal(fs.readFileSync(path.join(ROOT,'server',name),'utf8'),value);
  assert(fs.existsSync(path.join(ROOT,'server/acere/level.dat')));assert.equal((await get('/api/hardcore')).sequence,0);assert.equal((await get('/api/hardcore')).current.protected,true);
  const report={at:new Date().toISOString(),fixture,results,realWorld:'acere preserved; zero real resets; protected',realServer:(await get('/api/status')).state};
  fs.mkdirSync(path.join(ROOT,'docs'),{recursive:true});fs.writeFileSync(path.join(ROOT,'docs/hardcore-live-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
