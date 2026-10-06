import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const v=JSON.parse(fs.readFileSync(path.join(root,'config/versions.json'),'utf8').replace(/^\uFEFF/,''));
const hash=(file,alg)=>crypto.createHash(alg).update(fs.readFileSync(path.join(root,file))).digest('hex');
const binaries=['server/server.jar','client/fabric-installer.jar',...v.mods.map(m=>'client/mods/'+m.filename),'client/shaderpacks/'+v.shader.filename];
test('inventario 26.2: Paper estable y todos los binarios coinciden con hashes originales',{skip:binaries.some(f=>!fs.existsSync(path.join(root,f)))?'Descarga las dependencias oficiales para verificar sus binarios':false},()=>{
 assert.equal(v.minecraft,'26.2');assert.equal(v.paperChannel,'STABLE');assert.equal(hash('server/server.jar','sha256'),v.paperSHA256);
 assert.equal(v.fabricLoaderStable,true);
 for(const m of [...v.mods,v.shader]){assert.equal(m.type,'release');assert.ok(m.gameVersions.includes('26.2'));assert.equal(hash((m===v.shader?'client/shaderpacks/':'client/mods/')+m.filename,'sha512'),m.sha512);}
 assert.equal(hash('client/fabric-installer.jar','sha256'),v.fabricInstallerSHA256);
});
test('Iris y Sodium: respeta la dependencia exacta de la release original',()=>{
 const iris=v.mods.find(m=>m.project==='iris'),sodium=v.mods.find(m=>m.project==='sodium');
 const dependency=iris.dependencies.find(d=>d.project_id==='AANobbMI'&&d.dependency_type==='required');assert.equal(dependency.version_id,sodium.id);
 const previous=['xaeroworldmap-fabric-1.21.11-1.46.0.jar','xaerominimap-fabric-1.21.11-26.5.0.jar','sodium-fabric-0.8.14+mc1.21.11.jar','iris-fabric-1.10.8+mc1.21.11.jar','fabric-api-0.141.6+1.21.11.jar'];
 for(const filename of previous)assert.equal(fs.existsSync(path.join(root,'client/mods',filename)),false);
});
