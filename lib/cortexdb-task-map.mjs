import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const COLLECTION = 'codex-task-map';
const GRAPH = 'urn:codex-sidebar:task-map';
const LEDGER = `${GRAPH}:ledger`;
const iri = (value) => ({ kind: 'iri', value });
const literal = (value) => ({ kind: 'literal', value: String(value) });
const itemKey = (id) => `${GRAPH}:item:${encodeURIComponent(id)}`;

export class TaskMapIndex {
  constructor({ executable = process.env.CODEX_CORTEXDB_EXECUTABLE || '', databasePath = join(process.env.LOCALAPPDATA || '.', 'CodexSidebarEnhancer', 'task-map.cortexdb.db') } = {}) {
    this.executable = executable;
    this.databasePath = databasePath;
    this.pending = new Map();
    this.sequence = 0;
    this.queue = Promise.resolve();
  }

  async start() {
    if (!this.executable) throw new Error('CortexDB is not configured; set CODEX_CORTEXDB_EXECUTABLE to enable the optional index');
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await mkdir(dirname(this.databasePath), { recursive: true });
      const env = { ...process.env, CORTEXDB_PATH: this.databasePath };
      // This index is strictly local lexical retrieval, independent of agent provider settings.
      for (const key of Object.keys(env)) if (/^CORTEXDB_(REMOTE|GRPC|EMBED|LLM|RERANK|QUERY_REWRITE)/.test(key) || ['OPENAI_BASE_URL', 'OPENAI_API_KEY'].includes(key)) delete env[key];
      this.child = spawn(this.executable, [], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const fail = (error) => { for (const request of this.pending.values()) request.reject(error); this.pending.clear(); };
      this.child.on('error', fail);
      this.child.on('exit', (code) => { fail(new Error(`CortexDB exited (${code})`)); this.ready = null; this.child = null; });
      createInterface({ input: this.child.stdout }).on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      });
      await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'codex-task-map', version: '1' } });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const { tools } = await this.request('tools/list', {});
      for (const name of ['knowledge_save', 'knowledge_update', 'knowledge_delete', 'knowledge_get', 'knowledge_search', 'knowledge_graph_query', 'knowledge_graph_delete', 'knowledge_graph_upsert']) {
        if (!tools.some((tool) => tool.name === name)) throw new Error(`CortexDB tool unavailable: ${name}`);
      }
    })();
    try { await this.ready; } catch (error) { this.close(); throw error; }
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CortexDB timed out: ${method}`)); }, 30000);
      this.pending.set(id, { resolve: (result) => { clearTimeout(timer); resolve(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (error) => { if (error) { this.pending.delete(id); clearTimeout(timer); reject(error); } });
    });
  }

  async tool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    const text = result.content?.find((part) => part.type === 'text')?.text || '{}';
    if (result.isError) throw new Error(text);
    const payload = result.structuredContent ?? JSON.parse(text);
    return payload;
  }

  run(operation) {
    const result = this.queue.then(async () => { await this.start(); return operation(); });
    this.queue = result.catch(() => {});
    return result;
  }

  sync(data) {
    return this.run(async () => {
      if (!Array.isArray(data?.items) || !Array.isArray(data?.directions) || !Array.isArray(data?.catalog)) throw new TypeError('Invalid task map data');
      const ids = new Set(data.items.map((item) => String(item.id)));
      if (ids.size !== data.items.length) throw new TypeError('Duplicate task map item ID');
      const old = await this.tool('knowledge_graph_query', { query: `SELECT DISTINCT ?item WHERE { { GRAPH <${LEDGER}> { ?item <${GRAPH}:kind> "item" } } UNION { GRAPH <${GRAPH}> { ?item <${GRAPH}:kind> "item" } } }` });
      const current = new Set(data.items.map((item) => itemKey(item.id)));
      for (const row of old.result.bindings || []) if (!current.has(row.item.value)) {
        await this.tool('knowledge_delete', { knowledge_id: row.item.value });
        await this.tool('knowledge_graph_delete', { pattern: { graph: iri(LEDGER), subject: iri(row.item.value) } });
      }
      const triples = [];
      const add = (subject, predicate, object) => triples.push({ subject: iri(subject), predicate: iri(`${GRAPH}:${predicate}`), object, graph: iri(GRAPH) });
      const threads = new Set();
      for (const direction of data.directions) {
        const id = `${GRAPH}:direction:${encodeURIComponent(direction.id)}`;
        add(id, 'kind', literal('direction'));
        add(id, 'entityId', literal(direction.id));
        add(id, 'title', literal(direction.title));
      }
      for (const item of data.items) {
        const id = itemKey(item.id);
        const direction = data.directions.find((entry) => entry.id === item.directionId);
        const threadIds = [...new Set(item.threadIds || [])];
        const linked = threadIds.map((threadId) => `${threadId} ${data.catalog.find((entry) => entry.id === threadId)?.title || ''}`);
        const content = [item.title, `itemId: ${item.id}`, `方向: ${direction?.title || ''}`, `状态: ${item.status || ''}`, `下一步: ${item.next || ''}`, `关注: ${item.focus || ''}`, `备注: ${item.note || ''}`, ...linked].join('\n');
        const args = { title: String(item.title || ''), content, source_url: `codex-task-map://item/${encodeURIComponent(item.id)}`, collection: COLLECTION, metadata: { itemId: String(item.id), threadIds: JSON.stringify(threadIds), source: 'global-task-map' }, entities: [], relations: [] };
        await this.tool('knowledge_graph_upsert', { triples: [{ subject: iri(id), predicate: iri(`${GRAPH}:kind`), object: literal('item'), graph: iri(LEDGER) }] });
        let existing;
        try { existing = await this.tool('knowledge_get', { knowledge_id: id }); } catch (error) { if (!/not found|does not exist/i.test(error.message)) throw error; }
        if (!existing?.knowledge) await this.tool('knowledge_save', { knowledge_id: id, ...args });
        else if (existing.knowledge.content !== content || existing.knowledge.title !== args.title || existing.knowledge.source_url !== args.source_url || Object.entries(args.metadata).some(([key, value]) => existing.knowledge.metadata?.[key] !== value)) await this.tool('knowledge_update', { knowledge_id: id, ...args });
        add(id, 'kind', literal('item'));
        add(id, 'entityId', literal(item.id));
        add(id, 'title', literal(item.title || ''));
        for (const key of ['status', 'category', 'priority']) if (item[key] != null) add(id, key, literal(item[key]));
        if (direction) add(id, 'direction', iri(`${GRAPH}:direction:${encodeURIComponent(direction.id)}`));
        for (const threadId of threadIds) { threads.add(threadId); add(id, 'thread', iri(`${GRAPH}:thread:${encodeURIComponent(threadId)}`)); }
      }
      for (const threadId of threads) {
        const id = `${GRAPH}:thread:${encodeURIComponent(threadId)}`;
        add(id, 'kind', literal('thread'));
        add(id, 'entityId', literal(threadId));
        add(id, 'title', literal(data.catalog.find((entry) => entry.id === threadId)?.title || threadId));
      }
      await this.tool('knowledge_graph_delete', { pattern: { graph: iri(GRAPH) } });
      if (triples.length) await this.tool('knowledge_graph_upsert', { triples });
      return { itemCount: data.items.length, threadCount: threads.size, indexedAt: new Date().toISOString() };
    });
  }

  search({ query, limit = 10 } = {}) {
    return this.run(async () => {
      query = String(query || '').trim();
      if (!query) return { results: [] };
      const response = await this.tool('knowledge_search', { query, collection: COLLECTION, retrieval_mode: 'lexical', top_k: Math.max(1, Math.min(50, Number(limit) || 10)), keywords: [query], disable_graph: true });
      return { results: (response.results || []).filter((row) => row.metadata?.source === 'global-task-map').map((row) => ({ id: row.knowledge_id, itemId: row.metadata.itemId, title: row.title, content: row.snippet || '', source: row.source_url, threadIds: JSON.parse(row.metadata.threadIds || '[]'), score: row.score })) };
    });
  }

  graph() {
    return this.run(async () => {
      const response = await this.tool('knowledge_graph_query', { query: `SELECT ?subject ?predicate ?object WHERE { GRAPH <${GRAPH}> { ?subject ?predicate ?object } }` });
      const nodes = new Map();
      const edges = [];
      for (const row of response.result.bindings || []) {
        const id = row.subject.value;
        const predicate = row.predicate.value;
        if (!predicate.startsWith(`${GRAPH}:`)) continue;
        const key = predicate.slice(GRAPH.length + 1);
        if (key === 'direction') edges.push({ source: row.object.value, target: id, kind: 'contains' });
        else if (key === 'thread') edges.push({ source: id, target: row.object.value, kind: 'thread' });
        else if (['kind', 'entityId', 'title', 'status', 'category', 'priority'].includes(key)) {
          if (!nodes.has(id)) nodes.set(id, { id });
          nodes.get(id)[key] = row.object.value;
        }
      }
      const result = [...nodes.values()].filter((node) => ['direction', 'item', 'thread'].includes(node.kind) && node.entityId != null);
      const ids = new Set(result.map((node) => node.id));
      return { nodes: result, edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
    });
  }

  close() {
    for (const request of this.pending.values()) request.reject(new Error('CortexDB index closed'));
    this.pending.clear();
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }
}

export const createTaskMapIndex = (options) => new TaskMapIndex(options);
