/** Reproducible byte comparison against the recorded canonical snapshot. */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root=new URL('../skills/',import.meta.url);
const sourceIndex=process.argv.indexOf('--source');
const source=sourceIndex<0?null:process.argv[sourceIndex+1];
if(sourceIndex>=0&&!source)throw new Error('--source needs the canonical sibling skill root');
const manifest=JSON.parse(await readFile(new URL('SNAPSHOT.json',root),'utf8'));
let count=0;
for(const [path,expected] of Object.entries(manifest.files)){
  const bytes=await readFile(new URL(path,root));
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error(`snapshot drift: ${path}`);
  if(source){const canonical=await readFile(join(source,path));if(!bytes.equals(canonical))throw new Error(`canonical source drift: ${path}`);}
  count++;
}
async function scan(dir,prefix=''){
  for(const item of await readdir(dir,{withFileTypes:true})){
    const path=prefix+item.name;
    if(item.name==='.DS_Store'||item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;
    if(item.isDirectory())await scan(new URL(item.name+'/',dir),path+'/');
    else if(!manifest.files[path])throw new Error(`unrecorded skill resource: ${path}`);
  }
}
for(const name of ['sectioned-feature-development','code-review'])await scan(new URL(name+'/',root),name+'/');
console.log(`Verified ${count} canonical skill files (${manifest.version}).`);
