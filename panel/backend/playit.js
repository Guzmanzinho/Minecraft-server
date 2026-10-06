import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from './core.js';
export const PLAYIT_DIR=path.join(ROOT,'tools/playit');
export const PLAYIT_PIPE='\\\\.\\pipe\\MinecraftServer-Playit';
export const PLAYIT_SYSTEM_PIPE='\\\\.\\pipe\\playitd-system';
export const PLAYIT_SECRET=path.join(process.env.ProgramData||'C:/ProgramData','playit_gg/playit.toml');
export const PLAYIT_TARGET='127.0.0.1:25565';
// Official Playit IPC v2: JSON lines over a local Windows named pipe.
// Never request login links, secrets, account data or tunnel creation.
export function playitRequest(type,pipe=PLAYIT_PIPE){
  if(!['get_state','get_status','stop'].includes(type))throw Error('Operación Playit no permitida.');
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(pipe);let buffer='',done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error('Playit no responde.')),1500);
    socket.on('error',e=>finish(e));
    socket.on('connect',()=>socket.write(JSON.stringify({ipc_version:2,request_id:1,request:{type}})+'\n'));
    socket.on('data',data=>{
      buffer+=data.toString();if(buffer.length>1024*1024)return finish(Error('Respuesta Playit demasiado grande.'));
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try{const msg=JSON.parse(line);if(msg.message_kind==='response'&&msg.data.request_id===1){const response=msg.data.response;if(response.type==='error')finish(Error('Playit rechazó la consulta.'));else finish(null,response.data);}}catch(e){finish(e);}
      }
    });
  });
}
export function credentialPresent(){
  try{const text=fs.readFileSync(PLAYIT_SECRET,'utf8').trim();const secret=text.match(/secret_key\s*=\s*"([a-fA-F0-9]+)"/)?.[1]||text;return /^[a-fA-F0-9]{32,}$/.test(secret)&&secret.length%2===0;}catch{return false;}
}
export function publicPlayitState(lifecycle,status={},stored=false){
  const linked=lifecycle?.state==='running'||status.has_secret===true||stored;
  const agentState=lifecycle?.state==='running'?'connected':lifecycle?.state==='waiting_for_secret'?'unlinked':lifecycle?.state==='has_invalid_secret'?'invalid_secret':linked?'linked_disconnected':'unknown';
  const base={connected:false,linked,authenticated:lifecycle?.state==='running',agentState,tunnelState:'unknown',state:lifecycle?.state||'disconnected',address:null,target:PLAYIT_TARGET};
  if(lifecycle?.state!=='running')return base;
  const tunnels=lifecycle.data?.tunnels||[];
  if(tunnels.length!==1||tunnels[0].destination!==PLAYIT_TARGET||tunnels[0].is_disabled){
    return {...base,state:'configuration_required',tunnelState:tunnels.length===0?'not_configured':'inactive',warning:'Se requiere un único túnel activo hacia 127.0.0.1:25565.'};
  }
  const address=tunnels[0].display_address;
  if(typeof address!=='string'||address.length>253||!/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(address))return {...base,state:'configuration_required'};
  return {...base,connected:true,state:'connected',tunnelState:'active',address};
}
export async function runningAgents(){
  const result=[];
  for(const pipe of [PLAYIT_PIPE,PLAYIT_SYSTEM_PIPE]){
    try{result.push({pipe,status:await playitRequest('get_status',pipe),lifecycle:await playitRequest('get_state',pipe)});}
    catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;}
  }
  return result;
}
export async function playitStatus(){
  const stored=credentialPresent();
  try{const agents=await runningAgents();const agent=agents.find(a=>a.lifecycle.state==='running')||agents[0];return publicPlayitState(agent?.lifecycle,agent?.status,stored);}
  catch{return {...publicPlayitState(null,{},stored),state:'read_error',agentState:'unknown',warning:'No se pudo leer el estado de Playit. Esto no significa que falte la vinculación.'};}
}
export async function startPlayit(){
  const agents=await runningAgents();
  const linked=agents.find(a=>a.status.has_secret&&a.lifecycle.state!=='has_invalid_secret');
  if(agents.filter(a=>a.status.has_secret).length>1)throw Error('Hay múltiples agentes autenticados; no se inicia otra instancia.');
  if(linked){if(path.resolve(linked.status.secret_path)!==path.resolve(PLAYIT_SECRET))throw Error('El agente activo usa otra ruta de credencial; no se crea otra instancia.');return `Playit ${linked.status.version} ya está ejecutándose con credencial persistente.`;}
  if(!credentialPresent())throw Error(`Falta una credencial persistente válida en ${PLAYIT_SECRET}. Ejecuta setup oficial manualmente; el arranque no genera claims.`);
  // A stale unlinked daemon used a different, missing secret. Close it through
  // official IPC before launching the same agent identity from the saved secret.
  for(const agent of agents){await playitRequest('stop',agent.pipe);for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,250));try{await playitRequest('get_status',agent.pipe);}catch(e){if(e.code==='ENOENT')break;throw e;}if(n===39)throw Error('Playit anterior no terminó; no se inicia otra instancia.');}}
  const installed=path.join(process.env.ProgramFiles||'C:/Program Files','playit_gg/bin/playitd.exe');
  const exe=fs.existsSync(installed)?installed:path.join(PLAYIT_DIR,'playit.exe');
  if(!fs.existsSync(exe))throw Error('Falta el agente oficial Playit.');
  const child=spawn(exe,['--secret-path',PLAYIT_SECRET,'--socket-path',PLAYIT_PIPE,'--log-path',path.join(PLAYIT_DIR,'private/agent.log')],{cwd:PLAYIT_DIR,windowsHide:true,detached:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();
  for(let n=0;n<120;n++){await new Promise(r=>setTimeout(r,500));try{const s=await playitRequest('get_status');if(!s.has_secret)throw Error('Playit no cargó la credencial persistente.');if(s.phase==='running')return `Playit ${s.version}: autenticado automáticamente (${PLAYIT_SECRET}).`;if(['has_invalid_secret','error'].includes(s.phase))throw Error('Playit rechazó la credencial; no se genera otro claim.');}catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;}}
  throw Error('Playit cargó la credencial pero no conectó en 60 segundos. Revisa la red; no se genera otro claim ni agente.');
}
