import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskMapIndex } from '../lib/cortexdb-task-map.mjs';
const dir = await mkdtemp(join(tmpdir(), 'cortexdb-task-map-'));
const index = new TaskMapIndex({ databasePath: join(dir, 'test.db') });
const data = { directions: [{id:'d1',title:'影视'}], items: [{id:'item-123',title:'示例短片',next:'动作设计',note:'测试中文索引',status:'active',category:'project',priority:'high',directionId:'d1',threadIds:['thread-abc']}], catalog:[{id:'thread-abc',title:'镜头开发'}] };
try {
  if (!process.env.CODEX_CORTEXDB_EXECUTABLE) {
    await assert.rejects(index.start(), /not configured/);
    console.log("Optional CortexDB integration is not configured; disabled-state check passed.");
  } else {
  assert.equal((await index.sync(data)).itemCount, 1);
  await index.sync(data);
  const visual = await index.graph();
  assert.equal(visual.nodes.length, 3);
  assert.equal(visual.edges.length, 2);
  assert.deepEqual(visual.nodes.find((node) => node.kind === 'item'), {id:'urn:codex-sidebar:task-map:item:item-123',kind:'item',entityId:'item-123',title:'示例短片',status:'active',category:'project',priority:'high'});
  assert.deepEqual(visual.edges.find((edge) => edge.kind === 'contains'), {source:'urn:codex-sidebar:task-map:direction:d1',target:'urn:codex-sidebar:task-map:item:item-123',kind:'contains'});
  assert.deepEqual(visual.edges.find((edge) => edge.kind === 'thread'), {source:'urn:codex-sidebar:task-map:item:item-123',target:'urn:codex-sidebar:task-map:thread:thread-abc',kind:'thread'});
  await index.tool('knowledge_graph_delete', {pattern:{subject:{kind:'iri',value:'urn:codex-sidebar:task-map:item:item-123'},predicate:{kind:'iri',value:'urn:codex-sidebar:task-map:title'},graph:{kind:'iri',value:'urn:codex-sidebar:task-map'}}});
  await index.tool('knowledge_graph_upsert', {triples:[{subject:{kind:'iri',value:'urn:codex-sidebar:task-map:item:item-123'},predicate:{kind:'iri',value:'urn:codex-sidebar:task-map:title'},object:{kind:'literal',value:'库内直接更新'},graph:{kind:'iri',value:'urn:codex-sidebar:task-map'}}]});
  assert.ok((await index.graph()).nodes.some((node) => node.title === '库内直接更新'));
  await index.sync(data);
  await index.tool('knowledge_save', {knowledge_id:'foreign-owner', content:'外部命名空间保留', collection:'external'});
  const graph = await index.tool('knowledge_graph_query', {query:'SELECT ?thread WHERE { GRAPH <urn:codex-sidebar:task-map> { <urn:codex-sidebar:task-map:item:item-123> <urn:codex-sidebar:task-map:thread> ?thread } }'});
  assert.equal(graph.result.bindings[0].thread.value, 'urn:codex-sidebar:task-map:thread:thread-abc');
  let results = (await index.search({query:'示例'})).results;
  assert.equal(results.length, 1);
  assert.equal(results[0].itemId, 'item-123');
  assert.deepEqual(results[0].threadIds, ['thread-abc']);
  assert.equal(results[0].source, 'codex-task-map://item/item-123');
  assert.equal((await index.search({query:'item-123'})).results.length, 1);
  data.items[0].title = '蓝鲸计划';
  await index.sync(data);
  assert.equal((await index.search({query:'蓝鲸'})).results.length, 1);
  assert.equal((await index.search({query:'示例'})).results.length, 0);
  index.close();
  const reopened = new TaskMapIndex({databasePath:join(dir,'test.db')});
  try {
    assert.equal((await reopened.graph()).nodes.find((node) => node.kind === 'item').title, '蓝鲸计划');
    await reopened.sync({...data, items:[]});
    assert.equal((await reopened.graph()).nodes.length, 1);
    assert.equal((await reopened.graph()).edges.length, 0);
    assert.equal((await reopened.search({query:'蓝鲸'})).results.length, 0);
    assert.equal((await reopened.tool('knowledge_get', {knowledge_id:'foreign-owner'})).knowledge.id, 'foreign-owner');
  } finally { reopened.close(); }
  const interrupted = new TaskMapIndex({databasePath:join(dir,'test.db')});
  const tool = interrupted.tool.bind(interrupted);
  interrupted.tool = (name, args) => {
    if (name === 'knowledge_graph_upsert' && args.triples.some((triple) => triple.graph?.value === 'urn:codex-sidebar:task-map')) throw new Error('Injected graph commit failure');
    return tool(name, args);
  };
  try {
    await assert.rejects(interrupted.sync(data), /Injected graph commit failure/);
    assert.equal((await interrupted.search({query:'蓝鲸'})).results.length, 1);
  } finally { interrupted.close(); }
  const recovered = new TaskMapIndex({databasePath:join(dir,'test.db')});
  try {
    await recovered.sync({...data, items:[]});
    assert.equal((await recovered.search({query:'蓝鲸'})).results.length, 0);
    assert.equal((await recovered.tool('knowledge_get', {knowledge_id:'foreign-owner'})).knowledge.id, 'foreign-owner');
    const ledger = await recovered.tool('knowledge_graph_query', {query:'SELECT ?item WHERE { GRAPH <urn:codex-sidebar:task-map:ledger> { ?item ?predicate ?value } }'});
    assert.equal((ledger.result.bindings || []).length, 0);
  } finally { recovered.close(); }
  console.log('PASS: real CortexDB RDF graph (3 nodes/2 edges), direct DB update/restart read, sync/search/update/delete, interrupted commit recovery and namespace isolation');
  }
} finally { index.close(); await new Promise(r=>setTimeout(r,150)); await rm(dir, {recursive:true,force:true}); }
