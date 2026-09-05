import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {once} from 'node:events';import {DatabaseSync} from 'node:sqlite';
const root=await mkdtemp(path.join(os.tmpdir(),'codex-workspace-http-'));
const project=path.join(root,'project');await mkdir(path.join(project,'files'),{recursive:true});
for(const [name,content] of [['note.md','# hello'],['page.html','<h1>Hello</h1><script>parent.bad=true</script>'],['clip.mp4','0123456789'],['report.pdf','%PDF-1.4'],['code.ts','const x=1;'],['scene.blend','BLENDER'],['theme.css','h1{color:red}'],['app.mjs','document.body.dataset.ready=1']])await writeFile(path.join(project,'files',name),content);
await writeFile(path.join(project,'outside.md'),'out');
const id='11111111-1111-4111-8111-111111111111';const db=new DatabaseSync(path.join(root,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,project_id TEXT);CREATE TABLE projects(id TEXT,name TEXT);CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT)');db.prepare('INSERT INTO threads VALUES(?,?,?)').run(id,project,null);db.close();
await writeFile(path.join(root,'config.json'),JSON.stringify({enabled:true,projects:[{id:'p',name:'P',path:project,scanRoots:['files']}],automation:{inbox:{enabled:false},routing:{enabled:false}},deduplication:{enabled:false},storage:{generatedRoot:path.join(root,'generated')}}));
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const token='test-workspace-token-12345678901234567890';
const paths={ASSET_BROWSER_CONFIG:'config.json',ASSET_BROWSER_LEDGER:'ledger.json',GENERATION_TICKETS:'tickets.json',GENERATION_THREAD_BINDINGS:'bindings.json',DUPLICATE_CLEANUP_LEDGER:'duplicates.json',DUPLICATE_QUARANTINE:'quarantine',RHYTHM_CONTROL_REGISTRY:'rhythm.json',PROMPT_LIBRARY_ROOT:'prompts',THREE_D_TASKS:'3d.json',ASSET_ACTION_TRASH:'trash',CODEX_WORKSPACE_GOVERNANCE:'governance',MIDJOURNEY_WORKSPACE_REGISTRY:'mj.json',MIDJOURNEY_DOWNLOADS:'downloads'};
const child=spawn(process.execPath,['server.js'],{cwd:path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/,'$1')),windowsHide:true,env:{...process.env,...Object.fromEntries(Object.entries(paths).map(([key,value])=>[key,path.join(root,value)])),ASSET_BROWSER_API_TOKEN:token,PORT:String(port),CODEX_HOME:root},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
const base=`http://127.0.0.1:${port}`;const headers={"x-asset-console-token":token};
const get=async url=>{const response=await fetch(base+url,{headers});assert.equal(response.status,200,await response.clone().text());return response.json();};
try {
 for(let i=0;i<80;i++){try{await get('/api/projects');break;}catch{if(i===79)throw Error(logs);await new Promise(r=>setTimeout(r,100));}}
 const consolePage=await fetch(base+'/',{headers});assert.equal(consolePage.status,200);assert.equal(consolePage.headers.get('content-security-policy'),null);
 const ws=await get(`/api/codex/workspace?threadId=${id}`);assert.equal(ws.project.id,'p');assert.equal(ws.source,'cwd');
 const {assets}=await get('/api/assets?project=p&case=__all__');assert.equal(assets.length,8);assert(assets.every(a=>a.absolutePath.startsWith(project)));assert(!assets.some(a=>a.name==='outside.md'));
 const text=await get('/api/preview?project=p&path=files%2Fnote.md');assert.equal(text.text,'# hello');
 const html=await fetch(base+'/media?project=p&path=files%2Fpage.html',{headers});assert.match(html.headers.get('content-security-policy'),/^sandbox;/);
 const page=assets.find(a=>a.type==='html');const pageResponse=await fetch(base+page.htmlUrl,{headers});assert.match(pageResponse.headers.get('content-security-policy'),/^sandbox allow-scripts;/);assert.match(pageResponse.headers.get('content-security-policy'),/connect-src [^;]+\/api\/project-file\/p\//);
 const cssUrl=new URL('theme.css',base+page.htmlUrl);const css=await fetch(cssUrl,{headers});assert.equal(css.status,200);assert.equal(await css.text(),'h1{color:red}');
 const js=await fetch(new URL('app.mjs',base+page.htmlUrl),{headers});assert.match(js.headers.get('content-type'),/javascript/);assert.equal(js.headers.get('access-control-allow-origin'),'*');
 assert.equal(assets.find(a=>a.name==='scene.blend').type,'other');
 const video=await fetch(base+'/media?project=p&path=files%2Fclip.mp4',{headers:{...headers,range:'bytes=2-4'}});assert.equal(video.status,206);assert.equal(await video.text(),'234');
 const missing=await fetch(base+'/api/assets?project=missing&case=__all__',{headers});assert.equal(missing.status,500);
 await writeFile(path.join(root,'config.json'),JSON.stringify({enabled:true,projects:[],automation:{inbox:{enabled:false}},deduplication:{enabled:false},storage:{generatedRoot:path.join(root,'generated')}}));
 const virtual=await get(`/api/codex/workspace?threadId=${id}`);assert.equal(virtual.project.id,`codex-thread:${id}`);assert.equal(virtual.project.readOnly,true);
 const all=await get(`/api/assets?project=${encodeURIComponent(virtual.project.id)}&case=__all__`);assert.equal(all.assets.length,9);
 const folders=await get(`/api/folders?project=${encodeURIComponent(virtual.project.id)}`);assert(folders.folders.some(f=>f.path==='files'));
 console.log('HTTP workspace / all files / preview / HTML sandbox / media range / virtual project: passed');
}finally{child.kill();await once(child,'exit');}
