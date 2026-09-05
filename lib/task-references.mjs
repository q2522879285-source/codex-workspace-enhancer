import { assetBrowserRuntime } from "./install-config.mjs";
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const cache = new Map();
const text = value => typeof value === 'string' ? value.trim() : '';
const threadId = value => text(value).replace(/^(?:local|cloud):/i, '').toLowerCase();
const absolutePath = value => typeof value === 'string' && path.win32.isAbsolute(value) && !/[\r\n\0]/.test(value);

function registry(file, field) {
  try {
    const info = statSync(file);
    const previous = cache.get(file);
    if (previous?.mtime === info.mtimeMs && previous.size === info.size) return previous.value;
    const value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (field === 'tickets' ? !Array.isArray(value?.tickets) : !value?.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings)) throw Error('Invalid registry');
    // ponytail: only the two local registries stay cached; use indexed queries if the ticket registry outgrows memory.
    if (cache.size >= 2 && !cache.has(file)) cache.delete(cache.keys().next().value);
    cache.set(file, { mtime: info.mtimeMs, size: info.size, value: value[field] });
    return value[field];
  } catch (error) {
    cache.delete(file);
    if (error.code === 'ENOENT') return field === 'tickets' ? [] : {};
    throw error;
  }
}

function normalizeReference(value) {
  if (!value || typeof value !== 'object') return null;
  let result;
  if (value.kind === 'history' && absolutePath(value.archivePath)) {
    result = { kind: 'history', label: text(value.label) || '冷历史记录', archivePath: value.archivePath };
    if (Number.isSafeInteger(value.recordId) && value.recordId >= 0) result.recordId = value.recordId;
  } else if (value.kind === 'asset' && absolutePath(value.path)) {
    result = { kind: 'asset', label: text(value.label) || path.win32.basename(value.path), path: value.path };
    for (const key of ['projectId', 'ticketId', 'outputId']) if (text(value[key])) result[key] = text(value[key]);
  } else return null;
  if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(threadId(value.sourceThreadId))) result.sourceThreadId = threadId(value.sourceThreadId);
  return result;
}

export function resolveTaskReferences(context, assetRoot = assetBrowserRuntime().stateRoot) {
  const currentId = threadId(context?.threadId);
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(currentId)) return {};
  const references = (Array.isArray(context.references) ? context.references : []).map(normalizeReference).filter(Boolean).slice(0, 12);
  let assetBinding = null;
  const errors = [];
  if (assetRoot) {
    try {
      const binding = registry(path.join(assetRoot, '.thread-project-bindings.json'), 'bindings')[currentId];
      if (binding && text(binding.projectId)) assetBinding = { projectId: text(binding.projectId), projectName: text(binding.projectName) };
    } catch { errors.push('项目绑定读取失败'); }
    try {
      const sources = new Set([currentId, ...references.filter(ref => ref.kind === 'history').map(ref => ref.sourceThreadId).filter(Boolean)]);
      const outputs = registry(path.join(assetRoot, '.generation-tickets.json'), 'tickets').flatMap(ticket => {
        const sourceThreadId = threadId(ticket?.sourceContext?.threadId || ticket?.sourceContext?.taskId || ticket?.threadId);
        if (!sources.has(sourceThreadId)) return [];
        return (Array.isArray(ticket.outputs) ? ticket.outputs : []).flatMap(output => {
          const file = output?.storePath || output?.path;
          const ref = normalizeReference({ kind: 'asset', path: file, label: absolutePath(file) ? path.win32.basename(file) : '',
            ticketId: ticket.id, outputId: output?.outputId || output?.id, projectId: output?.projectId || ticket.projectId, sourceThreadId });
          return ref ? [{ ref, time: Date.parse(output.archivedAt || ticket.updatedAt || ticket.createdAt) || 0 }] : [];
        });
      }).sort((a, b) => b.time - a.time);
      const paths = new Set(references.filter(ref => ref.kind === 'asset').map(ref => path.win32.normalize(ref.path).toLowerCase()));
      let added = 0;
      for (const { ref } of outputs) {
        const key = path.win32.normalize(ref.path).toLowerCase();
        if (paths.has(key)) continue;
        references.push(ref); paths.add(key);
        if (++added === 6) break;
      }
    } catch { errors.push('资产来源索引读取失败'); }
  }
  return { references, assetBinding, referenceStatus: errors.join('；') };
}
