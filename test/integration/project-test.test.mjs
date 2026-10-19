// SDK process/report boundary, with isolated files and transport; no real device claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'deveco-sdk-reports-'));
fs.symlinkSync(path.resolve('node_modules'),path.join(work,'node_modules'),'junction');
after(() => { delete globalThis.__sdkReports; fs.rmSync(work,{recursive:true,force:true}); });
const f = globalThis.__sdkReports = { root: work, mode: 'valid' };
fs.mkdirSync(path.join(work, 'src/ohosTest'), {recursive: true});
fs.writeFileSync(path.join(work, 'src/ohosTest/Probe.test.ets'), '// discovery fixture');
const bundle = path.join(work, 'test.mjs');
await build({entryPoints: [path.resolve('src/domains/project-test.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'error', plugins: [{name: 'sdk-boundary', setup(b) {
  b.onResolve({filter: /(?:artifacts|proc|toolchain|hdc-target|project|device)\.js$/}, a => a.importer.replaceAll('\\','/').endsWith('/domains/project-test.ts') ? {path: path.basename(a.path, '.js'), namespace: 'boundary'} : undefined);
  b.onLoad({filter: /.*/, namespace: 'boundary'}, a => ({contents: {
    artifacts: `export function artifactPath(){return {id:'log',file:globalThis.__sdkReports.root+'/build.log'}} export async function commitArtifact(){return {artifact_id:'log'}} export async function saveArtifact(){return {artifact_id:'report'}}`,
    toolchain: `export function toolCommand(_tool,args){return {args}} export function sdkInfo(){return {version:'fixture'}}`,
    project: `export function inspectProject(){return {root:globalThis.__sdkReports.root,product:'default',modules:[{name:'entry',root:globalThis.__sdkReports.root}]}}`,
    device: `export async function resolveTarget(target){return target}`,
    'hdc-target': `export async function openHdcTarget(target){return {port:1,routing:{target,commands:1},assertHealthy(){},async close(){globalThis.__sdkReports.closed=true}}}`,
    proc: `import fs from 'node:fs'; import path from 'node:path';
      export async function run(command, options){
        const f=globalThis.__sdkReports; f.args=command.args;
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
