import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end);
}

test('ordinary task preferences never change the project layout preference', () => {
  const context = vm.createContext({ activeSectionTab:'置顶', company:false, viewMode:'card', taskViewMode:'list',
    COMPANY_WORKBENCH_MODE_ATTR:'data-codex-company-workbench',
    document:{documentElement:{getAttribute:()=>context.company ? 'true' : null}}});
  vm.runInContext(extract('isTaskShell') + extract('currentViewMode'), context);
  assert.equal(context.currentViewMode(), 'list');
  context.activeSectionTab = '项目';
  assert.equal(context.currentViewMode(), 'card');
  context.activeSectionTab = '置顶'; context.company = true;
  assert.equal(context.currentViewMode(), 'card');
});

test('overview shows excerpts, omits filler, and does not claim task completion', () => {
  const context = vm.createContext({});
  vm.runInContext(extract('cleanTaskPreviewText') + extract('taskOverviewPresentation'), context);
  const result = context.taskOverviewPresentation({latestAnswer:'已调整按钮尺寸。',nextStep:'等待你的下一条要求',status:'已同步'});
  assert.equal(result.summary, '已调整按钮尺寸。');
  assert.equal(result.summaryLabel, '最近答复摘录');
  assert.equal(result.nextStep, '');
  assert.equal(result.status, '空闲');
  assert.equal(context.taskOverviewPresentation({running:true}).status, '进行中');
  assert.equal(context.taskOverviewPresentation({nextStep:'下一步请确认布局'}).nextStep, '下一步请确认布局');
});
