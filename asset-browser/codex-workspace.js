import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { inflateRawSync } from 'node:zlib';

const types = {
  image: 'png jpg jpeg webp gif bmp svg avif tif tiff ico',
  video: 'mp4 mov m4v webm mkv avi', audio: 'mp3 wav m4a aac flac ogg oga opus aiff',
  markdown: 'md markdown mdx', html: 'html htm', pdf: 'pdf',
  office: 'docx xlsx pptx doc xls ppt odt ods odp', archive: 'zip rar 7z tar gz bz2 xz',
  code: 'js mjs cjs ts tsx jsx py ps1 sh bash bat cmd css scss less json jsonl yaml yml toml xml sql java go rs c h cpp cs rb php swift kt vue svelte',
  document: 'txt csv tsv rtf log ini cfg'
};
export function fileType(file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  return Object.entries(types).find(([, value]) => value.split(' ').includes(extension))?.[0] || 'other';
}
const excluded = new Set(['node_modules', '__pycache__', 'venv', 'env', 'target', 'coverage', 'backups', 'backup']);
const skip = name => name.startsWith('.') || excluded.has(name.toLowerCase());
const isChromiumProfile = entries => entries.some(entry=>entry.name === 'Local State' && entry.isFile())
  && entries.some(entry=>entry.name === 'Default' && entry.isDirectory());
const cleanPath = value => String(value || '').replace(/^\\\\\?\\/, '');
const within = (root, file) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`); };

export async function resolveCodexWorkspace(threadId, {projects, bindings, dbPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'state_5.sqlite')} = {}) {
  const result = {threadId, project: null, sharedProjectId: 'ai-reference-library'};
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(threadId))) return {...result, message: '未识别当前任务'};
  const validDirectory = async root => path.isAbsolute(root) && root !== path.parse(root).root
    && await fs.stat(root).then(stats => stats.isDirectory()).catch(() => false);
  let db;
  let lookupError = '';
  try {
    db = new DatabaseSync(dbPath, {readOnly: true});
    const row = db.prepare('SELECT cwd, project_id FROM threads WHERE id = ?').get(threadId);
    if (row) {
      const roots = row.project_id ? db.prepare('SELECT path FROM project_roots WHERE project_id = ? ORDER BY position').all(row.project_id).map(item=>cleanPath(item.path)) : [];
      const cwd = cleanPath(row.cwd);
      const candidates = [...roots.filter(candidate=>within(candidate,cwd)).sort((a,b)=>b.length-a.length), ...roots];
      let root = '';
      let source = 'native-project';
      for (const candidate of candidates) if (await validDirectory(candidate)) { root = candidate; break; }
      if (!root && await validDirectory(cwd)) { root = cwd; source = 'cwd'; }
      if (root) {
        const nativeProject = source === 'native-project' ? db.prepare('SELECT name FROM projects WHERE id = ?').get(row.project_id) : null;
        const configured = projects.find(item=>path.resolve(item.path).toLowerCase() === path.resolve(root).toLowerCase());
        const project = configured || {id: `codex-thread:${threadId}`, name: nativeProject?.name || path.basename(root), path: root, scanRoots: ['.'], readOnly: true};
        return {...result, source, project: {...project, rootPath: project.path, exists: true, readOnly: project.readOnly === true}};
      }
    }
  } catch {
    lookupError = '本机任务信息暂不可读取';
  } finally { db?.close(); }
  const binding = bindings.find(item => item.threadId === threadId);
  const bound = projects.find(item => item.id === binding?.projectId);
  if (bound && await validDirectory(bound.path)) return {...result, source: 'binding', project: {...bound, rootPath: bound.path, exists: true, readOnly: false}};
  return {...result, message: lookupError || '当前任务没有可浏览的项目目录'};
}

function scopeRoots(project, caseId) {
  const roots = project.scanRoots.map(item=>path.resolve(project.path,item)).filter(root=>within(project.path,root));
  if (caseId === '__all__') return roots.filter((root,index)=>!roots.some((other,otherIndex)=>otherIndex < index && within(other,root)));
  const requested = path.resolve(project.path,caseId || '.');
  if (!within(project.path,requested)) throw new Error('目录超出项目范围');
  return roots.flatMap(root=>within(root,requested)?[requested]:within(requested,root)?[root]:[]);
}
export async function collectWorkspaceFiles(project, caseId = '__all__') {
  const files = new Set();
  async function visit(directory) {
    const entries = await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if (isChromiumProfile(entries)) return;
    for (const entry of entries) {
      if (skip(entry.name)) continue;
      const file = path.join(directory,entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && fileType(file)) files.add(file);
    }
  }
  for (const root of scopeRoots(project,caseId)) await visit(root);
  return [...files];
}
export async function workspaceFolders(project) {
  const folders = new Map();
  async function visit(directory) {
    const entries = await fs.readdir(directory,{withFileTypes:true}).catch(()=>[]);
    if (isChromiumProfile(entries)) return;
    const rel = path.relative(project.path,directory);
    if (rel) folders.set(rel,{path:rel,name:path.basename(rel),depth:rel.split(path.sep).length});
    for (const entry of entries) {
      if (entry.isDirectory() && !skip(entry.name)) await visit(path.join(directory,entry.name));
    }
  }
  for (const root of scopeRoots(project,'__all__')) await visit(root);
  return {project:{id:project.id,name:project.name,path:project.path},folders:[{path:'',name:'项目根目录',depth:0},...folders.values()],truncated:false};
}

const previewLimit = 256 * 1024;
function xmlText(value) {
  return value.replace(/<\/(?:w:p|a:p|text:p|row)>/g,'\n').replace(/<[^>]*>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/[ \t]+/g,' ').trim();
}
function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= Math.max(0,buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0,buffer.length - 65557)) throw new Error('无法读取文件结构');
  let position = buffer.readUInt32LE(end+16);
  const entries=[];
  for(let index=0;index<buffer.readUInt16LE(end+10);index++) {
    if(buffer.readUInt32LE(position)!==0x02014b50) throw new Error('不支持此文件结构');
    const length=buffer.readUInt16LE(position+28), extra=buffer.readUInt16LE(position+30), comment=buffer.readUInt16LE(position+32);
    entries.push({name:buffer.subarray(position+46,position+46+length).toString('utf8'),method:buffer.readUInt16LE(position+10),size:buffer.readUInt32LE(position+20),offset:buffer.readUInt32LE(position+42)});
    position+=46+length+extra+comment;
  }
  return entries;
}
export async function previewFile(file) {
  const type=fileType(file), stat=await fs.stat(file);
  if (['markdown','code','document','html'].includes(type)) {
    const handle=await fs.open(file,'r');
    try {const buffer=Buffer.alloc(Math.min(stat.size,previewLimit));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);return {type,text:buffer.subarray(0,bytesRead).toString('utf8'),truncated:stat.size>previewLimit};} finally {await handle.close();}
  }
  if (type==='office' || path.extname(file).toLowerCase()==='.zip') {
    if(stat.size>64*1024*1024) return {type,text:'此文件超过 64 MB，请在本机应用打开。',truncated:true};
    if (!/\.(docx|xlsx|pptx|odt|ods|odp|zip)$/i.test(file)) return {type,text:'此格式请在本机应用打开。',truncated:false};
    const buffer=await fs.readFile(file),entries=zipEntries(buffer);
    if(type==='archive') return {type,text:entries.map(item=>item.name).join('\n').slice(0,previewLimit),truncated:entries.map(item=>item.name.length+1).reduce((a,b)=>a+b,0)>previewLimit};
    function readXml(item) {
      const start=item.offset+30+buffer.readUInt16LE(item.offset+26)+buffer.readUInt16LE(item.offset+28);
      const compressed=buffer.subarray(start,start+item.size);
      return (item.method===0?compressed:item.method===8?inflateRawSync(compressed,{maxOutputLength:8*1024*1024}):Buffer.alloc(0)).toString('utf8');
    }
    const shared=entries.find(item=>item.name==='xl/sharedStrings.xml');
    const strings=shared?[...readXml(shared).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match=>xmlText(match[1])):[];
    const selected=entries.filter(item=>/^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/worksheets\/sheet\d+\.xml|content\.xml)$/.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}));
    let text='';let truncated=false;
    for(const item of selected) {
      if(text.length>=previewLimit){truncated=true;break;}
      const xml=readXml(item);
      if(item.name.startsWith('xl/worksheets/')) {
        const cells=[...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(([,attributes,content])=>{
          const location=attributes.match(/\br="([^"]+)"/)?.[1] || '';
          const cellType=attributes.match(/\bt="([^"]+)"/)?.[1] || '';
          const value=content.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
          let display=cellType==='s'?(strings[Number(value)] ?? ''):cellType==='inlineStr'?xmlText(content):cellType==='b'?(value==='1'?'TRUE':'FALSE'):value!==undefined?xmlText(value):content.includes('<f>')?'='+xmlText(content):'';
          return location+': '+display;
        });
        text+='工作表 '+item.name.match(/sheet(\d+)/)[1]+'\n'+cells.join('\n')+'\n\n';
      } else if(item.name.startsWith('ppt/')) {
        const paragraphs=[...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map(match=>xmlText(match[1])).filter(Boolean);
        text+='幻灯片 '+item.name.match(/slide(\d+)/)[1]+'\n'+paragraphs.join('\n')+'\n\n';
      } else if(item.name==='word/document.xml') {
        text+=[...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(match=>xmlText(match[1])).filter(Boolean).join('\n\n');
      } else text+=xmlText(xml)+'\n\n';
    }
    return {type,text:text.slice(0,previewLimit)||'未找到可显示的正文结构。',truncated:truncated||text.length>previewLimit};
  }
  return {type,text:'此文件支持下载或在本机应用打开。',truncated:false};
}
