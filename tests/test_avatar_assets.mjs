import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {faceLibrary} from '../public/assets/emilia-face-library.js';

const publicRoot=new URL('../public/',import.meta.url);
const index=await readFile(new URL('index.html',publicRoot),'utf8');
assert.match(index,/src="\/assets\/emilia-performance-v4\.runtime\.html\?v=22"/);
assert.match(index,/class="room-backdrop"[^>]+emilia-bedroom-v1\.webp/);
const html=await readFile(new URL('assets/emilia-performance-v4.runtime.html',publicRoot),'utf8');
const renderer=await readFile(new URL('assets/emilia-performance-v4.js',publicRoot),'utf8');
const resources=new Set(['avatar-director.js','assets/emilia-performance-v4.runtime.html','assets/emilia-performance-v4.js','assets/emilia-face-library.js','assets/room/emilia-bedroom-v1.webp']);
for(const text of [html,renderer])for(const match of text.matchAll(/["']\/(assets\/[^"'`?\s]+)(?:\?[^"']*)?["']/g))resources.add(match[1]);
for(const {file}of Object.values(faceLibrary))resources.add(`assets/avatar-v3/${file}-v3.png`);
let bytes=0;
for(const resource of resources){
  const content=await readFile(new URL(resource,publicRoot));bytes+=content.length;
  assert.ok(content.length>100,`Missing or empty avatar resource: ${resource}`);
  if(resource.endsWith('.png')){
    assert.equal(content.subarray(0,8).toString('hex'),'89504e470d0a1a0a',resource);
    assert.ok(content.readUInt32BE(16)>600&&content.readUInt32BE(20)>1000,`Invalid portrait dimensions: ${resource}`);
  }
  if(resource.endsWith('.webp')){assert.equal(content.subarray(0,4).toString(),'RIFF');assert.equal(content.subarray(8,12).toString(),'WEBP');}
}
assert.ok(resources.has('assets/avatar-v3/neutral-v3.png'),'Renderer neutral fallback must ship');
assert.ok(resources.has('assets/avatar-v3/neutral-clean-v4.png'),'HTML neutral fallback must ship');
console.log(JSON.stringify({ok:true,avatarDependencyResources:resources.size,bytes,publicRoot:fileURLToPath(publicRoot)}));
