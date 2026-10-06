(() => {
'use strict';
function createSeed() {
  return {version:1,directions:[],items:[],catalog:[],view:{x:0,y:0,scale:1}};
}

const STATUS = Object.freeze({
  idea: '想法', todo: '待办', doing: '进行中', waiting: '等待中',
  done: '已完成', paused: '已暂停', unknown: '待确认',
});

function visibleItems(data, mode = 'all', query = '') {
  const needle = query.trim().toLocaleLowerCase();
  return data.items.filter(item => {
    const matchesMode = mode === 'focus' ? item.focus && item.status !== 'done'
      : mode === 'pending' ? ['todo', 'waiting', 'unknown', 'idea'].includes(item.status)
        : true;
    return matchesMode && `${item.title}\n${item.next}\n${item.note}\n${data.directions.find(d=>d.id===item.directionId)?.title||'未整理'}\n${item.threadIds.map(id=>data.catalog.find(t=>t.id===id)?.title||'').join(' ')}`.toLocaleLowerCase().includes(needle);
  });
}

function checkItem(item, data) {
  if (!item || typeof item.id !== 'string' || !item.id ||
      typeof item.title !== 'string' || !item.title.trim() ||
      typeof item.next !== 'string' || typeof item.note !== 'string' ||
      !Object.hasOwn(STATUS, item.status) || typeof item.focus !== 'boolean' ||
      !Number.isFinite(item.x) || !Number.isFinite(item.y) ||
      !(item.directionId === null || data.directions.some(d => d.id === item.directionId)) ||
      !Array.isArray(item.threadIds) || item.threadIds.some(id => !data.catalog.some(t => t.id === id))) {
    throw new Error('事项数据不完整或无效');
  }
}

function updateItem(data, id, patch) {
  if (Object.hasOwn(patch, 'id') && patch.id !== id) throw new Error('不能修改事项 ID');
  return { ...data, items: data.items.map(item => {
    if (item.id !== id) return item;
    const updated = { ...item, ...patch, id };
    checkItem(updated, data);
    return updated;
  }) };
}

function removeItem(data, id) {
  return { ...data, items: data.items.filter(item => item.id !== id) };
}

function removeDirection(data,id){return {...data,directions:data.directions.filter(d=>d.id!==id),items:data.items.map(i=>i.directionId===id?{...i,directionId:null}:i)};}

function moveDirection(data, id, dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('移动距离无效');
  const move = entry => ({ ...entry, x: entry.x + dx, y: entry.y + dy });
  return {
    ...data,
    directions: data.directions.map(direction => direction.id === id ? move(direction) : direction),
    items: data.items.map(item => item.directionId === id ? move(item) : item),
  };
}

function linkThread(data, itemId, threadId) {
  if (!data.catalog.some(thread => thread.id === threadId)) throw new Error('任务目录中没有这个任务');
  const item = data.items.find(entry => entry.id === itemId);
  if (!item) throw new Error('事项不存在');
  return updateItem(data, itemId, { threadIds: [...new Set([...item.threadIds, threadId])] });
}

function attachThreads(data, itemId, threads) {
  const item = data.items.find(entry => entry.id === itemId);
  if (!item) throw new Error('事项不存在');
  const catalog = new Map(data.catalog.map(thread => [thread.id, thread]));
  for (const thread of threads) {
    if (!thread || typeof thread.id !== 'string' || !thread.id || typeof thread.title !== 'string' || !thread.title.trim()) throw new Error('任务目录数据无效');
    catalog.set(thread.id, {id:thread.id, title:thread.title});
  }
  return updateItem({...data, catalog:[...catalog.values()]}, itemId, {
    threadIds:[...new Set([...item.threadIds, ...threads.map(thread => thread.id)])],
  });
}

function addItem(data, { title, directionId = null, ...options }) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('请填写事项标题');
  const direction = data.directions.find(entry => entry.id === directionId);
  if (directionId !== null && !direction) throw new Error('方向不存在');
  const index = data.items.filter(item => item.directionId === directionId).length;
  const item = {
    next: '补充下一步', status: 'idea', focus: false, threadIds: [], note: '',
    x: (direction?.x ?? 1500) + 70,
    y: (direction?.y ?? 0) + 115 + index * 110,
    ...options, title: title.trim(), directionId, id: globalThis.crypto.randomUUID(),
  };
  checkItem(item, data);
  return { ...data, items: [...data.items, item] };
}

function parseStored(raw) {
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.directions) ||
      !Array.isArray(data.items) || !Array.isArray(data.catalog) ||
      !data.view || !Number.isFinite(data.view.x) || !Number.isFinite(data.view.y) ||
      !Number.isFinite(data.view.scale) || data.view.scale <= 0) throw new Error('地图数据结构无效');
  for (const entries of [data.directions, data.catalog, data.items]) {
    if (entries.some(entry => !entry || typeof entry.id !== 'string' || !entry.id ||
        typeof entry.title !== 'string' || !entry.title.trim()) ||
        new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('地图条目无效');
  }
  if (data.directions.some(d => typeof d.color !== 'string' ||
      !Number.isFinite(d.x) || !Number.isFinite(d.y))) throw new Error('方向数据无效');
  data.items.forEach(item => checkItem(item, data));
  return data;
}

function graphInView(graph, data, mode, query) {
  if(mode==='all'&&!query.trim())return graph;
  const needle=query.trim().toLocaleLowerCase();
  const items=new Set(visibleItems(data,mode==='inbox'?'all':mode,query).filter(i=>mode!=='inbox'||i.directionId===null&&i.status!=='done').map(i=>i.id));
  const keep=new Set(graph.nodes.filter(n=>n.kind==='item'&&(items.has(n.entityId)||(mode==='all'&&needle&&n.title.toLocaleLowerCase().includes(needle)))).map(n=>n.id));
  for(const edge of graph.edges)if(keep.has(edge.source)||keep.has(edge.target)){
    const other=graph.nodes.find(n=>n.id===(keep.has(edge.source)?edge.target:edge.source));if(other&&other.kind!=='item')keep.add(other.id);
  }
  return {nodes:graph.nodes.filter(n=>keep.has(n.id)),edges:graph.edges.filter(e=>keep.has(e.source)&&keep.has(e.target))};
}

function cosmosLayout(graph) {
 const positions=new Map(),galaxies=[];
 const sorted=kind=>graph.nodes.filter(n=>n.kind===kind).sort((a,b)=>a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));
 const directions=sorted('direction'),items=sorted('item'),threads=sorted('thread');
 const parent=id=>graph.edges.find(e=>e.target===id&&e.kind==='contains')?.source||'';
 const groups=[...directions];if(items.some(n=>!directions.some(d=>d.id===parent(n.id))))groups.push({id:'',title:'未归属'});
 const centers=[[180,170],[800,95],[420,540],[1080,475]];
 groups.forEach((direction,index)=>{
  const [cx,cy]=centers[index%4].map((v,axis)=>v+Math.floor(index/4)*(axis?620:140));
  const members=items.filter(n=>parent(n.id)===direction.id),color=index%4;
  galaxies.push({id:direction.id,cx,cy,color});if(direction.id)positions.set(direction.id,{x:cx,y:cy,w:200,h:44,color});
  const branches=[[[80,-110],[175,20],[20,135]],[[15,115],[195,55],[-95,-85]],[[-170,-105],[80,-85],[180,100]],[[-95,-135],[155,-65],[80,130]]][index%4];
  members.forEach((node,i)=>{const [dx,dy]=branches[i%3];positions.set(node.id,{x:cx+dx+Math.floor(i/3)*230,y:cy+dy+Math.floor(i/3)*90,w:180,h:44,color});});
 });
 const collides=p=>[...positions.values()].some(q=>p.x<q.x+q.w+12&&p.x+p.w+12>q.x&&p.y<q.y+q.h+12&&p.y+p.h+12>q.y);
 threads.forEach((node,index)=>{
  const owner=graph.edges.find(e=>e.target===node.id&&positions.has(e.source)),item=owner&&positions.get(owner.source),galaxy=item&&galaxies.find(g=>g.color===item.color);if(!galaxy)return;
  const angle=Math.atan2(item.y-galaxy.cy,item.x-galaxy.cx);let chosen;for(let ring=0;ring<8&&!chosen;ring++)for(let step=0;step<12;step++){const turn=angle+(step%2?1:-1)*Math.ceil(step/2)*.38,p={x:item.x+Math.cos(turn)*(155+ring*30),y:item.y+Math.sin(turn)*(95+ring*25),w:170,h:44,color:galaxy.color};if(!collides(p)){chosen=p;break;}}
  if(chosen)positions.set(node.id,chosen);
 });
 const unplaced=graph.nodes.filter(n=>!positions.has(n.id));unplaced.forEach((n,i)=>positions.set(n.id,{x:90+i%5*230,y:galaxies.length?760+Math.floor(i/5)*70:80,w:180,h:44,color:0}));
 const boxes=[];for(const p of positions.values()){const x=p.x,y=p.y;for(let step=0;boxes.some(q=>p.x<q.x+q.w+12&&p.x+p.w+12>q.x&&p.y<q.y+q.h+12&&p.y+p.h+12>q.y);step++){const angle=step*2.39996,r=24*Math.sqrt(step+1);p.x=x+Math.cos(angle)*r;p.y=y+Math.sin(angle)*r;}boxes.push(p);}
 return {positions,galaxies};
}

function mountApp(root, bridge = {}) {
const document = root.ownerDocument;
const $ = selector => root.querySelector(selector);
const el = (tag, attrs = {}, text = '') => {const node=document.createElement(tag); for(const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);node.textContent=text;return node;};
const key = 'workspace-enhancer-global-map-v1';
let data=createSeed(), mode='all', query='', selected=null, panel=null, history=[], storageOK=true, indexSafe=true, loaded=false, drag=null, toastTimer;
try {const saved=localStorage.getItem(key);if(saved){data=parseStored(saved);loaded=true;}}
catch {storageOK=false;indexSafe=false;$('#save-state').textContent='本地记录读取失败 · 临时画布';$('#save-state').classList.add('error');}
const map=$('#map'),world=$('#world'),nodes=$('#nodes'),inspector=$('#inspector');
const shell=$('.native-host');
const scenery={setMotion(){},destroy(){}};
const viewKey='workspace-enhancer-global-map-ui-v1';
let cameraFrame=0;
let layout='graph';try{const saved=localStorage.getItem(viewKey);if(['graph','list','map'].includes(saved))layout=saved;}catch{}
const graphArea=el('div',{id:'cortex-graph','aria-label':'CortexDB 关系图'}),graphWorld=el('div',{id:'graph-world'}),graphEdges=document.createElementNS('http://www.w3.org/2000/svg','svg'),graphNodes=el('div',{id:'graph-nodes'}),graphBar=el('div',{id:'graph-bar'}),graphStatus=el('span',{id:'graph-status',role:'status'}),graphRetry=el('button',{id:'graph-refresh'},'刷新关系'),graphEmpty=el('div',{id:'graph-empty'});
graphEdges.setAttribute('id','graph-edges');graphEdges.setAttribute('aria-hidden','true');graphWorld.append(graphEdges,graphNodes);graphArea.append(graphWorld,graphEmpty);graphBar.append(graphStatus,graphRetry);map.append(graphArea,graphBar);
const graphStyle=el('style',{},`#cortex-graph{position:absolute;inset:110px 16px 76px;overflow:hidden;touch-action:none}#graph-world{position:absolute;transform-origin:0 0}#graph-edges{position:absolute;width:1px;height:1px;overflow:visible;pointer-events:none}#graph-edges path{fill:none;stroke:var(--muted);stroke-width:1.5;opacity:.5}#graph-edges path.active{stroke:var(--accent);opacity:1}#graph-edges path.dim{opacity:.12}#graph-nodes .graph-node{position:absolute;width:220px;min-height:76px;text-align:left;white-space:normal;background:var(--surface);border:1px solid var(--line);padding:10px 12px;border-radius:8px}#graph-nodes strong{display:block;overflow-wrap:anywhere;font-size:14px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}#graph-nodes small{display:block;color:var(--muted);font-size:12px;margin-top:5px}#graph-nodes .selected{outline:2px solid var(--accent)}#graph-nodes .related{border-color:var(--accent)}#graph-nodes .dim{border-color:var(--line)}.graph-column{position:absolute;top:0;color:var(--muted);font-size:12px}#graph-bar{position:absolute;left:24px;right:24px;top:73px;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted);z-index:2}#graph-status{min-width:0;overflow-wrap:anywhere}#graph-refresh{margin-left:auto;white-space:nowrap;border-color:var(--line)}#graph-empty{padding:40px 16px;color:var(--muted);text-align:center}#graph-empty strong{display:block;color:var(--text);margin-bottom:8px}[data-layout=graph] #world,[data-layout=graph] #outline-list,[data-layout=graph] #empty,[data-layout=graph] #direction-nav,[data-layout=graph] #arrange{display:none}[data-layout=list] #cortex-graph,[data-layout=map] #cortex-graph,[data-layout=list] #graph-bar,[data-layout=map] #graph-bar{display:none}.scene-tools{display:flex;gap:4px;background:var(--surface);border-radius:7px}.scene-tools button[aria-pressed=true]{background:var(--raised)}[data-layout=graph] #map-count{display:none}[data-layout=graph] .map-caption{right:320px}[data-layout=graph] .gestures{display:none}@media(max-width:650px){.scene-tools{top:56px;left:12px;right:auto}#graph-bar{top:104px;left:12px;right:12px;align-items:flex-start}#cortex-graph{inset:155px 8px 68px}[data-layout=graph] .map-caption{right:12px}#graph-status{font-size:11px}.graph-node{min-height:80px}}`);root.append(graphStyle);
let graph={nodes:[],edges:[]},graphLoaded=false,graphBusy=false,graphError='',graphSelected=null,graphRequest=0,graphView={x:0,y:0,scale:1},graphPositions=new Map(),graphDrag=null,graphVisibleEdges=[];
for(const [value,label] of [['graph','Cortex 关系图'],['list','分组列表'],['map','整理画布']]){const button=value==='map'?$('#outline-toggle'):el('button');button.dataset.layoutChoice=value;button.textContent=label;button.onclick=()=>setLayout(value);if(value!=='map')$('.scene-tools').insertBefore(button,$('#outline-toggle'));}
function setLayout(value){stopCamera();layout=value;shell.dataset.layout=value;root.querySelectorAll('[data-layout-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layoutChoice===value)));try{localStorage.setItem(viewKey,value);}catch{}requestAnimationFrame(()=>{if(!alive||layout!==value)return;if(value==='map')fit();else if(value==='graph'){renderGraph();fitGraph();}});}
setLayout(layout);
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let motion=!reducedMotion.matches, alive=true;
function setMotion(enabled){motion=enabled;if(!motion)stopCamera(); shell.classList.toggle('motion-paused',!motion);scenery.setMotion(motion);$('#motion-toggle').setAttribute('aria-pressed',String(motion));$('#motion-toggle').textContent=motion?'暂停动效':'开启动效';}
setMotion(motion);
const onMotionChange=()=>setMotion(!reducedMotion.matches);
reducedMotion.addEventListener('change',onMotionChange);
$('#motion-toggle').onclick=()=>setMotion(!motion);
$('#close-global-map').onclick=()=>bridge.close?.();
function stopCamera(){cancelAnimationFrame(cameraFrame);cameraFrame=0;}
function cameraTo(target){
  stopCamera(); const from={...data.view}; if(!motion){data.view=target;applyView();persist();return;}
  const start=performance.now();
  function step(now){if(!alive)return;const t=Math.min(1,(now-start)/180),ease=1-Math.pow(1-t,4);data.view={x:from.x+(target.x-from.x)*ease,y:from.y+(target.y-from.y)*ease,scale:from.scale+(target.scale-from.scale)*ease};applyView();if(t<1)cameraFrame=requestAnimationFrame(step);else{cameraFrame=0;persist();}}
  cameraFrame=requestAnimationFrame(step);
}
const descriptions={all:['把工作放回全局','方向保持稳定，事项沿着方向推进。'],focus:['只看眼下重要的事','由你标记重点，不按聊天活跃度排序。'],pending:['下一步，先理清什么','待办、等待和待确认的事项集中在这里。'],inbox:['先记下来，稍后归位','想法可以先存在，不必先建立 Codex 任务。']};
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3000);}
function persist(){if(!storageOK)return;try{localStorage.setItem(key,JSON.stringify(data));indexSafe=true;$('#save-state').classList.remove('error');$('#save-state').textContent='已保存到 Codex 本机';}catch{indexSafe=false;graphError='地图修改尚未保存，未同步';$('#save-state').textContent='保存失败 · 请导出保留';$('#save-state').classList.add('error');toast('保存失败，请导出地图保留本次修改。');}}
function remember(){history.push(structuredClone(data));if(history.length>30)history.shift();$('#undo').disabled=false;}
function commit(next,message){remember();data=next;persist();render();scheduleIndex();if(message)toast(message);}
function itemsInView(){return visibleItems(data,mode==='inbox'?'all':mode,query).filter(i=>mode!=='inbox'||i.directionId===null&&i.status!=='done');}
function directionsInView(){const visible=itemsInView();return mode==='all'&&!query?data.directions:data.directions.filter(d=>visible.some(i=>i.directionId===d.id));}
function applyView(){const {x,y,scale}=data.view;world.style.transform=`translate(${x}px,${y}px) scale(${scale})`;world.style.setProperty('--label-scale',Math.max(1,.8/scale));world.classList.toggle('compact',scale<.7);$('#zoom-value').textContent=`${Math.round(scale*100)}%`;}
const graphDirection=el('select',{id:'graph-direction','aria-label':'筛选关系方向'});graphDirection.style.width='auto';graphDirection.style.maxWidth='180px';graphBar.insertBefore(graphDirection,graphRetry);graphDirection.onchange=()=>{graphSelected=null;renderGraph();fitGraph(true);};
const graphHint=el('span',{id:'graph-hint'},'拖动空白平移 · 滚轮缩放 · 适应查看全图');graphHint.style.cssText='font-size:11px;color:var(--muted)';$('.source-note').append(graphHint);root.append(el('style',{},`[data-layout=list] #graph-hint,[data-layout=map] #graph-hint{display:none}#graph-bar{flex-wrap:wrap}#graph-status{flex:1 1 180px}#graph-direction{flex:0 1 180px}#graph-hint{display:block}@media(max-width:650px){[data-layout=graph] .map-caption>div{width:100%;min-width:0}[data-layout=graph] .map-caption span{max-width:none;width:100%}#graph-bar{gap:4px}#graph-status{flex-basis:100%}#graph-direction{max-width:calc(100% - 110px)!important}#cortex-graph{top:184px}}`));
const graphLabels=el('div',{id:'graph-labels'},'◉ 方向   • 事项   ◦ 会话');graphLabels.style.cssText='position:absolute;left:12px;bottom:0;font-size:12px;color:var(--muted);pointer-events:none;z-index:1';graphArea.append(graphLabels);
const graphGalaxies=el('div',{id:'graph-galaxies','aria-hidden':'true'});graphWorld.insertBefore(graphGalaxies,graphEdges);
const graphStars=el('div',{id:'graph-stars','aria-hidden':'true'});graphArea.insertBefore(graphStars,graphWorld);
// Reuse the original scenery's deterministic star distribution, without its drift loop.
for(let i=0;i<190;i++){const star=el('i'),size=i%23===0?2:i%7===0?1.5:1;star.style.cssText=`left:${((i*127.71+43)%997)/997*100}%;top:${((i*83.19+211)%701)/701*100}%;width:${size}px;height:${size}px;opacity:${i%23===0?.28:i%7===0?.2:.12}`;graphStars.append(star);}
root.append(el('style',{},`
[data-layout=graph] #map{background:radial-gradient(ellipse at 22% 28%,#38568138,transparent 48%),radial-gradient(ellipse at 76% 55%,#50417024,transparent 48%),radial-gradient(ellipse at 48% 80%,#274b4f20,transparent 42%),color-mix(in srgb,var(--bg) 58%,#080c17)}
#graph-stars{position:absolute;inset:0;pointer-events:none}#graph-stars i{position:absolute;border-radius:50%;background:var(--text)}
#graph-galaxies{display:none}
#graph-nodes .graph-node{box-sizing:border-box;min-height:44px;width:180px;border:0;border-radius:6px;background:transparent!important;padding:11px 4px 8px 32px;color:var(--text);text-shadow:0 1px 3px #000}
#graph-nodes .graph-node:before{content:'';position:absolute;left:10px;top:18px;width:7px;height:7px;border-radius:50%;background:var(--galaxy-color);box-shadow:0 0 9px color-mix(in srgb,var(--galaxy-color) 65%,transparent);transform:scale(var(--graph-point-factor,1));transform-origin:center}
#graph-nodes .graph-node[data-graph-kind=direction]{width:200px;padding-left:38px}
#graph-nodes .graph-node[data-graph-kind=direction]:before{width:16px;height:16px;left:6px;top:13px;border:1px solid var(--galaxy-color);background:radial-gradient(circle,#fff 10%,var(--galaxy-color) 35%,transparent 65%);box-shadow:0 0 14px color-mix(in srgb,var(--galaxy-color) 65%,transparent)}
#graph-nodes strong{font-size:14px;line-height:1.35;-webkit-line-clamp:2;font-weight:500}#graph-nodes [data-graph-kind=direction] strong{font-size:18px;letter-spacing:.01em}#graph-nodes [data-graph-kind=thread]{width:170px}#graph-nodes [data-graph-kind=thread] strong{font-size:12px;font-weight:400}#graph-nodes [data-graph-kind=thread]:before{width:5px;height:5px;top:19px;left:11px;border:1px solid var(--galaxy-color);background:transparent;box-shadow:none}#graph-nodes small{font-size:11px;margin-top:3px;color:var(--text)}#graph-nodes small:empty{display:none}
#graph-nodes .graph-node.selected{outline:1px solid color-mix(in srgb,var(--accent) 60%,transparent)}#graph-nodes .graph-node.related:before{box-shadow:0 0 14px var(--galaxy-color)}
#graph-edges path{stroke:var(--galaxy-color,var(--muted));stroke-width:1;opacity:.24}#graph-edges path.active{stroke:var(--accent);stroke-width:1.5;opacity:.8}#graph-edges path.dim{opacity:.08}
@keyframes graph-flow{to{stroke-dashoffset:-34}}@media(prefers-reduced-motion:reduce){#graph-edges path.active{animation:none;stroke-dasharray:none}}.motion-paused #graph-edges path.active{animation:none;stroke-dasharray:none}
@media(hover:hover) and (pointer:fine){#graph-nodes .graph-node:hover:before{box-shadow:0 0 18px var(--galaxy-color)}}
input::placeholder,textarea::placeholder{color:var(--muted);opacity:1}
[data-layout=graph] .map-caption{display:none}#graph-bar{top:18px;right:340px;flex-wrap:nowrap}#graph-status{flex:1 1 auto;white-space:nowrap;font-size:11px}#graph-direction{flex:0 1 150px}#cortex-graph{inset:64px 16px 64px}
@media(max-width:650px){[data-layout=graph] .scene-tools{top:12px;left:auto;right:12px}#graph-bar{top:58px;left:12px;right:12px}#graph-status{flex-basis:auto;font-size:10px}#graph-direction{max-width:130px!important}#cortex-graph{top:106px}#graph-labels{font-size:10px}}
@media(min-width:480px) and (max-width:650px){.app-header{flex-wrap:nowrap}.brand,.header-actions{width:auto}.header-actions{margin-left:auto}.brand{gap:2px}.app-header{gap:6px}.header-actions button{padding-inline:7px}}
#cortex-graph{overflow:clip}
@media(max-width:479px){#graph-bar{flex-wrap:wrap;gap:4px}#graph-status{flex:1 0 100%;white-space:normal}#cortex-graph{top:136px}}
`));
function applyGraphView(){graphWorld.style.transform=`translate(${graphView.x}px,${graphView.y}px) scale(${graphView.scale})`;const factor=Math.max(1,1/graphView.scale),compact=graphArea.clientWidth<700;for(const button of graphNodes.children){const kind=button.dataset.graphKind;button.querySelector('strong').style.fontSize=`${(kind==='direction'?18:kind==='thread'?12:14)*factor}px`;button.querySelector('small').style.fontSize=`${11*factor}px`;button.style.setProperty('--graph-point-factor',String(factor));button.style.paddingLeft=`${(kind==='direction'?38:32)*factor}px`;const width=kind==='direction'?150:kind==='thread'?110:125;button.style.width=`${compact?width*factor:Math.max(kind==='direction'?200:kind==='thread'?170:180,width*factor)}px`;button.style.minHeight=`${44*factor}px`;}if(layout==='graph')$('#zoom-value').textContent=`${Math.round(graphView.scale*100)}%`;}
function compactGraphLabels(){
 const buttons=new Map([...graphNodes.children].map(b=>[b.dataset.graphId,b])),columns=graphArea.clientWidth>=500?2:1,factor=Math.max(1,1/graphView.scale),gutter=24*factor,columnWidth=Math.max(245,(graphArea.clientWidth-40-24*(columns-1))/columns)*factor,bottoms=Array(columns).fill(0),placed=new Set();
 const measure=id=>{const b=buttons.get(id),p=graphPositions.get(id);p.w=b.offsetWidth;p.h=b.offsetHeight;return p;};
 const put=(id,x,y)=>{const p=measure(id);p.x=x;p.y=y;place(buttons.get(id),p);placed.add(id);return p.h;};
 const directions=[...buttons.keys()].filter(id=>buttons.get(id).dataset.graphKind==='direction');
 for(const id of directions){const column=bottoms.indexOf(Math.min(...bottoms)),x=column*(columnWidth+gutter);let y=bottoms[column];y+=put(id,x+8*factor,y)+8*factor;
  for(const edge of graphVisibleEdges.filter(e=>e.source===id&&e.kind==='contains')){if(!buttons.has(edge.target)||placed.has(edge.target))continue;const item=edge.target,threads=graphVisibleEdges.filter(e=>e.source===item&&e.kind==='thread'&&buttons.has(e.target)&&!placed.has(e.target)).map(e=>e.target);let threadY=y;
   for(const thread of threads)threadY+=put(thread,x+columnWidth-110*factor,threadY)+6*factor;
   const rowHeight=Math.max(measure(item).h,threads.length?threadY-y-6*factor:0);put(item,x,y+(rowHeight-measure(item).h)/2);y+=rowHeight+8*factor;
  }bottoms[column]=y+16*factor;
 }
 for(const id of buttons.keys())if(!placed.has(id)){const column=bottoms.indexOf(Math.min(...bottoms));bottoms[column]+=put(id,column*(columnWidth+gutter),bottoms[column])+8*factor;}
}
function graphBounds(){const entries=[...graphPositions.values()],minX=Math.min(...entries.map(p=>p.x)),minY=Math.min(...entries.map(p=>p.y));return {minX,minY,width:Math.max(...entries.map(p=>p.x+p.w))-minX,height:Math.max(...entries.map(p=>p.y+p.h))-minY};}
function setGraphOverflow(overflow){graphArea.dataset.overflow=String(overflow);graphHint.textContent=overflow?'拖动查看其余关系 · Tab 定位节点 · 按方向筛选':'拖动空白平移 · 滚轮缩放 · 适应查看全图';}
function revealGraphNode(id){const p=graphPositions.get(id);if(!p)return;const s=graphView.scale,left=p.x*s+graphView.x,top=p.y*s+graphView.y,right=left+p.w*s,bottom=top+p.h*s;graphView.x+=left<12?12-left:right>graphArea.clientWidth-12?graphArea.clientWidth-12-right:0;graphView.y+=top<12?12-top:bottom>graphArea.clientHeight-28?graphArea.clientHeight-28-bottom:0;applyGraphView();}
function resolveGraphLabels(){
 if(graphArea.clientWidth<700){compactGraphLabels();return;}
 const scale=Math.min(1,graphView.scale),gap=8/scale,stride=24/scale,aspect=Math.sqrt(Math.max(.5,Math.min(2,graphArea.clientWidth/graphArea.clientHeight)))*(graphArea.clientWidth<graphArea.clientHeight?.92:1),boxes=[];for(const button of graphNodes.children){const p=graphPositions.get(button.dataset.graphId);if(!p)continue;p.w=button.offsetWidth;p.h=button.offsetHeight;const x=p.x,y=p.y;for(let step=0;boxes.some(q=>p.x<q.x+q.w+gap&&p.x+p.w+gap>q.x&&p.y<q.y+q.h+gap&&p.y+p.h+gap>q.y);step++){const angle=step*2.39996,r=stride*Math.sqrt(step+1);p.x=x+Math.cos(angle)*r*aspect;p.y=y+Math.sin(angle)*r/aspect;}place(button,p);boxes.push(p);}
}
function renderGraphEdges(){
 graphEdges.replaceChildren();const colors=['#9dbdd8','#b2b7d7','#a4c5b5','#d4b891'];for(const edge of graphVisibleEdges){const a=graphPositions.get(edge.source),b=graphPositions.get(edge.target);if(!a||!b)continue;const path=document.createElementNS('http://www.w3.org/2000/svg','path'),ax=a.x+14,ay=a.y+22,bx=b.x+14,by=b.y+22;path.setAttribute('d',`M ${ax} ${ay} L ${bx} ${by}`);path.style.setProperty('--galaxy-color',colors[a.color]);path.setAttribute('data-graph-edge',edge.kind);if(graphSelected)path.setAttribute('class',edge.source===graphSelected||edge.target===graphSelected?'active':'dim');graphEdges.append(path);}
}
function highlightGraph(id){const related=new Set(id?[id]:[]);for(const edge of graphVisibleEdges)if(edge.source===id||edge.target===id){related.add(edge.source);related.add(edge.target);}for(const button of graphNodes.children){button.classList.toggle('related',!!id&&related.has(button.dataset.graphId));button.classList.toggle('dim',!!id&&!related.has(button.dataset.graphId));}for(const path of graphEdges.children){const index=[...graphEdges.children].indexOf(path),edge=graphVisibleEdges[index];path.setAttribute('class',id?(edge.source===id||edge.target===id?'active':'dim'):'');}}
function fitGraph(full=false){
 if(!graphPositions.size||graphArea.clientWidth<1||graphArea.clientHeight<1)return;
 const base=cosmosLayout({nodes:graph.nodes.filter(n=>graphPositions.has(n.id)),edges:graphVisibleEdges}).positions;let scale=1,bounds;
 for(let pass=0;pass<12;pass++){
  graphPositions=new Map([...base].map(([id,p])=>[id,{...p}]));graphView.scale=scale;applyGraphView();resolveGraphLabels();bounds=graphBounds();const {width,height}=bounds,next=Math.min(1,(graphArea.clientWidth-40)/width,(graphArea.clientHeight-56)/height);if(graphArea.clientWidth<700||width*scale<=graphArea.clientWidth-40&&height*scale<=graphArea.clientHeight-56)break;const limited=Math.max(.4,Math.min(scale,next)*.98);if(limited===scale)break;if(pass<11)scale=limited;
 }
 const overflow=bounds.width*scale>graphArea.clientWidth-40||bounds.height*scale>graphArea.clientHeight-56;setGraphOverflow(overflow);graphView={x:(graphArea.clientWidth-bounds.width*scale)/2-bounds.minX*scale,y:overflow?20-bounds.minY*scale:28+(graphArea.clientHeight-28-bounds.height*scale)/2-bounds.minY*scale,scale};applyGraphView();renderGraphEdges();
}
function zoomGraph(factor,cx=graphArea.clientWidth/2,cy=graphArea.clientHeight/2){const old=graphView,scale=Math.max(.4,Math.min(1.6,old.scale*factor));graphView={x:cx-(cx-old.x)*scale/old.scale,y:cy-(cy-old.y)*scale/old.scale,scale};applyGraphView();resolveGraphLabels();if(graphPositions.size){const bounds=graphBounds();setGraphOverflow(bounds.width*scale>graphArea.clientWidth-40||bounds.height*scale>graphArea.clientHeight-56);}renderGraphEdges();}
function renderGraph(){
 const focused=root.activeElement?.dataset?.graphId;
 const currentDirection=graphDirection.value||'';graphDirection.replaceChildren(el('option',{value:''},'所有方向'));for(const n of graph.nodes.filter(n=>n.kind==='direction'))graphDirection.append(el('option',{value:n.id},n.title));graphDirection.value=currentDirection;
 let visible=graphInView(graph,data,mode,query);
 if(currentDirection){const keep=new Set([currentDirection]);for(const e of visible.edges)if(e.source===currentDirection)keep.add(e.target);for(const e of visible.edges)if(keep.has(e.source))keep.add(e.target);visible={nodes:visible.nodes.filter(n=>keep.has(n.id)),edges:visible.edges.filter(e=>keep.has(e.source)&&keep.has(e.target))};}
 graphNodes.replaceChildren();graphEdges.replaceChildren();graphGalaxies.replaceChildren();
 const scene=cosmosLayout(visible);graphPositions=scene.positions;
 const colors=['#9dbdd8','#b2b7d7','#a4c5b5','#d4b891'];
 for(const galaxy of scene.galaxies){const layer=el('div',{class:'graph-galaxy'});layer.style.setProperty('--galaxy-color',colors[galaxy.color]);place(layer,{x:galaxy.cx-305,y:galaxy.cy-205});graphGalaxies.append(layer);}
 const sorted=visible.nodes.slice().sort((a,b)=>a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));
 const related=new Set(graphSelected?[graphSelected]:[]);for(const edge of visible.edges)if(edge.source===graphSelected||edge.target===graphSelected){related.add(edge.source);related.add(edge.target);}
 for(const kind of ['direction','item','thread']){
  for(const n of sorted.filter(n=>n.kind===kind)){const p=graphPositions.get(n.id);const button=el('button',{class:`graph-node${graphSelected===n.id?' selected':''}${graphSelected?(related.has(n.id)?' related':' dim'):''}`,'data-graph-id':n.id,'data-entity-id':n.entityId,'data-graph-kind':kind,'aria-pressed':String(graphSelected===n.id),'aria-label':`${{direction:'方向',item:'事项',thread:'会话'}[kind]}：${n.title}`});place(button,p);button.style.setProperty('--galaxy-color',colors[p.color]);button.append(el('strong',{},n.title),el('small',{},kind==='item'?(n.status==='doing'?STATUS[n.status]:n.priority==='high'?'重点':''):''));button.onpointerenter=()=>highlightGraph(n.id);button.onpointerleave=()=>highlightGraph(graphSelected);button.onfocus=()=>{revealGraphNode(n.id);highlightGraph(n.id);};button.onblur=()=>highlightGraph(graphSelected);button.onclick=()=>{graphSelected=n.id;if(kind==='thread'){selected=n.entityId;panel='thread';render();}else if((kind==='item'?data.items:data.directions).some(v=>v.id===n.entityId)){select(n.entityId,kind);}else{selected=n.entityId;panel='graph-record';render();}};graphNodes.append(button);}
 }
 graphVisibleEdges=visible.edges;applyGraphView();resolveGraphLabels();renderGraphEdges();
 graphStatus.dataset.state=graphBusy?'busy':graphError?'error':graphLoaded?'ready':'idle';graphStatus.textContent=graphBusy?'CortexDB · 正在读取关系…':graphError?`CortexDB · ${graphLoaded?'上次成功图已过期 · ':''}${graphError}`:graphLoaded?`Cortex RDF · ${visible.nodes.length===graph.nodes.length?graph.nodes.length:visible.nodes.length+'/'+graph.nodes.length} 点 / ${visible.edges.length===graph.edges.length?graph.edges.length:visible.edges.length+'/'+graph.edges.length} 边`:'CortexDB · 等待索引同步';graphRetry.disabled=graphBusy;graphArea.setAttribute('aria-busy',String(graphBusy));graphEmpty.hidden=visible.nodes.length>0;graphEmpty.textContent=graphBusy?'正在读取方向、事项与会话关系…':graphError?'关系读取失败。点击「刷新关系」重试；事项仍可在分组列表编辑。':graphLoaded?(graph.nodes.length?'没有匹配的关系。清空搜索或切换方向。':'关系图还没有记录。记一件事并关联会话后刷新。'):'先同步本机索引，再读取 CortexDB 关系。';applyGraphView();if(focused)graphNodes.querySelector(`[data-graph-id="${CSS.escape(focused)}"]`)?.focus();
}
async function refreshGraph(){const request=++graphRequest;graphBusy=true;graphError='';renderGraph();try{if(typeof bridge.graphMemory!=='function')throw Error('关系桥尚未连接');const result=await bridge.graphMemory();if(!alive||request!==graphRequest)return;if(!Array.isArray(result.nodes)||!Array.isArray(result.edges))throw Error('关系响应无效');graph={nodes:result.nodes,edges:result.edges};const first=!graphLoaded;graphLoaded=true;graphBusy=false;renderGraph();if(first)fitGraph();}catch(error){if(alive&&request===graphRequest){graphBusy=false;graphError=error.message||'读取失败';renderGraph();}}}
graphRetry.onclick=()=>syncIndex();
graphArea.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;graphDrag={x:e.clientX,y:e.clientY,view:{...graphView}};graphArea.setPointerCapture(e.pointerId);});
graphArea.addEventListener('pointermove',e=>{if(!graphDrag)return;graphView={...graphDrag.view,x:graphDrag.view.x+e.clientX-graphDrag.x,y:graphDrag.view.y+e.clientY-graphDrag.y};applyGraphView();});
graphArea.addEventListener('pointerup',()=>graphDrag=null);graphArea.addEventListener('pointercancel',()=>graphDrag=null);
graphArea.addEventListener('wheel',e=>{e.preventDefault();const box=graphArea.getBoundingClientRect();zoomGraph(Math.exp(-e.deltaY*.0015),e.clientX-box.left,e.clientY-box.top);},{passive:false});
function fit(entries=null){
  if(layout==='list')return;
  if(layout==='graph'){fitGraph(true);return;}
  const content=entries||[...directionsInView(),...itemsInView()];if(!content.length)return;
  const box=map.getBoundingClientRect(),availableW=box.width-88,availableH=Math.max(180,box.height-204);
  const minX=Math.min(...content.map(n=>n.x))-35,minY=Math.min(...content.map(n=>n.y))-32;
  const maxX=Math.max(...content.map(n=>n.x+330))+35,maxY=Math.max(...content.map(n=>n.y+115))+30;
  const scale=Math.max(.25,Math.min(entries?1.25:1,availableW/(maxX-minX),availableH/(maxY-minY)));
  cameraTo({scale,x:(box.width-(maxX-minX)*scale)/2-minX*scale,y:88+(availableH-(maxY-minY)*scale)/2-minY*scale});
}
function zoom(factor,cx=map.clientWidth/2,cy=map.clientHeight/2){if(layout==='graph'){zoomGraph(factor);return;}stopCamera();const old=data.view;const scale=Math.max(.25,Math.min(2.5,old.scale*factor));data.view={x:cx-(cx-old.x)*scale/old.scale,y:cy-(cy-old.y)*scale/old.scale,scale};applyView();}
function select(id,type='item',focusTitle=false){stopCamera();selected=id;panel=type;graphSelected=graph.nodes.find(n=>n.kind===type&&n.entityId===id)?.id||null;render();if(focusTitle){const title=$(type==='direction'?'#direction-title':'#item-title');title?.focus();title?.select();}}
function closePanel(){selected=null;panel=null;graphSelected=null;render();}
function place(node,entry){node.style.left=`${entry.x}px`;node.style.top=`${entry.y}px`;}
function renderLines(){const svg=$('#connections');svg.replaceChildren();for(const item of itemsInView()){const d=data.directions.find(d=>d.id===item.directionId);if(!d)continue;const x1=d.x+24,y1=d.y+66,x2=item.x+16,y2=item.y+23;const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',`M ${x1} ${y1} C ${x1} ${y2}, ${x2-60} ${y2}, ${x2} ${y2}`);line.setAttribute('stroke',d.color);if(item.id===selected||d.id===selected||item.focus)line.classList.add('active');svg.append(line);}}
function render(){
  const visible=itemsInView();nodes.replaceChildren();
  for(const d of directionsInView()){
    const node=el('button',{class:`direction${selected===d.id?' selected':''}`,'data-id':d.id,'data-kind':'direction','aria-label':`${d.title}，拖动方向或点击查看`});node.style.setProperty('--color',d.color);place(node,d);
    const copy=el('div');copy.append(el('h2',{},d.title),el('small',{},`${data.items.filter(i=>i.directionId===d.id).length} 个事项 · 长期方向`));node.append(el('span',{class:'direction-mark'}),copy);nodes.append(node);
  }
  for(const item of visible){
    const color=data.directions.find(d=>d.id===item.directionId)?.color||'#a4aeb4';
    const node=el('button',{class:`node${selected===item.id?' selected':''}${item.focus?' focused':''}`,'data-id':item.id,'data-kind':'item','aria-label':`${item.title}，${STATUS[item.status]}，${item.next}`});node.style.setProperty('--color',color);place(node,item);
    const copy=el('span',{class:'node-copy'}),meta=el('span',{class:'node-meta'});
    if(item.focus)meta.append(el('span',{class:'focus-label'},'★ 重点'));meta.append(el('span',{class:`state-${item.status}`},STATUS[item.status]));if(item.threadIds.length)meta.append(el('span',{class:'linked-count'},`${item.threadIds.length} 个任务`));
    copy.append(el('span',{class:'node-title'},item.title),meta,el('span',{class:'node-next'},`→ ${item.next||'补充下一步'}`));node.append(el('span',{class:'dot'}),copy);nodes.append(node);
  }
  renderLines();applyView();$('#empty').hidden=visible.length>0||directionsInView().length>0;
  $('#focus-count').textContent=visibleItems(data,'focus').length;$('#pending-count').textContent=visibleItems(data,'pending').length;$('#inbox-count').textContent=data.items.filter(i=>i.directionId===null&&i.status!=='done').length;
  $('#map-count').textContent=`${directionsInView().length} 个方向 / ${visible.length} 个事项`;
  $('#view-title').textContent=descriptions[mode][0];$('#view-description').textContent=descriptions[mode][1];
  root.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
  const nav=$('#direction-nav');nav.replaceChildren();
  for(const d of data.directions){const b=el('button',{title:`定位${d.title}`});b.style.setProperty('--color',d.color);b.append(el('i'),document.createTextNode(d.title));b.onclick=()=>select(d.id,'direction');nav.append(b);}
  const addDirection=el('button',{title:'新建工作方向'},'＋ 方向');addDirection.onclick=()=>{panel='new-direction';selected=null;render();$('#direction-title').focus();};nav.append(addDirection);
  $('#undo').disabled=!history.length;renderPanel();renderOutline();renderGraph();
  const home=$('#home-focus');if(home){home.style.left='885px';home.style.top='465px';home.hidden=mode!=='all'||!!query||data.directions.length===0;}
}
function field(label,node){const l=el('label',{class:'field'});l.append(el('span',{},label),node);return l;}
function input(id,value='',attrs={}){const n=el('input',{id,...attrs});n.value=value;return n;}
function selectInput(id,options,value){const s=el('select',{id});for(const [v,label]of options)s.append(el('option',{value:v},label));s.value=value;return s;}
function titleInput(value=''){return input('item-title',value,{required:'',maxlength:'100',autocomplete:'off'});}
function panelHeader(label){const header=el('div',{class:'panel-top'}),close=el('button',{'aria-label':'关闭详情'},'×');close.onclick=closePanel;header.append(el('span',{},label),close);inspector.append(header);}
function panelError(error){$('#form-error').textContent=error.message;}
function renderPanel(){
  inspector.hidden=!panel;shell.classList.toggle('has-inspector',!!panel);if(!panel)return;inspector.replaceChildren();
  if(panel==='thread'||panel==='graph-record'){
    const record=graph.nodes.find(n=>n.id===graphSelected);panelHeader(panel==='thread'?'关联会话':'CortexDB 记录');inspector.append(el('h2',{},record?.title||selected),el('p',{class:'panel-hint'},'来源 · CortexDB RDF'),el('p',{class:'memory-source'},record?.id||''));
    const links=graph.edges.filter(e=>e.target===record?.id||e.source===record?.id).map(e=>graph.nodes.find(n=>n.id===(e.source===record.id?e.target:e.source))).filter(n=>n?.kind==='item');inspector.append(el('h3',{class:'section-label'},`关联事项 · ${links.length}`));for(const item of links){const b=el('button',{class:'thread-link-button'},item.title);b.onclick=()=>{graphSelected=item.id;select(item.entityId);};inspector.append(b);}if(panel==='thread'){const open=el('button',{id:'graph-open-thread',class:'primary'},'打开会话');open.onclick=()=>bridge.openThread?.(record.entityId);inspector.append(open);}return;
  }
  if(panel==='direction'||panel==='new-direction'){
    const d=data.directions.find(d=>d.id===selected);panelHeader(d?'工作方向':'新建工作方向');
    const form=el('form'),name=input('direction-title',d?.title||'',{required:'',maxlength:'40'});form.append(field('方向名称',name));
    form.append(el('p',{class:'panel-hint'},'方向是长期分类。拖动方向标题，会带着所属事项一起移动。'));
    const submit=el('button',{type:'submit',class:'primary'},d?'保存方向':'创建方向'),actions=el('div',{class:'panel-actions'});actions.append(submit);form.append(actions);inspector.append(form);
    form.onsubmit=e=>{e.preventDefault();if(!name.value.trim())return;let next=structuredClone(data);if(d)next.directions.find(v=>v.id===d.id).title=name.value.trim();else{const box=map.getBoundingClientRect();const dir={id:crypto.randomUUID(),title:name.value.trim(),color:'#9cc9eb',x:(box.width/2-data.view.x)/data.view.scale,y:(box.height/2-data.view.y)/data.view.scale};next.directions.push(dir);selected=dir.id;panel='direction';}commit(next,'方向已保存');};
    if(d){const remove=el('button',{type:'button',class:'danger'},'移除方向，事项转为未整理');remove.onclick=()=>{const next=removeDirection(data,d.id);panel=null;selected=null;commit(next,'方向已移除，事项与备注保留，可撤销');};inspector.append(remove);const list=el('div',{class:'direction-list'});const children=data.items.filter(i=>i.directionId===d.id);inspector.append(el('h3',{class:'section-label'},`方向内的事项 · ${children.length}`));for(const i of children){const b=el('button');b.append(document.createTextNode(i.title),el('small',{},STATUS[i.status]));b.onclick=()=>select(i.id);list.append(b);}inspector.append(list);const add=el('button',{class:'primary',style:'margin-top:20px'},'＋ 在这个方向记一件事');add.onclick=()=>openNew(d.id);inspector.append(add);}
    return;
  }
  const isNew=panel==='new',item=isNew?draft:data.items.find(i=>i.id===selected);if(!item){closePanel();return;}
  panelHeader(isNew?'快速记录':'工作事项');
  const form=el('form'),title=titleInput(item.title),next=input('item-next',item.next,{maxlength:'160'}),direction=selectInput('item-direction',[['','未整理'],...data.directions.map(d=>[d.id,d.title])],item.directionId||''),status=selectInput('item-status',Object.entries(STATUS),item.status),focus=input('item-focus','',{type:'checkbox'});focus.checked=!!item.focus;
  form.append(field('事项名称',title),field('下一步做什么',next));const row=el('div',{class:'field-row'});row.append(field('工作方向',direction),field('状态',status));form.append(row);
  const focusLabel=el('label',{class:'check'});focusLabel.append(focus,document.createTextNode('标为当前重点'));form.append(focusLabel);const note=el('textarea',{id:'item-note',rows:'3',maxlength:'2000'});note.value=item.note||'';form.append(field('补充说明',note));
  form.append(el('div',{id:'form-error',class:'error-text',role:'alert'}));const actions=el('div',{class:'panel-actions'}),save=el('button',{type:'submit',class:'primary'},isNew?'添加到地图':'保存修改');actions.append(save);
  if(!isNew){const remove=el('button',{type:'button',class:'danger'},'移出地图');remove.onclick=()=>{panel=null;selected=null;commit(removeItem(data,item.id),'已移出地图，可撤销。关联的 Codex 任务不受影响。');};actions.append(remove);}form.append(actions);inspector.append(form);
  form.onsubmit=e=>{e.preventDefault();try{if(!title.value.trim())throw new Error('请填写事项名称');const patch={title:title.value.trim(),next:next.value.trim(),directionId:direction.value||null,status:status.value,focus:focus.checked,note:note.value};if(isNew){const updated=addItem(data,{...draft,...patch});selected=updated.items.at(-1).id;panel='item';mode=patch.directionId? 'all':'inbox';commit(updated,'事项已加入地图');fit([data.items.at(-1)]);}else{commit(updateItem(data,item.id,patch),'修改已保存');}}catch(error){panelError(error);}};
  if(isNew){inspector.append(el('p',{class:'panel-hint',style:'margin-top:20px'},'可以只写一句话。事项独立保存，之后再关联 Codex 任务。'));return;}
  inspector.append(el('h3',{class:'section-label'},`关联 Codex 任务 · ${item.threadIds.length}`));
  if(!item.threadIds.length)inspector.append(el('p',{class:'panel-hint'},'尚未关联任务。这个事项仍可独立推进。'));
  for(const id of item.threadIds){const thread=data.catalog.find(t=>t.id===id);if(!thread)continue;const row=el('div',{class:'thread-row'});row.append(el('strong',{},thread.title));const buttons=el('div',{class:'row-actions'}),copy=el('button',{},'打开任务'),unlink=el('button',{},'解除关联');copy.onclick=()=>bridge.openThread?.(thread.id);unlink.onclick=()=>commitLinks(updateItem(data,item.id,{threadIds:item.threadIds.filter(v=>v!==id)}),'已解除关联，源任务保持不变');buttons.append(copy,unlink);row.append(buttons);inspector.append(row);}
  const link=el('button',{id:'thread-picker-open',class:'thread-link-button'},'＋ 搜索并关联任务');link.onclick=()=>openThreadPicker(item.id);inspector.append(link);
  inspector.append(el('p',{class:'panel-hint'},'关联任务只用于跳转。地图里的方向和进度由你维护，不随聊天频繁变化。'));
}
function commitLinks(next,message){
  const fields=[...inspector.querySelectorAll('input,select,textarea')].map(n=>({id:n.id,value:n.value,checked:n.checked}));
  commit(next,message);
  for(const field of fields){const node=$(`#${field.id}`);if(node){node.value=field.value;if(node.type==='checkbox')node.checked=field.checked;}}
}
const threadDialog=$('#thread-dialog');
let picker=null,pickerTimer,pickerRequest=0;
function closeThreadPicker(){clearTimeout(pickerTimer);pickerRequest++;picker=null;threadDialog.close();$('#thread-picker-open')?.focus();}
function updateThreadSelection(){
  const count=picker?.choices.size||0;$('#thread-selection-count').textContent=count?`已选择 ${count} 个任务`:'未选择任务';
  $('#thread-clear').disabled=!count;$('#thread-confirm').disabled=!count;
}
function renderThreadResults(){
  const list=$('#thread-results'),scrollTop=list.scrollTop;list.replaceChildren();list.setAttribute('aria-busy',String(picker.busy));
  const linked=new Set(data.items.find(i=>i.id===picker.itemId)?.threadIds||[]);
  for(const thread of picker.rows){
    const exists=linked.has(thread.id),chosen=picker.choices.has(thread.id);
    const row=el('label',{class:`thread-choice${chosen?' chosen':''}${exists?' linked':''}`});
    const check=el('input',{type:'checkbox','data-thread-id':thread.id,'aria-label':thread.title});check.checked=exists||chosen;check.disabled=exists;
    const copy=el('span',{class:'thread-choice-copy'});copy.append(el('strong',{},thread.title));
    const date=thread.updatedAt?new Date(thread.updatedAt):null;
    const meta=[thread.projectName||'未归属项目',thread.archived?'已归档':'',date&&!Number.isNaN(date.getTime())?date.toLocaleDateString('zh-CN'):''].filter(Boolean).join(' · ');
    copy.append(el('small',{title:thread.cwd||''},meta));row.append(check,copy);if(exists)row.append(el('span',{class:'thread-choice-state'},'已关联'));
    check.onchange=()=>{if(check.checked)picker.choices.set(thread.id,thread);else picker.choices.delete(thread.id);row.classList.toggle('chosen',check.checked);updateThreadSelection();};list.append(row);
  }
  if(picker.error||!picker.rows.length)list.append(el('p',{class:'thread-result-message',role:picker.error?'alert':'status'},picker.error||(picker.busy?'正在读取本机任务…':'没有匹配的任务，换个关键词试试。')));
  $('#thread-result-count').textContent=picker.busy?'读取中…':picker.error?'读取失败':`共 ${picker.total} 个 · 已显示 ${picker.rows.length}`;
  $('#thread-retry').hidden=!picker.error;$('#thread-more').hidden=!picker.hasMore||!!picker.error;
  $('#thread-more').disabled=picker.busy;$('#thread-more').textContent=picker.busy?'读取中…':'加载更多';list.scrollTop=scrollTop;updateThreadSelection();
}
async function loadThreadPage(more=false){
  if(!picker)return;const active=picker,request=++pickerRequest;active.busy=true;active.error='';if(!more){active.rows=[];active.offset=0;active.hasMore=false;}renderThreadResults();
  try{
    if(typeof bridge.listThreads!=='function')throw new Error('本机任务目录尚未连接，请重启增强器后重试。');
    const result=await bridge.listThreads({query:$('#thread-search').value.trim(),limit:50,offset:active.offset,archived:$('#thread-archived').checked});
    if(!alive||picker!==active||request!==pickerRequest||!threadDialog.open)return;
    active.rows=[...new Map([...active.rows,...result.threads].map(t=>[t.id,t])).values()];active.offset+=result.threads.length;active.total=result.total;active.hasMore=result.hasMore;
  }catch(error){if(!alive||picker!==active||request!==pickerRequest||!threadDialog.open)return;active.error=error.message||'本机任务读取失败，请重试。';}
  if(picker===active&&request===pickerRequest){active.busy=false;renderThreadResults();}
}
function openThreadPicker(itemId){
  picker={itemId,choices:new Map(),rows:[],total:0,offset:0,hasMore:false,busy:false,error:''};
  $('#thread-search').value='';$('#thread-archived').checked=false;threadDialog.showModal();$('#thread-search').focus();loadThreadPage();
}
$('#thread-search').oninput=()=>{clearTimeout(pickerTimer);pickerRequest++;picker.rows=[];picker.total=0;picker.hasMore=false;picker.busy=true;picker.error='';renderThreadResults();pickerTimer=setTimeout(()=>loadThreadPage(),160);};
$('#thread-archived').onchange=()=>{clearTimeout(pickerTimer);loadThreadPage();};
$('#thread-more').onclick=()=>loadThreadPage(true);$('#thread-retry').onclick=()=>loadThreadPage(picker.offset>0);
$('#thread-dialog-close').onclick=closeThreadPicker;
threadDialog.addEventListener('cancel',e=>e.preventDefault());
$('#thread-clear').onclick=()=>{picker.choices.clear();for(const check of $('#thread-results').querySelectorAll('input:not(:disabled)')){check.checked=false;check.closest('label').classList.remove('chosen');}updateThreadSelection();};
$('#thread-confirm').onclick=()=>{
  if(!picker?.choices.size)return;
  try{const count=picker.choices.size;commitLinks(attachThreads(data,picker.itemId,[...picker.choices.values()]),`已关联 ${count} 个任务`);closeThreadPicker();}
  catch(error){picker.error=error.message;renderThreadResults();}
};
let draft={};
function openNew(directionId=null,position=null){draft={title:'',next:'',directionId,status:'idea',focus:false,note:'',...(position||{})};panel='new';selected=null;render();$('#item-title').focus();}
nodes.addEventListener('click',e=>{if(suppressClick)return;const node=e.target.closest('[data-id]');if(node)select(node.dataset.id,node.dataset.kind,e.detail>=2);});
nodes.addEventListener('dblclick',e=>{const node=e.target.closest('[data-id]');if(node){e.stopPropagation();select(node.dataset.id,node.dataset.kind,true);}});
let suppressClick=false;
map.addEventListener('pointerdown',e=>{stopCamera();if(layout!=='map'||e.button!==0||e.target.closest('.canvas-controls,#direction-nav,.map-caption,#empty,.scene-tools,#outline-list'))return;const node=e.target.closest('[data-id]');drag={id:node?.dataset.id,kind:node?.dataset.kind,x:e.clientX,y:e.clientY,before:structuredClone(data),moved:false};});
map.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;map.setPointerCapture(e.pointerId);map.classList.add('dragging');if(!drag.id){data.view={...drag.before.view,x:drag.before.view.x+dx,y:drag.before.view.y+dy};applyView();return;}const s=drag.before.view.scale;if(drag.kind==='direction')data=moveDirection(drag.before,drag.id,dx/s,dy/s);else{const orig=drag.before.items.find(i=>i.id===drag.id);data=updateItem(drag.before,drag.id,{x:orig.x+dx/s,y:orig.y+dy/s});}for(const node of nodes.children){const entry=(node.dataset.kind==='direction'?data.directions:data.items).find(i=>i.id===node.dataset.id);if(entry)place(node,entry);}renderLines();});
function finishDrag(){if(!drag)return;if(drag.moved){if(drag.id){history.push(drag.before);if(history.length>30)history.shift();$('#undo').disabled=false;}persist();suppressClick=true;setTimeout(()=>suppressClick=false,0);}drag=null;map.classList.remove('dragging');}
map.addEventListener('pointerup',finishDrag);map.addEventListener('pointercancel',finishDrag);
map.addEventListener('dblclick',e=>{if(layout!=='map')return;if(e.target.closest('button,input,.scene-tools,#outline-list'))return;const box=map.getBoundingClientRect();openNew(null,{x:(e.clientX-box.left-data.view.x)/data.view.scale,y:(e.clientY-box.top-data.view.y)/data.view.scale});});
map.addEventListener('wheel',e=>{if(layout!=='map')return;if(e.target.closest('#outline-list'))return;e.preventDefault();const box=map.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-box.left,e.clientY-box.top);clearTimeout(wheelTimer);wheelTimer=setTimeout(persist,180);},{passive:false});let wheelTimer;
$('#capture').onclick=()=>openNew();$('#empty-add').onclick=()=>openNew();$('#fit').onclick=()=>fit();$('#zoom-in').onclick=()=>{zoom(1.2);if(layout!=='graph')persist();};$('#zoom-out').onclick=()=>{zoom(1/1.2);if(layout!=='graph')persist();};
$('#undo').onclick=()=>{if(!history.length)return;data=history.pop();if(selected&&!data.items.some(i=>i.id===selected)&&!data.directions.some(d=>d.id===selected)){panel=null;selected=null;}persist();render();scheduleIndex();toast('已撤销');};
root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;panel=null;selected=null;render();fit();});
$('#search').addEventListener('input',e=>{query=e.target.value;render();fit();});
$('#export').onclick=()=>{$('#export-json').value=JSON.stringify(data,null,2);$('#export-dialog').showModal();};
$('#export-close').onclick=()=>$('#export-dialog').close();
$('#export-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#export-json').value);toast('地图 JSON 已复制。');}catch{$('#export-json').focus();$('#export-json').select();toast('请按 Ctrl+C 复制选中的 JSON。');}};
$('#export-download').onclick=()=>{const blob=new Blob([$('#export-json').value],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a',{href:url,download:'任务地图.json'});root.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已请求下载；也可复制 JSON 保存。');};
$('#arrange').onclick=()=>{const next=structuredClone(data);for(const d of next.directions){next.items.filter(i=>i.directionId===d.id).forEach((item,index)=>{item.x=d.x+70;item.y=d.y+115+index*110;});}commit(next,'已整理分支，方向位置保持不变');fit();};
root.addEventListener('keydown',e=>{
  e.stopPropagation();
  if(e.key==='Escape'){e.preventDefault();return;}
  if(threadDialog.open||$('#export-dialog').open||memoryDialog.open)return;
  if(e.key==='Tab'){const focusables=[...root.querySelectorAll('button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter(n=>!n.closest('[hidden]')&&n.getClientRects().length);const first=focusables[0],last=focusables.at(-1);if(e.shiftKey&&root.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&root.activeElement===last){e.preventDefault();first?.focus();}return;}if(e.target.closest('input,textarea,select'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('#undo').click();return;}if(e.key==='/'){e.preventDefault();$('#search').focus();return;}if(e.key.toLowerCase()==='n'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();openNew();return;}const node=e.target.closest('[data-id]');if(layout==='map'&&node&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const n=e.shiftKey?40:10,dx=e.key==='ArrowLeft'?-n:e.key==='ArrowRight'?n:0,dy=e.key==='ArrowUp'?-n:e.key==='ArrowDown'?n:0;const id=node.dataset.id;if(node.dataset.kind==='direction')commit(moveDirection(data,id,dx,dy));else{const i=data.items.find(i=>i.id===id);commit(updateItem(data,id,{x:i.x+dx,y:i.y+dy}));}nodes.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();}});
// Codex window shortcuts may consume Escape keydown; keyup remains available.
root.addEventListener('keyup',e=>{e.stopPropagation();if(e.key!=='Escape')return;e.preventDefault();if(memoryDialog.open)closeMemory();else if(threadDialog.open)closeThreadPicker();else if($('#export-dialog').open)$('#export-dialog').close();else if(panel)closePanel();else bridge.close?.();});
function renderOutline(){
 const list=$('#outline-list');list.replaceChildren();const visible=itemsInView();
 for(const direction of [...data.directions,{id:null,title:'未整理'}]){
  const items=visible.filter(i=>i.directionId===direction.id);if(!items.length&&(mode!=='all'||query||direction.id===null))continue;
  const section=el('section',{class:'outline-group'}),header=el('div',{class:'group-heading'}),title=el('button',{class:'group-title'},direction.title);
  title.onclick=()=>direction.id?select(direction.id,'direction'):openNew();header.append(title,el('span',{class:'group-count'},`${items.length} 个事项`));
  const add=el('button',{'aria-label':`在${direction.title}添加事项`,class:'group-add'},'＋ 添加');add.onclick=()=>openNew(direction.id);header.append(add);section.append(header);
  if(!items.length)section.append(el('p',{class:'group-empty'},'这个方向还没有事项。可以在这里记录下一步。'));
  for(const item of items){
   const row=el('button',{class:`outline-row${selected===item.id?' selected':''}`,'data-id':item.id,'data-kind':'item'}),copy=el('span',{class:'outline-copy'}),meta=el('span',{class:'outline-meta'});
   copy.append(el('strong',{},item.title),el('span',{class:'outline-next'},`下一步 · ${item.next||'尚未填写'}`));
   if(item.note)copy.append(el('span',{class:'outline-note'},item.note));
   const titles=item.threadIds.map(id=>data.catalog.find(t=>t.id===id)?.title).filter(Boolean);
   if(titles.length)copy.append(el('span',{class:'outline-threads'},`关联会话 · ${titles.join('、')}`));
   if(item.focus)meta.append(el('span',{class:'focus-label'},'★ 重点'));meta.append(el('span',{class:`state-${item.status}`},STATUS[item.status]));row.append(copy,meta);row.onclick=()=>select(item.id);section.append(row);
  }
  list.append(section);
 }
 if(!list.children.length){const empty=el('div',{class:'list-empty'});empty.append(el('h2',{},query?'没有匹配的事项':'这里还没有事项'),el('p',{},query?'试试标题、备注、下一步或关联会话名称。':'先记一件事，再决定它属于哪个方向。'));const add=el('button',{class:'primary'},'＋ 记一件事');add.onclick=()=>openNew();empty.append(add);list.append(empty);}
}
$('#outline-toggle').onclick=()=>setLayout('map');
let indexTimer,indexBusy=false,indexAgain=false,indexRequest=0,memoryRequest=0;
const memoryDialog=$('#memory-dialog');
memoryDialog.addEventListener('cancel',e=>e.preventDefault());
function indexState(state,message){$('#index-status').dataset.state=state;$('#index-status').textContent=message;$('#index-sync').disabled=state==='busy';}
async function syncIndex(){
 if(!storageOK){indexState('error','地图记录读取失败，未更新索引。请先导出临时修改并恢复本地记录。');graphError='地图记录读取失败，未同步';renderGraph();return;}
 if(!indexSafe){indexState('error','地图修改尚未保存，未更新索引。请先成功保存或导出保留。');graphError='地图修改尚未保存，未同步';renderGraph();return;}
 if(indexBusy){indexAgain=true;return;}indexBusy=true;const request=++indexRequest;indexState('busy','正在更新本机索引…');
 try{if(typeof bridge.syncIndex!=='function')throw new Error('索引桥尚未连接');const result=await bridge.syncIndex(structuredClone(data));if(!alive||request!==indexRequest)return;indexState('ready',`已索引 ${result.itemCount} 个事项 · ${result.threadCount} 个会话`);$('#index-time').textContent=result.indexedAt?`更新于 ${new Date(result.indexedAt).toLocaleString('zh-CN')}`:'';await refreshGraph();}
 catch(error){if(alive&&request===indexRequest){indexState('error',`索引未更新 · ${error.message||'请求失败'}。地图仍可使用。`);graphError=`索引未同步 · ${error.message||'请求失败'}`;renderGraph();}}
 finally{indexBusy=false;if(alive&&indexAgain){indexAgain=false;scheduleIndex();}}
}
function scheduleIndex(){if(!storageOK||!indexSafe)return;clearTimeout(indexTimer);indexTimer=setTimeout(syncIndex,450);}
function closeMemory(){memoryRequest++;$('#memory-submit').disabled=false;$('#memory-results').setAttribute('aria-busy','false');memoryDialog.close();$('#memory-open').focus();}
$('#memory-close').onclick=closeMemory;
$('#memory-open').onclick=()=>{memoryDialog.showModal();$('#memory-query').focus();};
$('#index-sync').onclick=syncIndex;
$('#memory-form').onsubmit=async e=>{
 e.preventDefault();const searchQuery=$('#memory-query').value.trim();if(!searchQuery)return;const request=++memoryRequest,list=$('#memory-results');list.replaceChildren();list.setAttribute('aria-busy','true');$('#memory-submit').disabled=true;$('#memory-state').textContent='正在检索本机索引…';
 try{if(typeof bridge.searchMemory!=='function')throw new Error('检索桥尚未连接');const result=await bridge.searchMemory({query:searchQuery,limit:8});if(!alive||request!==memoryRequest)return;
  const rows=result.results||[];$('#memory-state').textContent=rows.length?`${rows.length} 条结果`:'没有匹配结果。请换一个关键词，或先更新索引。';
  for(const row of rows){const article=el('article',{class:'memory-result'});article.append(el('h3',{},row.title||'索引记录'),el('p',{class:'memory-content'},row.content||''),el('small',{class:'memory-source'},`来源 · ${row.source||'索引未提供来源'}`));const actions=el('div',{class:'row-actions'});
   if(row.itemId&&data.items.some(i=>i.id===row.itemId)){const locate=el('button',{},'定位事项');locate.onclick=()=>{closeMemory();mode='all';query='';$('#search').value='';select(row.itemId);if(layout==='map')fit([data.items.find(i=>i.id===row.itemId)]);else listItem(row.itemId);};actions.append(locate);}
   for(const id of row.threadIds||[]){const open=el('button',{},`打开会话 · ${data.catalog.find(t=>t.id===id)?.title||id}`);open.onclick=()=>bridge.openThread?.(id);actions.append(open);}article.append(actions);list.append(article);
  }
 }catch(error){if(alive&&request===memoryRequest)$('#memory-state').textContent=`检索失败 · ${error.message||'请求失败'}。可重试，地图记录不受影响。`;}
 finally{if(alive&&request===memoryRequest){list.setAttribute('aria-busy','false');$('#memory-submit').disabled=false;}}
};
function listItem(id){$('#outline-list').querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:'nearest'});}
let lastSize='';const resize=new ResizeObserver(()=>{const size=map.clientWidth+'x'+map.clientHeight;if(!lastSize){lastSize=size;return;}if(size!==lastSize){lastSize=size;if(!drag&&!panel&&alive){if(layout==='map')fit();else if(layout==='graph')fitGraph();}}});resize.observe(map);
render();if(storageOK)scheduleIndex();if(storageOK)$('#save-state').textContent='已保存在 Codex 本机';if(!loaded)requestAnimationFrame(()=>{if(alive)fit();});
$('#close-global-map').focus();
return {getState:()=>structuredClone(data),getGraphState:()=>structuredClone({graph,loaded:graphLoaded,busy:graphBusy,error:graphError,selected:graphSelected,view:graphView,layout}),setLayout,refreshGraph:syncIndex,destroy(){alive=false;graphRequest++;indexRequest++;memoryRequest++;clearTimeout(indexTimer);stopCamera();clearTimeout(wheelTimer);clearTimeout(toastTimer);clearTimeout(pickerTimer);pickerRequest++;picker=null;persist();resize.disconnect();scenery.destroy();reducedMotion.removeEventListener('change',onMotionChange);root.replaceChildren();}};
}


window.__codexGlobalTaskMap={mount(root,bridge){root.innerHTML="<style>\n:host{color-scheme:var(--codex-ui-color-scheme,dark);--bg:var(--codex-ui-main,var(--color-token-main-surface-primary,#181a1b));--surface:var(--codex-ui-surface,var(--color-background-panel,#202224));--raised:var(--codex-ui-surface-raised,var(--color-background-primary-soft-alpha,#2b2e31));--line:var(--codex-ui-border,var(--color-token-border,#383c40));--text:var(--codex-ui-text,var(--color-token-text-primary,#eceef0));--muted:var(--codex-ui-muted,var(--color-token-text-secondary,#a8aeb4));--accent:var(--codex-ui-accent,#a7c9e9);font:14px/1.5 var(--font-family,system-ui,\"Segoe UI\",\"Microsoft YaHei UI\",sans-serif)}\n*{box-sizing:border-box} [hidden]{display:none!important}h1,h2,h3,p{margin:0}button,input,select,textarea{font:inherit;color:inherit}button{min-height:36px;padding:7px 10px;border:1px solid transparent;border-radius:7px;background:transparent;cursor:pointer}button:hover{background:var(--raised)}button:active{background:var(--line)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,#map:focus-visible{outline:2px solid var(--accent);outline-offset:2px}input,textarea,select{background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:9px 10px;width:100%;min-width:0}textarea{resize:vertical}.primary{background:var(--accent);color:#172532;font-weight:600}.primary:hover{background:color-mix(in srgb,var(--accent) 85%,white)}.danger,.error-text,#save-state.error,[data-state=error]{color:var(--color-text-danger,#e3a397)}\n.native-host{height:100%;min-height:0;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:hidden}.app-header{display:flex;gap:12px;justify-content:space-between;align-items:center;min-height:64px;padding:12px 20px;border-bottom:1px solid var(--line);flex-shrink:0}.brand,.header-actions{display:flex;align-items:center;gap:8px;min-width:0}.brand svg{display:none}h1{font-size:18px;font-weight:650;white-space:nowrap}#save-state{font-size:12px;color:var(--muted);margin-right:8px}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 20px;border-bottom:1px solid var(--line)}.view-tabs{display:flex;gap:4px}.view-tabs button{color:var(--muted);white-space:nowrap}.view-tabs button[aria-pressed=true]{color:var(--text);background:var(--raised)}.view-tabs span{font-size:11px;margin-left:4px;font-variant-numeric:tabular-nums}.search{display:flex;align-items:center;gap:8px;min-width:160px;width:280px}.search svg{flex-shrink:0;fill:none;stroke:var(--muted)}.search input{border:0;padding:6px 0;background:transparent}.search kbd{color:var(--muted);border:1px solid var(--line);padding:0 4px;border-radius:3px;font-size:12px}\nmain{display:flex;flex:1;min-height:0;position:relative}#map{position:relative;flex:1;min-width:0;overflow:hidden;touch-action:none;cursor:grab}#world{position:absolute;width:1px;height:1px;transform-origin:0 0}#connections{position:absolute;overflow:visible;width:1px;height:1px;pointer-events:none}#connections path{fill:none;stroke-width:1.3;opacity:.35}#connections path.active{opacity:.85}.map-caption{position:absolute;top:20px;left:24px;right:24px;display:flex;justify-content:space-between;gap:16px;pointer-events:none}.map-caption strong{font-size:16px;font-weight:600}.map-caption span{display:block;color:var(--muted);font-size:12px;margin-top:4px}.scene-tools{position:absolute;right:20px;top:16px;z-index:2}#outline-toggle{border-color:var(--line);background:var(--surface)}#map-count{margin-right:105px;white-space:nowrap}\n#outline-list{position:absolute;inset:90px 20px 70px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;cursor:default;touch-action:auto}.outline-group{margin-bottom:26px}.group-heading{display:flex;gap:8px;align-items:center;padding-bottom:10px;border-bottom:1px solid var(--line)}.group-title{font-size:15px;font-weight:650;padding-left:0;text-align:left;overflow-wrap:anywhere}.group-count{color:var(--muted);font-size:12px;white-space:nowrap}.group-add{margin-left:auto;color:var(--muted)}.outline-row{width:100%;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:14px 12px;text-align:left;border-radius:6px;border-bottom:1px solid var(--line);white-space:normal}.outline-row.selected{background:var(--raised)}.outline-copy{display:flex;flex-direction:column;gap:4px;min-width:0}.outline-copy strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}.outline-next{color:var(--text);font-size:13px;overflow-wrap:anywhere}.outline-note{color:var(--muted);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.outline-threads{font-size:11px;color:var(--muted);overflow-wrap:anywhere}.outline-meta{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;flex-shrink:0;padding-top:2px}.focus-label{color:var(--accent)}.state-doing{color:var(--accent)}.state-done{color:var(--codex-ui-positive,#96c7ad)}.state-waiting{color:var(--codex-ui-warning,#dbb483)}.group-empty{padding:16px 12px;color:var(--muted);font-size:13px}.list-empty{text-align:center;padding:40px 20px}.list-empty h2{font-size:18px}.list-empty p{margin:10px 0 20px;color:var(--muted)}\n[data-layout=list] #world,[data-layout=list] .canvas-controls,[data-layout=list] #empty{display:none}[data-layout=map] #outline-list{display:none}[data-layout=list] #map{touch-action:auto;cursor:default}[data-layout=list] .gestures{display:none}\n.direction,.node{position:absolute;text-align:left;white-space:normal;user-select:none;cursor:grab;display:flex;gap:10px;width:280px;background:var(--surface);border:1px solid var(--line);padding:12px;border-radius:8px}.direction{width:300px;background:var(--bg);border-color:transparent}.direction h2{font-size:18px;overflow-wrap:anywhere}.direction small{color:var(--muted);font-size:12px}.direction-mark,.dot{width:8px;height:8px;flex-shrink:0;border-radius:50%;background:var(--color);margin-top:7px}.node.selected,.direction.selected{outline:2px solid var(--accent)}.node.focused{border-color:var(--accent)}.node-copy{min-width:0}.node-title{display:block;font-size:14px;font-weight:600;overflow-wrap:anywhere}.node-meta{display:flex;gap:8px;color:var(--muted);font-size:11px;margin:5px 0}.node-next{display:block;font-size:12px;color:var(--muted);overflow-wrap:anywhere}.compact .node-next{display:none}.canvas-controls{position:absolute;right:20px;bottom:16px;display:flex;align-items:center;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:3px;z-index:2}.canvas-controls output{font-size:12px;width:45px;text-align:center}.divider{width:1px;height:18px;background:var(--line)}#direction-nav{position:absolute;left:20px;bottom:16px;display:flex;gap:4px;max-width:calc(100% - 360px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:3px;z-index:2}#direction-nav button{display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12px}#direction-nav i{width:6px;height:6px;background:var(--color);border-radius:50%}[data-layout=list] #direction-nav{max-width:calc(100% - 40px)}#empty{position:absolute;inset:40% 20px auto;text-align:center}#empty h2{font-size:18px}#empty p{margin:8px 0 18px;color:var(--muted)}#inspector{width:340px;max-width:48%;padding:20px;background:var(--surface);border-left:1px solid var(--line);overflow:auto;flex-shrink:0;z-index:3}.panel-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:18px}.panel-top h2{font-size:18px}.panel-top>span{color:var(--muted);font-size:12px}.panel-top button{font-size:20px}.field{display:block;margin-bottom:16px}.field>span{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}.field-row{display:flex;gap:10px}.field-row>.field{width:50%}.check{display:flex;align-items:center;gap:8px;margin-bottom:16px}.check input{width:16px;height:16px;accent-color:var(--accent)}.panel-hint{font-size:12px;line-height:1.65;color:var(--muted)}.panel-actions{display:flex;gap:10px;justify-content:space-between;margin-top:20px}.section-label{font-size:12px;color:var(--muted);margin:24px 0 8px}.thread-row{padding:12px 0;border-bottom:1px solid var(--line)}.thread-row strong{display:block;font-size:13px;overflow-wrap:anywhere}.row-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.row-actions button{font-size:12px;border-color:var(--line);white-space:normal;text-align:left}.direction-list{display:flex;flex-direction:column;gap:6px}.direction-list button{text-align:left;white-space:normal}.direction-list small{display:block;color:var(--muted)}.error-text{min-height:18px;font-size:12px}.thread-link-button{width:100%;border-color:var(--line);margin:12px 0;text-align:left}\nfooter{flex-shrink:0;display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:8px 20px;color:var(--muted);font-size:11px}.footer-detail{display:none}#toast{position:absolute;bottom:50px;left:50%;transform:translateX(-50%);z-index:6;background:var(--text);color:var(--bg);padding:10px 14px;border-radius:8px;max-width:calc(100% - 40px);font-size:13px}\ndialog{background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:12px;width:min(680px,calc(100vw - 40px));max-height:calc(100dvh - 64px);padding:24px;overflow:auto}dialog::backdrop{background:#0008}#export-json{height:300px;font:12px/1.5 monospace;margin-top:16px}#thread-search{margin-bottom:12px}.thread-filters{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--muted);font-size:12px}.thread-filters .check{margin:0}#thread-results{min-height:160px;max-height:380px;overflow:auto;border-block:1px solid var(--line);margin-top:12px}.thread-choice{display:flex;align-items:flex-start;gap:10px;padding:12px 8px;border-bottom:1px solid var(--line);cursor:pointer}.thread-choice:hover,.thread-choice.chosen{background:var(--raised)}.thread-choice input{width:18px;height:18px;flex-shrink:0;accent-color:var(--accent);margin-top:4px}.thread-choice-copy{flex:1;min-width:0}.thread-choice strong{display:block;font-size:14px;overflow-wrap:anywhere}.thread-choice small{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.thread-choice-state{font-size:12px;color:var(--muted)}.thread-result-message{padding:30px 12px;text-align:center;color:var(--muted)}.thread-result-actions{display:flex;justify-content:center}.thread-picker-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;font-size:12px}.thread-picker-footer>div{display:flex;gap:6px}.index-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;margin:12px 0;border-block:1px solid var(--line);font-size:13px}#index-time{font-size:11px;color:var(--muted)}#index-sync{border-color:var(--line);white-space:nowrap}.memory-search{display:flex;gap:8px;margin-top:8px}.memory-search input{flex:1;min-width:0}#memory-submit{white-space:nowrap;flex:0 0 auto}#memory-state{font-size:12px;color:var(--muted);margin-top:14px}.memory-result{padding:16px 0;border-bottom:1px solid var(--line)}.memory-result h3{font-size:14px}.memory-content{font-size:13px;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.memory-source{font-size:11px;color:var(--muted);overflow-wrap:anywhere}\n@media(max-width:1000px){.app-header{padding:10px 14px}.toolbar{flex-wrap:wrap;padding:10px 14px}.search{width:100%}#save-state{display:none}#inspector{width:310px}#direction-nav{bottom:65px;max-width:calc(100% - 40px)}[data-layout=list] #direction-nav{bottom:16px}.gestures{display:none}}\n@media(max-width:650px){.app-header{flex-wrap:wrap;gap:6px}.brand{width:100%}.header-actions{width:100%;justify-content:flex-end;gap:4px}.header-actions button{font-size:12px;min-height:40px}h1{font-size:16px}.toolbar{gap:8px}.view-tabs{width:100%;overflow:auto}.view-tabs button{padding:6px 8px;font-size:12px;min-height:40px}.view-tabs span{margin-left:2px}.map-caption{top:16px;left:16px;right:16px}.map-caption strong{font-size:14px}.map-caption span{max-width:calc(100% - 90px)}#map-count{display:none}.scene-tools{right:12px;top:12px}#outline-list{inset:86px 12px 66px}.outline-row{gap:10px;padding:12px 6px}.outline-meta{flex-direction:column;align-items:flex-end}.group-title{font-size:14px}.group-count{font-size:11px}.group-add{padding:5px;font-size:12px}#inspector{position:absolute;inset:0 0 0 auto;max-width:100%;width:min(360px,100%)}#direction-nav{left:12px;max-width:calc(100% - 24px)}.canvas-controls{right:12px}.canvas-controls button{min-height:40px}footer{padding:7px 12px;font-size:10px}dialog{padding:18px;width:calc(100vw - 24px)}.thread-picker-footer{flex-wrap:wrap}.thread-picker-footer>div{margin-left:auto}.index-bar{align-items:flex-start}.memory-search button{flex-shrink:0}}\n@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}\n</style><div class=\"native-host\">\n<header class=\"app-header\">\n  <div class=\"brand\"><button id=\"close-global-map\" aria-label=\"返回对话\" title=\"返回对话\">←</button><svg viewBox=\"0 0 28 28\" width=\"28\" height=\"28\" aria-hidden=\"true\"><path d=\"M7 7 21 12 10 22Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"/><circle cx=\"7\" cy=\"7\" r=\"3\"/><circle cx=\"21\" cy=\"12\" r=\"3\"/><circle cx=\"10\" cy=\"22\" r=\"3\"/></svg><h1>全局任务地图</h1></div>\n  <div class=\"header-actions\"><span id=\"save-state\" role=\"status\">正在读取地图</span><button id=\"memory-open\">索引与检索</button><button id=\"export\">导出</button><button id=\"undo\" disabled title=\"Ctrl+Z\">撤销</button><button id=\"capture\" class=\"primary\">＋ 记一件事</button></div>\n</header>\n<nav class=\"toolbar\" aria-label=\"地图视角\">\n  <div class=\"view-tabs\"><button data-mode=\"all\" aria-pressed=\"true\">全局</button><button data-mode=\"focus\" aria-pressed=\"false\">当前重点 <span id=\"focus-count\"></span></button><button data-mode=\"pending\" aria-pressed=\"false\">待处理 <span id=\"pending-count\"></span></button><button data-mode=\"inbox\" aria-pressed=\"false\">未整理 <span id=\"inbox-count\"></span></button></div>\n  <label class=\"search\"><svg viewBox=\"0 0 20 20\" width=\"18\" height=\"18\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"5.5\"/><path d=\"m12 12 5 5\"/></svg><input id=\"search\" type=\"search\" placeholder=\"搜索标题、备注、下一步…\" aria-label=\"搜索地图事项\"><kbd>/</kbd></label>\n</nav>\n<main>\n  <section id=\"map\" aria-label=\"全局工作地图\" tabindex=\"0\">\n    \n    \n    <div class=\"map-caption\"><div><strong id=\"view-title\">把工作放回全局</strong><span id=\"view-description\">方向保持稳定，事项沿着方向推进。</span></div><span id=\"map-count\"></span></div>\n    <div id=\"world\"><svg id=\"connections\" aria-hidden=\"true\"></svg><div id=\"nodes\"></div></div>\n    <div id=\"empty\" hidden><h2>这里还没有事项</h2><p>先记下来，再决定放在哪个方向。</p><button id=\"empty-add\" class=\"primary\">＋ 记一件事</button></div>\n    <div id=\"direction-nav\" aria-label=\"定位方向\"></div>\n    <div class=\"scene-tools\"><button id=\"outline-toggle\" aria-pressed=\"false\">关系地图</button><button hidden id=\"motion-toggle\" aria-pressed=\"true\" title=\"暂停背景动效\">Ⅱ 动效</button></div>\n    <div id=\"outline-list\" aria-label=\"分组事项列表\"></div>\n    <div class=\"canvas-controls\"><button id=\"zoom-out\" aria-label=\"缩小\">−</button><output id=\"zoom-value\">100%</output><button id=\"zoom-in\" aria-label=\"放大\">＋</button><span class=\"divider\"></span><button id=\"fit\">适应</button><button id=\"arrange\">整理</button></div>\n  </section>\n  <aside id=\"inspector\" aria-label=\"事项详情\" hidden></aside>\n</main>\n<footer><span class=\"source-note\">事项与对话分开管理 <span class=\"footer-detail\">· 事项与对话分开管理</span></span><span class=\"gestures\">拖动平移 · 滚轮缩放 · 双击编辑</span><span class=\"signature\">仅本机保存</span></footer>\n<div id=\"toast\" role=\"status\" hidden></div>\n<dialog id=\"memory-dialog\" aria-labelledby=\"memory-title\">\n <div class=\"panel-top\"><h2 id=\"memory-title\">索引与检索</h2><button id=\"memory-close\" aria-label=\"关闭检索\">×</button></div>\n <p class=\"panel-hint\">CortexDB 仅索引地图与关联会话，用于查找；不会改写事项、进度或手动备注。</p>\n <div class=\"index-bar\"><div><p id=\"index-status\" role=\"status\">索引尚未更新</p><small id=\"index-time\"></small></div><button id=\"index-sync\">更新索引</button></div>\n <form id=\"memory-form\"><label for=\"memory-query\">检索地图与关联会话</label><div class=\"memory-search\"><input id=\"memory-query\" type=\"search\" required autocomplete=\"off\" placeholder=\"输入关键词…\"><button id=\"memory-submit\" class=\"primary\">检索</button></div></form>\n <p id=\"memory-state\" role=\"status\">输入关键词开始检索。</p><div id=\"memory-results\" aria-busy=\"false\"></div>\n</dialog><dialog id=\"export-dialog\" aria-labelledby=\"export-title\">\n  <div class=\"panel-top\"><h2 id=\"export-title\">导出任务地图</h2><button id=\"export-close\" aria-label=\"关闭导出\">×</button></div>\n  <p class=\"panel-hint\">包含方向、事项、任务关联与画布位置。可复制保存为 JSON 文件。</p>\n  <textarea id=\"export-json\" aria-label=\"地图 JSON\" readonly spellcheck=\"false\"></textarea>\n  <div class=\"panel-actions\"><button id=\"export-download\">下载 JSON</button><button id=\"export-copy\" class=\"primary\">复制 JSON</button></div>\n</dialog>\n<dialog id=\"thread-dialog\" aria-labelledby=\"thread-dialog-title\">\n  <div class=\"panel-top\"><div><h2 id=\"thread-dialog-title\">关联 Codex 任务</h2><p class=\"panel-hint\">搜索本机任务，支持一次选择多个。</p></div><button id=\"thread-dialog-close\" aria-label=\"关闭任务选择\">×</button></div>\n  <input id=\"thread-search\" type=\"search\" placeholder=\"搜索任务标题或项目路径…\" aria-label=\"搜索可关联任务\" autocomplete=\"off\">\n  <div class=\"thread-filters\"><label class=\"check\"><input id=\"thread-archived\" type=\"checkbox\">包含已归档</label><span id=\"thread-result-count\" role=\"status\"></span></div>\n  <div id=\"thread-results\" aria-label=\"可关联任务列表\" aria-busy=\"false\"></div>\n  <div class=\"thread-result-actions\"><button id=\"thread-retry\" hidden>重新读取</button><button id=\"thread-more\" hidden>加载更多</button></div>\n  <div class=\"thread-picker-footer\"><span id=\"thread-selection-count\" role=\"status\">未选择任务</span><div><button id=\"thread-clear\" disabled>清空选择</button><button id=\"thread-confirm\" class=\"primary\" disabled>关联所选任务</button></div></div>\n</dialog>\n\n</div>";return mountApp(root,bridge);}};
})();
