import {startPlayit,playitRequest,playitStatus,runningAgents} from '../panel/backend/playit.js';
const action=process.argv[2];
if(action==='start')console.log(await startPlayit());
else if(action==='stop'){for(const agent of await runningAgents())await playitRequest('stop',agent.pipe);console.log('Apagado de Playit solicitado.');}
else if(action==='status')console.log(JSON.stringify(await playitStatus(),null,2));
else throw Error('Usa start, stop o status.');
