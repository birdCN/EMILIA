import fs from 'node:fs';import {spawnSync} from 'node:child_process';
fs.mkdirSync('work',{recursive:true});
for(const root of ['.','public'])for(const name of fs.readdirSync(root))if(/\.(mjs|js)$/.test(name)){const r=spawnSync(process.execPath,['--check',root+'/'+name],{stdio:'inherit',windowsHide:true});if(r.status)process.exit(r.status||1);}
for(const name of fs.readdirSync('tests').filter(n=>n.endsWith('.mjs')).sort()){const r=spawnSync(process.execPath,['tests/'+name],{stdio:'inherit',windowsHide:true});if(r.status)process.exit(r.status||1);}
console.log('All offline checks passed; no model provider calls were made.');
