import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPlayitState,playitRequest} from '../backend/playit.js';
const lifecycle=(tunnels)=>({state:'running',data:{tunnels,login_link:'private',agent_id:'private'}});
const tunnel={destination:'127.0.0.1:25565',display_address:'test.example:12345',is_disabled:false};
test('Playit solo publica un túnel Minecraft exacto y nunca datos de cuenta',()=>{
  const result=publicPlayitState(lifecycle([tunnel]));assert.equal(result.connected,true);assert.equal(result.address,tunnel.display_address);
  assert.equal(result.target,'127.0.0.1:25565');assert.equal('login_link' in result,false);assert.equal('agent_id' in result,false);
});
test('Playit rechaza panel, otros destinos, múltiples túneles y túneles desactivados',()=>{
  for(const tunnels of [[],[{...tunnel,destination:'127.0.0.1:3000'}],[tunnel,{...tunnel,destination:'127.0.0.1:3000'}],[{...tunnel,is_disabled:true}]]){
    const result=publicPlayitState(lifecycle(tunnels));assert.equal(result.connected,false);assert.equal(result.address,null);
  }
});
test('Playit distingue pendiente y desconectado sin inventar dirección',()=>{
  for(const state of ['waiting_for_secret','starting','error','stopping']){const result=publicPlayitState({state});assert.equal(result.connected,false);assert.equal(result.address,null);}
});
test('Playit conserva la distinción entre credencial guardada, conexión y túnel',()=>{
  const offline=publicPlayitState(null,{},true);assert.equal(offline.agentState,'linked_disconnected');assert.equal(offline.linked,true);assert.equal(offline.authenticated,false);
  const unlinked=publicPlayitState({state:'waiting_for_secret'},{has_secret:false});assert.equal(unlinked.agentState,'unlinked');
  const noTunnel=publicPlayitState(lifecycle([]),{has_secret:true});assert.equal(noTunnel.agentState,'connected');assert.equal(noTunnel.tunnelState,'not_configured');assert.equal(noTunnel.authenticated,true);
  const active=publicPlayitState(lifecycle([tunnel]));assert.equal(active.tunnelState,'active');
  const invalid=publicPlayitState({state:'has_invalid_secret'},{has_secret:true});assert.equal(invalid.agentState,'invalid_secret');assert.equal(invalid.authenticated,false);
});
test('Playit no acepta operaciones de cuenta ni creación de túneles',()=>{
  for(const command of ['set_secret','get_account_login_url','reset_secret','create_tunnel'])assert.throws(()=>playitRequest(command));
  assert.equal(publicPlayitState(lifecycle([{...tunnel,display_address:'<script>'}])).connected,false);
});
