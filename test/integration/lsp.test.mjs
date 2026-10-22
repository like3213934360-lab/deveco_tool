import { temporaryDirectory } from "../support/workspace.mjs";
// Actual LSP framing and pooled document synchronization against an offline language-server fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../.."), work = temporaryDirectory("deveco-lsp-");
process.env.DEVECO_STATE_DIR = path.join(work,"state");
const server = path.join(work,"server.cjs"), trace = path.join(work,"started"), bundle = path.join(work, "deveco-lsp-tests.mjs");
fs.writeFileSync(server, String.raw`
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(trace)},'started\n');let buffer=Buffer.alloc(0);const docs=new Map();
const send=(m)=>{const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',...m}));process.stdout.write(Buffer.concat([Buffer.from('Content-Length: '+body.length+'\r\n\r\n'),body]))};
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const h=buffer.indexOf('\r\n\r\n');if(h<0)return;const n=Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0,h).toString())[1]);if(buffer.length<h+4+n)return;const m=JSON.parse(buffer.subarray(h+4,h+4+n));buffer=buffer.subarray(h+4+n);
if(m.method==='initialize')send({id:m.id,result:{capabilities:{}}});
else if(m.method==='initialized')send({method:'aceProject/onModuleInitFinish',params:{}});
else if(m.method==='textDocument/didOpen'||m.method==='textDocument/didChange'){
 const d=m.params.textDocument, text=d.text??m.params.contentChanges[0].text;docs.set(d.uri,text);
 const publish=(version,items)=>send({method:'textDocument/publishDiagnostics',params:{uri:d.uri,...(version===undefined?{}:{version}),diagnostics:items}});
 const errors=[{range:{start:{line:0,character:0},end:{line:0,character:1}},severity:1,message:'current source error'}];
 if(text.includes('SILENT'))continue;
 if(text.includes('STALE')){publish(d.version-1,[]);setTimeout(()=>publish(d.version,errors),30)}
 else publish(text.includes('UNVERSIONED')?undefined:d.version,text.includes('ERROR')?errors:[]);
}else if(m.method==='textDocument/diagnostic')send({id:m.id,error:{code:docs.get(m.params.textDocument.uri)?.includes('PULL_FAIL')?-32001:-32601,message:'fixture pull rejection'}});
else if(m.method==='shutdown')send({id:m.id,result:null});else if(m.method==='exit')process.exit(0);
}});`);
await build({stdin:{contents:`export {lsp,cppCheck,restartLsp} from './src/domains/code.ts';export {killAll} from './src/core/proc.ts';`,resolveDir:root},outfile:bundle,bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'error',plugins:[{name:'offline-sdk',setup(b){
  b.onResolve({filter:/toolchain\.js$/},()=>({path:'toolchain',namespace:'fixture'}));
  b.onResolve({filter:/arktsModules\.js$/},()=>({path:'modules',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='modules'?`export const arktsInitializationOptions=()=>({});`:`export const sdkInfo=()=>({});export const toolchain=()=>({sdk:${JSON.stringify(work)}});export const component=(name)=>name==='node'?${JSON.stringify(process.execPath)}:${JSON.stringify(server)};export const toolCommand=()=>{throw new Error('unexpected SDK command')};`}));
}}]});
const m=await import(pathToFileURL(bundle).href), signal=new AbortController().signal;
after(async()=>{await m.restartLsp(work);m.killAll();fs.rmSync(bundle,{force:true});fs.rmSync(work,{recursive:true,force:true})});
const source=(name,text)=>{const file=path.join(work,name);fs.writeFileSync(file,text);return file};
const diagnostics=(files,abort=signal)=>m.lsp({project:work,action:'diagnostics',files},abort);

test('oversized explicit diagnostics fail before starting an SDK process',async()=>{
  await assert.rejects(m.cppCheck(work,Array.from({length:21},(_,i)=>`bad-${i}.cpp`),signal),{code:'INVALID_INPUT'});
  assert.equal(fs.existsSync(trace),false);
});
test('every accepted file is checked, including an error in the last file',async()=>{
  const files=Array.from({length:20},(_,i)=>source(`File${i}.ets`,i===19?'ERROR':'clean'));
  const r=await diagnostics(files);assert.equal(r.errors,1);assert.equal(r.diagnostics[0].file,'File19.ets');
});
test('old versions and late unversioned diagnostics cannot certify changed code',async()=>{
  const file=source('Changing.ets','clean');assert.equal((await diagnostics([file])).errors,0);
  fs.writeFileSync(file,'STALE ERROR');assert.equal((await diagnostics([file])).errors,1);
  fs.writeFileSync(file,'UNVERSIONED');await assert.rejects(diagnostics([file],AbortSignal.timeout(200)),{name:'TimeoutError'});
  fs.writeFileSync(file,'SILENT');await assert.rejects(diagnostics([file]),{code:'EVIDENCE_MISSING'});
  fs.writeFileSync(file,'PULL_FAIL');await assert.rejects(diagnostics([file]),{code:'LSP_ERROR'});
});
