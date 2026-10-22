import { temporaryDirectory } from "../support/workspace.mjs";
// Actual LSP framing and pooled document synchronization against an offline language-server fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";
import { once } from "node:events";

const root = path.resolve(import.meta.dirname, "../.."), work = temporaryDirectory("deveco-lsp-");
process.env.DEVECO_STATE_DIR = path.join(work,"state");
const server = path.join(work,"server.cjs"), trace = path.join(work,"started"), bundle = path.join(work, "deveco-lsp-tests.mjs");
fs.writeFileSync(server, String.raw`
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(trace)},'started\n');fs.appendFileSync(${JSON.stringify(trace+'.pids')},process.pid+'\n');let buffer=Buffer.alloc(0);const docs=new Map();
const send=(m)=>{const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',...m}));process.stdout.write(Buffer.concat([Buffer.from('Content-Length: '+body.length+'\r\n\r\n'),body]))};
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const h=buffer.indexOf('\r\n\r\n');if(h<0)return;const n=Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0,h).toString())[1]);if(buffer.length<h+4+n)return;const m=JSON.parse(buffer.subarray(h+4,h+4+n));buffer=buffer.subarray(h+4+n);
if(m.method==='initialize'){const mode=fs.existsSync(${JSON.stringify(trace+'.mode')})?fs.readFileSync(${JSON.stringify(trace+'.mode')},'utf8'):'';if(mode==='hang')continue;if(mode==='error')send({id:m.id,error:{code:-32000,message:'initialize rejected'}});else send({id:m.id,result:{capabilities:{}}})}
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
await build({stdin:{contents:`export {lsp,cppCheck,restartLsp} from './src/domains/code.ts';export {killAll,spawnManaged} from './src/core/proc.ts';export {LspClient} from './src/core/lsp-client.ts';`,resolveDir:root},outfile:bundle,bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'error',plugins:[{name:'offline-sdk',setup(b){
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

test('malformed and oversized LSP messages reject pending calls and terminate the owned process', async () => {
  for (const frame of ['Content-Length: 4\r\n\r\nnull', 'Content-Length: 999999999\r\n\r\n', 'x'.repeat(8200)]) {
    const child = m.spawnManaged({ file: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(frame)});setInterval(()=>{},1000)`] });
    const exited = once(child, 'exit'), client = new m.LspClient(child);
    await assert.rejects(client.request('probe', {}, 3000), { code: 'LSP_PROTOCOL_ERROR' });
    await exited;
    await assert.rejects(client.request('after', {}), { code: 'LSP_EXITED' });
  }
});


test('failed and cancelled LSP initialization terminates owned children and releases sessions',async()=>{
  await m.restartLsp(work);
  for(const mode of ['error','hang','error']) {
    fs.writeFileSync(trace+'.mode',mode);const controller=new AbortController();
    const request=diagnostics([source('Init.ets','clean')],controller.signal);
    let timer;if(mode==='hang')timer=setTimeout(()=>controller.abort(),200);
    try{await assert.rejects(request, mode==='error'?/initialize rejected/:/Cancel|abort/i)}finally{clearTimeout(timer)}
    const pid=Number(fs.readFileSync(trace+'.pids','utf8').trim().split('\n').at(-1));
    await new Promise(r=>setTimeout(r,100));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  }
  fs.rmSync(trace+'.mode');assert.equal((await diagnostics([source('Init.ets','clean')])).errors,0);
});

test('LSP sessions distinguish products and restart closes every product session',async()=>{
  await m.restartLsp(work);
  const profile=path.join(work,'build-profile.json5');fs.writeFileSync(profile,JSON.stringify({app:{products:[{name:'default'},{name:'watch'}]},modules:[]}));
  const started=()=>fs.readFileSync(trace,'utf8').trim().split('\n').length, before=started();
  const file=source('Product.ets','clean');
  try {
    await m.lsp({project:work,product:'default',action:'diagnostics',file},signal);
    await m.lsp({project:work,product:'watch',action:'diagnostics',file},signal);
    await m.lsp({project:work,action:'diagnostics',file},signal);
    assert.equal(started()-before,2);
    await m.restartLsp(work);await m.lsp({project:work,product:'watch',action:'diagnostics',file},signal);assert.equal(started()-before,3);
  } finally {await m.restartLsp(work);fs.rmSync(profile)}
});

test('serve-lsp frames exit, reports invalid input and cleans descendants after parent exit', {timeout:18000,skip:process.platform==='win32'}, async()=>{
  const {spawn,execFileSync}=await import('node:child_process'), cli=path.join(work,'cli.mjs'), serverFile=path.join(work,'proxy-server.cjs'), pidFile=path.join(work,'proxy-grandchild.pid');
  const descendant="process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));console.log('ready');setInterval(()=>{},1000)";
  fs.writeFileSync(serverFile,"require('node:child_process').spawn(process.execPath,['-e',"+JSON.stringify(descendant)+","+JSON.stringify(pidFile)+"],{stdio:'inherit'});process.stdin.resume();process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)");
  await build({entryPoints:[path.join(root,'src/cli.ts')],outfile:cli,bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'error',plugins:[{name:'lsp-command',setup(b){
    b.onResolve({filter:/domains\/code\.js$/},a=>a.importer.endsWith('/cli.ts')?{path:'command',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const lspCommand=()=>({file:'+JSON.stringify(process.execPath)+',args:['+JSON.stringify(serverFile)+'],cwd:'+JSON.stringify(work)+'})'}));
  }}]});
  for(const mode of ['fragmented-exit','sigterm','invalid']){
    const child=spawn(process.execPath,[cli,'serve-lsp','--project',work],{stdio:['pipe','pipe','pipe']});let error='';child.stderr.on('data',b=>error+=b);const result=once(child,'exit');
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
    try{
      await once(child.stdout,'data');
      if(mode==='fragmented-exit'){
        const body=JSON.stringify({jsonrpc:'2.0',method:'exit'}),split=body.indexOf('exit')+2;
        child.stdin.write('Content-Length: '+Buffer.byteLength(body)+'\r\n\r\n'+body.slice(0,split));
        await new Promise(r=>setTimeout(r,100));child.stdin.write(body.slice(split));
      }else if(mode==='sigterm')child.kill('SIGTERM');else child.stdin.write('Content-Length: 1\r\n\r\nx');
      const [code]=await result;assert.equal(code,mode==='invalid'?1:0,error);
      const pid=Number(fs.readFileSync(pidFile,'utf8'));
      const alive=()=>{try{return !execFileSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).trim().startsWith('Z')}catch{return false}};
      for(let i=0;i<50&&alive();i++)await new Promise(r=>setTimeout(r,20));assert.equal(alive(),false,mode);
    }finally{clearTimeout(timer);child.kill('SIGKILL');if(fs.existsSync(pidFile)){try{process.kill(Number(fs.readFileSync(pidFile)),'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}}
  }
});
