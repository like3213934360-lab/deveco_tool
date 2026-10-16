// System host state machine at the UI boundary; no SDK/device or application-specific product rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = process.cwd(), file = path.resolve('node_modules/.cache/deveco-forms.mjs');
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'deveco-form-job-'));
process.env.DEVECO_STATE_DIR = state;
process.env.DEVECO_COORDINATION_DIR = path.join(state, 'coordination');
const f = globalThis.__forms = {};
const bundle = 'com.example.cards', rect = { x1: 0, y1: 0, x2: 1000, y2: 1800 };
function nodes() {
  const out = [];
  const add = (key, text = '', parent = null, bounds = rect) => {
    const i = out.length; out.push({ i, parent, key, text, type: 'Column', rect: bounds, visible: true, clickable: true }); return i;
  };
  if (f.view === 'desktop') {
    add(`SwiperPage_Grid_WorkSpace_${f.page}`);
    if (f.page === 0) add(`Container_AppIcon_Image_${bundle}EntryAbilityphone0_undefined_0`);
    for (const card of f.cards.filter((v) => v.page === f.page)) {
      const parent = add(`SwiperPage_FormItem_${card.bundle}_${card.id}`);
      add(`FormItem_${card.bundle}_${card.id}`, 'Visible content', parent);
    }
  } else if (f.view === 'app-menu') add('AppMenu_HorizontalMenuItem_fixedMenu0', '卡片');
  else if (f.view === 'center') {
    add('FormManagerView_Stack'); add('FormCenterSwiper');
    const parent = add(`SwiperItemView_Column_${f.preview}`);
    add(`FormCenterFormItem_Stack_${bundle}_${f.preview}`, `Preview ${f.preview}`, parent);
    add('SwiperLayout_AddToDesktopButton');
  } else if (f.view === 'form-menu') add('FormMenu_HorizontalMenuItem_sec2', '移除');
  else if (f.view === 'confirm') add('advanced_dialog_button_1', '移除');
  else add('UnknownHost');
  f.nodes = out; return out;
}
function reset(extra = {}) {
  Object.assign(f, { view: 'desktop', page: 0, pages: 5, preview: 0, previews: 2, cards: [{ bundle, id: '9223372036854775800', page: 4 }], calls: [], failAdd: false, abortAdd: false, failRemove: false, failInspect: false, controller: new AbortController(), ...extra });
  f.tree = nodes;
  f.act = async (action, signal) => {
    signal.throwIfAborted(); f.calls.push(action);
    if (action.action === 'key') f.view = 'desktop';
    else if (action.action === 'swipe') {
      const delta = action.x > action.x2 ? 1 : -1;
      if (f.view === 'desktop') f.page = Math.max(0, Math.min(f.pages - 1, f.page + delta));
      if (f.view === 'center') f.preview = Math.max(0, Math.min(f.previews - 1, f.preview + delta));
    } else if (action.action === 'long_click') {
      if (f.page === 0) f.view = 'app-menu';
      else { f.view = 'form-menu'; f.removing = f.cards.find((v) => v.page === f.page)?.id; }
    } else if (f.view === 'app-menu') f.view = 'center';
    else if (f.view === 'center') {
      if (f.failAdd) throw new Error('add rejected');
      f.cards.push({ bundle, id: '9223372036854775801', page: 3 }); f.view = 'desktop';
      if (f.abortAdd) f.controller.abort(new Error('cancelled'));
    } else if (f.view === 'form-menu') { if (f.failRemove) throw new Error('remove rejected'); f.view = 'confirm'; }
    else if (f.view === 'confirm') { f.cards = f.cards.filter((v) => v.id !== f.removing); f.view = 'desktop'; }
    signal.throwIfAborted(); return {};
  };
  return f.controller.signal;
}
await build({stdin:{contents:`export * from './src/domains/forms.ts';export {uiTool} from './src/tools/core.ts';export {startJob,waitJob,jobStatus,cancelJob} from './src/core/jobs.ts';export {closeDatabase} from './src/core/db.ts';export {closeCoordination} from './src/core/operations.ts';import './src/jobs.ts';`,resolveDir:root},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'error',plugins:[{name:'host',setup(b){
  b.onResolve({filter:/device\.js$/},a=>a.importer.replaceAll('\\','/').endsWith('/core/operations.ts')?{path:'routing',namespace:'host'}:undefined);
  b.onResolve({filter:/^(?:\.\/ui\.js|\.\/device\.js|\.\/entries\.js|node:timers\/promises)$/},a=>a.importer.replaceAll('\\', '/').endsWith('/domains/forms.ts')?{path:a.path,namespace:'host'}:undefined);
  b.onLoad({filter:/.*/,namespace:'host'},a=>({resolveDir:root,contents:a.path==='routing'?`export const resolveTarget=async(t)=>t;`:a.path==='./ui.js'?`export {select,subtree,center} from ${JSON.stringify(path.join(root,'src/domains/ui.ts'))};export const invalidate=()=>{};export const dumpTree=async()=>globalThis.__forms.tree();export const act=async(t,a,s)=>globalThis.__forms.act(a,s);`:a.path==='./device.js'?`export const hilog=async()=>{if(globalThis.__forms.failInspect)throw new Error('log unavailable');return {tail:'formId=9223372036854775801 reason=application_specific',scan:{possibly_truncated:false}}};export const shell=async(t,args)=>({stdout:args[0]==='param'?'phone':JSON.stringify({hapModuleInfos:[{moduleName:'phone'}]})});`:a.path==='./entries.js'?`export const entryGraph=()=>({bundle:'com.example.cards',entries:[]});`:`export const setTimeout=async(ms,v,{signal})=>{signal.throwIfAborted();};`}));
}}]});
const m = await import(pathToFileURL(file));
after(async()=>{await m.closeCoordination();await m.closeDatabase(); fs.rmSync(file,{force:true});fs.rmSync(state,{recursive:true,force:true}); delete globalThis.__forms; });
const input = {target:'selected-emulator',bundle,max_pages:8};
test('inventory scans beyond three pages, deduplicates wrapper keys and retains 64-bit IDs',async()=>{
  const result=await m.inventoryForms(input,reset());assert.equal(result.complete,true);assert.equal(result.pages.length,5);assert.equal(result.instances.length,1);assert.equal(result.instances[0].instance_id,'9223372036854775800');assert.equal(result.instances[0].page,4);
  assert.equal((await m.inventoryForms({...input,max_pages:3},reset())).complete,false);
  assert.equal((await m.inventoryForms({...input,max_pages:1},reset({pages:1,cards:[]}))).complete,true);
});
test('unknown host fails explicitly',async()=>{
  reset(); f.act=async()=>{}; f.view='unknown';await assert.rejects(m.inventoryForms(input,f.controller.signal),{code:'CAPABILITY_UNAVAILABLE'});
});
test('catalog rewinds a default preview in the middle and cannot call a bounded partial scan complete', async () => {
  const catalog = await m.catalogForms(input, reset({ preview: 2, previews: 4 }));
  assert.equal(catalog.complete, true);
  assert.deepEqual(catalog.previews.map((v) => v.index), [0, 1, 2, 3]);
  const partial = await m.catalogForms({ ...input, max_pages: 2 }, reset({ preview: 4, previews: 5 }));
  assert.equal(partial.complete, false);
});
test('catalog indices do not select a declaration; owned removal preserves the existing duplicate',async()=>{
  const signal=reset(),before=await m.inventoryForms(input,signal);
  await assert.rejects(m.attachForm(input,before,signal),{code:'INVALID_INPUT'});
  const attached=await m.attachForm({...input,form_index:1},before,signal);
  assert.equal(attached.instance.instance_id,'9223372036854775801');assert.equal(attached.selected_index,1);
  const observed=await m.inspectForm(input,attached,signal);assert.equal(observed.business_correctness,'not-judged');assert.equal(observed.correlation.declaration_match,'unresolved');
  const removed=await m.removeForm(input,attached,signal);assert.equal(removed.preexisting_preserved,true);assert.deepEqual(f.cards,before.instances.map(v=>({bundle:v.bundle,id:v.instance_id,page:v.page})));
  await assert.rejects(m.removeForm({...input,target:'other'},attached,signal),{code:'CONFLICT'});
});
test('cancellation after add performs bounded cleanup with an independent signal',async()=>{
  const signal=reset({abortAdd:true}),before=await m.inventoryForms(input,signal);
  await assert.rejects(m.attachForm({...input,form_index:0},before,signal),/cancelled/);assert.equal(f.cards.length,1);assert.equal(f.calls.filter(v=>v.action==='long_click').length,2);
});
test('rejected add confirms no addition; failed removal is surfaced without repeated attempts',async()=>{
  let signal=reset({failAdd:true}),before=await m.inventoryForms(input,signal);
  await assert.rejects(m.attachForm({...input,form_index:0},before,signal),/add rejected/);assert.equal(f.cards.length,1);
  signal=reset({abortAdd:true,failRemove:true});before=await m.inventoryForms(input,signal);
  await assert.rejects(m.attachForm({...input,form_index:0},before,signal),e=>e.code==='FORM_CLEANUP_FAILED'&&e.details.original.message==='cancelled'&&e.details.cleanup.message==='remove rejected');assert.equal(f.cards.length,2);assert.equal(f.calls.filter(v=>v.action==='long_click').length,2);
});
test('size selection and incomplete baseline cannot silently use a different test',async()=>{
  const signal=reset(),before=await m.inventoryForms(input,signal);
  await assert.rejects(m.attachForm({...input,form_index:0,form_size:'2*4'},before,signal),{code:'CAPABILITY_UNAVAILABLE'});assert.equal(f.cards.length,1);
  await assert.rejects(m.attachForm({...input,form_index:0},{...before,complete:false},signal),{code:'EVIDENCE_MISSING'});
});
test('correlation requires explicit identity and never turns business log messages into a verdict',()=>{
  const instance={bundle,instance_id:'12'},declarations=[{name:'Tile',module_name:'phone',referenced_by:[{owner:'Cards'}],source:{file:'base'}}];
  const exact=m.correlateForm(instance,declarations,`formId=12 bundleName=${bundle} formName=Tile moduleName=phone abilityName=Cards sizeKey=2x2 reason=artifact_missing\nformId=123 formName=Other`);
  assert.equal(exact.matched_lines,1);assert.equal(exact.candidates.length,1);assert.match(exact.declaration_match,/identity-fields-match/);assert.deepEqual(exact.reported_sizes,['2*2']);assert.equal(exact.verdict,undefined);
  assert.equal(m.correlateForm(instance,declarations,'formId=12 formName=Tile').declaration_match,'candidates');
  assert.equal(m.correlateForm(instance,declarations,'formId=12 bundleName=com.other formName=Tile').declaration_match,'unresolved');
});

test('real card job retains cleanup receipt on failure and does not retry failed removal', async () => {
  for (const failRemove of [false, true]) {
    reset({ failInspect: true, failRemove });
    const { job_id } = await m.startJob('form_check', { ...input, form_index: 0 });
    const completed = await m.waitJob(job_id, 1000);
    assert.equal(completed.status, 'failed');
    const detail = await m.jobStatus(job_id, true);
    if (failRemove) {
      assert.equal(completed.error.code, 'FORM_CLEANUP_FAILED');
      assert.equal(completed.error.details.original.message, 'log unavailable');
      assert.equal(f.cards.length, 2);
    } else {
      assert.equal(detail.outputs.cleanup.preexisting_preserved, true);
      assert.equal(f.cards.length, 1);
    }
    assert.equal(f.calls.filter(v => v.action === 'long_click').length, 2);
  }
});

test('matrix reports per-case failure and stops after uncertain cleanup', async () => {
  reset({ failInspect: true, failRemove: true });
  const { job_id } = await m.startJob('form_matrix', { bundle, max_pages: 8, form_cases: [
    { target: 'selected-emulator', form_index: 0 }, { target: 'second-emulator', form_index: 1 },
  ] });
  const completed = await m.waitJob(job_id, 1000);
  assert.equal(completed.status, 'succeeded', 'orchestration completion is not a case pass');
  assert.deepEqual(completed.result.cases.map((c) => c.status), ['failed', 'not_run']);
  assert.equal(completed.result.cases[0].reachability.device_type, 'phone');
  assert.equal(completed.result.cases[0].error.code, 'FORM_CLEANUP_FAILED');
  assert.equal(f.cards.length, 2);
  assert.equal(f.calls.filter(v => v.action === 'long_click').length, 2);
});

test('action-only card flows are rejected before touching the host', async () => {
  reset();
  const directory = path.join(state, 'project/.arkpilot/flows'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'actions.json'), JSON.stringify({ version: 2, id: 'actions', name: 'no assertions',
    app: { bundleName: bundle, module: 'phone', ability: 'Main' }, start: { mode: 'attach' }, variables: {},
    steps: [{ id: 'tap', action: 'tap', selector: { text: 'Button' } }],
  }));
  await assert.rejects(m.uiTool.handler({ action: 'form', form_action: 'exercise', project: path.join(state, 'project'), bundle,
    target: 'selected-emulator', form_index: 0, then_flow: 'actions' }, { signal: f.controller.signal }),
    e => e.code === 'INVALID_INPUT' && /explicit visible\/hidden assertion/.test(e.message));
  assert.deepEqual(f.calls, []);
});
