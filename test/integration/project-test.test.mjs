import { temporaryDirectory } from "../support/workspace.mjs";
// SDK process/report boundary, with isolated files and transport; no real device claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const work = temporaryDirectory("deveco-sdk-reports-");
fs.symlinkSync(path.resolve('node_modules'),path.join(work,'node_modules'),'junction');
after(() => { delete globalThis.__sdkReports; fs.rmSync(work,{recursive:true,force:true}); });
const f = globalThis.__sdkReports = { root: work, mode: 'valid' };
fs.mkdirSync(path.join(work, 'src/ohosTest'), {recursive: true});
fs.writeFileSync(path.join(work, 'src/ohosTest/Probe.test.ets'), '// discovery fixture');
const bundle = path.join(work, 'test.mjs');
await build({entryPoints: [path.resolve('src/domains/project-test.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'error', plugins: [{name: 'sdk-boundary', setup(b) {
  b.onResolve({filter: /(?:artifacts|proc|toolchain|hdc-target|project|device)\.js$/}, a => a.importer.replaceAll('\\','/').endsWith('/domains/project-test.ts') ? {path: path.basename(a.path, '.js'), namespace: 'boundary'} : undefined);
  b.onLoad({filter: /.*/, namespace: 'boundary'}, a => ({resolveDir: path.resolve('.'), contents: {
    artifacts: `export function artifactPath(){return {id:'log',file:globalThis.__sdkReports.root+'/build.log'}} export async function commitArtifact(){return {artifact_id:'log'}} export async function saveArtifact(){return {artifact_id:'report'}}`,
    toolchain: `export function toolCommand(_tool,args){return {args}} export function sdkInfo(){return {version:'fixture'}}`,
    project: `export {BuildOutputParser} from ${JSON.stringify(path.resolve('src/domains/project.ts'))}; export function inspectProject(){return {root:globalThis.__sdkReports.root,product:'default',modules:[{name:'entry',root:globalThis.__sdkReports.root}]}}`,
    device: `export async function resolveTarget(target){return target}`,
    'hdc-target': `export async function openHdcTarget(target){return {port:1,routing:{target,commands:1},assertHealthy(){},async close(){globalThis.__sdkReports.closed=true}}}`,
    proc: `import fs from 'node:fs'; import path from 'node:path';
      export async function run(command, options){
        const f=globalThis.__sdkReports; f.args=command.args;
        if(f.failure){
          fs.writeFileSync(options.logFile,f.failure.log);
          for(const line of f.failure.log.split('\\n'))options.onLine?.(line);
          return {code:f.failure.code,elapsedMs:10};
        }
        const result=path.join(f.root,'.test/default/intermediates/ohosTest/coverage_data/test_result.txt');
        const coverage=path.join(f.root,'.test/default/outputs/ohosTest/reports/coverageReport.json');
        for(const file of [result,coverage])fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.writeFileSync(result,'class=Probe\\ntest=one\\nresult='+ (f.mode==='business_failure'?'Failure':'Success') +'\\nTests run: 1, Failure: '+(f.mode==='business_failure'?1:0)+', Error: 0, Pass: '+(f.mode==='business_failure'?0:1)+', Ignore: 0\\n');
        fs.writeFileSync(options.logFile,f.mode==='sdk_failure'?'Description: getInitCoverageData failed, SyntaxError: Unexpected non-whitespace character after JSON\\nBUILD SUCCESSFUL':'BUILD SUCCESSFUL');
        if(f.mode!=='sdk_failure')fs.writeFileSync(coverage,f.mode==='invalid_coverage'?'{} trailing':JSON.stringify({summary:{lines:1},files:[]}));
        return {code:0,elapsedMs:10};
      }`,
  }[a.path]}));
}}]});
const m = await import(pathToFileURL(bundle));
async function run(mode, coverage=true) {
  fs.rmSync(path.join(work,'.test'),{recursive:true,force:true});
  f.mode=mode; f.closed=false;
  return m.runProjectTests({project:work,kind:'instrument',target:'explicit-fixture',allow_data_reset:true,coverage,expected_tests:1},new AbortController().signal);
}
test('coverage serializes shared SDK writer tasks and retains test verdicts independently', async () => {
  const result=await run('valid'); assert.equal(result.verdict,'passed');
  assert.ok(f.args.includes('--no-parallel')); assert.equal(result.coverage_build,'serial'); assert.equal(f.closed,true);
  assert.equal((await run('business_failure')).verdict,'failed');
  await run('valid',false); assert.equal(f.args.includes('--no-parallel'),false);
});
test('SDK coverage error survives exit zero and includes case evidence', async () => {
  await assert.rejects(run('sdk_failure'),e => {
    assert.equal(e.code,'SDK_COVERAGE_FAILED'); assert.equal(e.details.counts.passed,1);
    assert.match(e.details.sdk_error,/getInitCoverageData failed/); assert.equal(e.details.log_artifact,'log'); return true;
  });
  assert.equal(f.closed,true);
});
test('malformed final coverage remains a report error, never a test pass', async () => {
  await assert.rejects(run('invalid_coverage'),{code:'TEST_REPORT_INVALID'});
});


test('application JSON errors are not misclassified as SDK coverage generation failures', async () => {
  const file = path.join(work, 'application.log');
  fs.writeFileSync(file, 'Error: invalid JSON in application payload\nSyntaxError: invalid JSON response\nBUILD SUCCESSFUL');
  assert.equal(await m.sdkCoverageFailure(file), undefined);
});

test('compiler failures precede missing or stale reports and retain source diagnostics', async () => {
  const source=path.join(work,'src/Probe.ets');
  for(const code of [255,0]) {
    f.failure={code,log:`> hvigor ERROR: Failed :entry:default@UnitTestArkTS...\n1 ERROR: 10903329 ArkTS Compiler Error\nError Message: Unknown resource name 'missing'. At File: ${source}:7:9\nCOMPILE RESULT:FAIL {ERROR:1}\n> hvigor ERROR: BUILD FAILED`};
    try {
      await assert.rejects(run('compile_failure'),e=>{
        assert.equal(e.code,'BUILD_FAILED'); assert.equal(e.details.stage,'compile');
        assert.equal(e.details.exit_code,code); assert.equal(e.details.log_artifact,'log');
        assert.equal(e.details.diagnostics[0].line,7); assert.equal(e.details.diagnostics[0].file,'src/Probe.ets');
        assert.match(e.details.diagnostics[0].message,/Unknown resource/);
        assert.deepEqual(e.details.failed_tasks,['entry:default@UnitTestArkTS']); return true;
      });
      assert.equal(f.closed,true);
    } finally {delete f.failure;}
  }
});

test('non-compile process failures and successful commands without reports remain distinct', async () => {
  for(const [code,log,expected] of [
    [1,'> hvigor ERROR: Failed :entry:default@InstallHap...\n> hvigor ERROR: device install failed','TEST_EXECUTION_FAILED'],
    [2,'previewer exited unexpectedly','TEST_EXECUTION_FAILED'],
    [0,'BUILD SUCCESSFUL','TEST_REPORT_MISSING'],
  ]) {
    f.failure={code,log};
    try {await assert.rejects(run('no_report',false),e=>e.code===expected&&e.details.exit_code===code&&e.details.log_artifact==='log');}
    finally {delete f.failure;}
  }
});
