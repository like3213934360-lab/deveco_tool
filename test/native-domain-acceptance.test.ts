import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StateStore } from "../src/core/store.js";
import { fileDigest, digest } from "../src/core/files.js";
import { DomainAcceptanceService } from "../src/services/domain-acceptance.js";
import { captureEvidenceIdentity, compareEvidenceIdentity, projectEvidenceIdentity } from "../src/services/evidence-identity.js";
import { inspectProject } from "../src/services/project.js";
import { resolveEvidenceResult } from "../src/services/evidence-result.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const requirement={id:"R1",revision:1,text:"The current application builds"};
function fixture() {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),"deveco-evidence-"))),project=path.join(root,"application");
  fs.cpSync(new URL("../../test/fixtures/harmony-app/",import.meta.url),project,{recursive:true});
  const store=new StateStore(path.join(root,"state")),scope={project_path:project},artifact=path.join(project,"build","fixture.hap");
  fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,"compiled fixture bytes");
  const service=new DomainAcceptanceService(store,()=>({verified:true,steps:[{id:"assertion",status:"passed",requirement_ids:["R1"],task_ids:["T1"],check:{review_id:"4f938a35-33ce-46dc-8c47-535a0c38737e"}}]}));
  const native=(workflow="project_build",bindings=[requirement])=>{
    const run=store.create(workflow,{requirements:bindings}).run;
    const seal={identity:captureEvidenceIdentity(scope,bindings,false),scope,requirements:bindings,artifacts:[{path:artifact,sha256:fileDigest(artifact)}]};
    store.update(run.id,"succeeded",{_evidence:seal});return run.id;
  };
  const assess=(run_id:string,extra:Record<string,unknown>={})=>service.assess({action:"assess",project_path:project,requirements:[{...requirement,original_text:requirement.text,task_ids:["T1"],mode:"build-only"}],evidence:[{requirement_id:"R1",requirement_revision:1,task_id:"T1",run_id}],...extra});
  return {root,project,store,scope,artifact,service,native,assess,close:()=>{store.close();fs.rmSync(root,{recursive:true,force:true});}};
}
function errorCodes(result:unknown) {const encoded=JSON.stringify(result);return encoded;}

test("requirement-bound build evidence is current, protects its run, and invalidates on replaced output bytes",()=>{
  const f=fixture();try {
    const id=f.native(),accepted=f.assess(id);assert.equal(accepted.contract_satisfied,true);assert.equal(accepted.business_verified,false);
    assert.ok(f.store.db.prepare("SELECT 1 FROM run_dependencies WHERE parent_run_id=? AND run_id=?").get(accepted.run_id,id));
    fs.writeFileSync(f.artifact,"replacement bytes");const changed=f.assess(id);assert.equal(changed.contract_satisfied,false);assert.match(errorCodes(changed),/EVIDENCE_ARTIFACT_CHANGED/);
  } finally {f.close();}
});

test("source, configuration and dependency edits invalidate native evidence despite a succeeded native run",()=>{
  for(const file of ["entry/src/main/ets/pages/Index.ets","AppScope/app.json5","oh_modules/library/index.js"]) {
    const f=fixture();try {
      const target=path.join(f.project,file);fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target))fs.writeFileSync(target,"export const version=1;");
      const id=f.native();fs.appendFileSync(target,file.endsWith(".json5")?"\n ":"\n// changed source");
      assert.equal(f.assess(id).contract_satisfied,false,file);assert.match(errorCodes(f.assess(id)),/EVIDENCE_STALE/);
    } finally {f.close();}
  }
});

test("symlinked sources and nested dependencies participate in freshness; cycles fail explicitly",()=>{
  const f=fixture();try {
    const dependency=path.join(f.root,"external");fs.mkdirSync(dependency);const file=path.join(dependency,"index.js");fs.writeFileSync(file,"one");
    fs.mkdirSync(path.join(f.project,"node_modules"));fs.symlinkSync(dependency,path.join(f.project,"node_modules","linked"),process.platform==="win32"?"junction":"dir");
    const before=projectEvidenceIdentity(inspectProject(f.project));fs.writeFileSync(file,"two");
    assert.notEqual(projectEvidenceIdentity(inspectProject(f.project)).project_dependencies_sha256,before.project_dependencies_sha256);
    fs.symlinkSync(dependency,path.join(dependency,"cycle"),process.platform==="win32"?"junction":"dir");
    assert.throws(()=>projectEvidenceIdentity(inspectProject(f.project)),{code:"EVIDENCE_INPUT_CYCLE"});
  } finally {f.close();}
});

test("old evidence cannot be relabeled with a new requirement and original revisions cannot disappear",()=>{
  const f=fixture();try {
    const id=f.native("project_build",[{...requirement,text:"Different captured requirement"}]);
    assert.match(errorCodes(f.assess(id)),/REQUIREMENT_EVIDENCE_UNBOUND/);
    const valid=f.assess(f.native());
    const next={...requirement,revision:2,text:"Build with the requested fix",original_text:requirement.text,history:[{revision:1,text:requirement.text,reason:"New acceptance requested"}],task_ids:["T1"],mode:"build-only"};
    const stale=f.assess(f.native(),{previous_assessment_id:valid.run_id,requirements:[next]});assert.equal(stale.contract_satisfied,false);assert.match(errorCodes(stale),/REQUIREMENT_EVIDENCE_STALE/);
    assert.throws(()=>f.service.assess({action:"assess",previous_assessment_id:valid.run_id,requirements:[{...next,id:"R2"}]}),{code:"REQUIREMENT_REMOVED"});
    assert.throws(()=>f.service.assess({action:"assess",requirements:[{...next,original_text:"Rewritten original"}]}),{code:"REQUIREMENT_ORIGINAL_CHANGED"});
  } finally {f.close();}
});

test("host review is explicit and does not impose a device requirement or claim objective business proof",()=>{
  const f=fixture();try {
    const assessed=f.service.assess({action:"assess",requirements:[{...requirement,original_text:requirement.text,task_ids:["T1"],mode:"host-review"}],host_reviews:[{requirement_id:"R1",requirement_revision:1,task_id:"T1",assessment:"satisfied",observations:"Host reviewed the requested prose and recorded this assessment."}]});
    assert.equal(assessed.contract_satisfied,true);assert.equal(assessed.business_verified,false);
    assert.equal(assessed.coverage.native_requirements,0);
    assert.equal(assessed.coverage.host_review_requirements,1);
    assert.deepEqual(assessed.coverage.satisfied_requirements,["R1"]);
    const body=JSON.parse(f.store.get(assessed.run_id).result!);assert.equal(body.results[0].tasks[0].host_review.assessment,"satisfied");
  } finally {f.close();}
});

test("UI evidence requires an exact assertion/review mapping and a deployment for project acceptance",()=>{
  const f=fixture();try {
    const id=f.native("ui_test"),requirements=[{...requirement,original_text:requirement.text,task_ids:["T1"],mode:"ui"}];
    const evidence=[{requirement_id:"R1",requirement_revision:1,task_id:"T1",run_id:id,assertion_id:"assertion"}];
    assert.match(errorCodes(f.assess(id,{requirements,evidence})),/UI_DEPLOYMENT_UNBOUND/);
    const deviceOnly=f.service.assess({action:"assess",requirements,evidence});assert.equal(deviceOnly.contract_satisfied,true);
    const wrongReview=f.service.assess({action:"assess",requirements,evidence:[{...evidence[0],review_id:"3aab560a-40a4-487b-8626-72bc3ec87811"}]});assert.equal(wrongReview.contract_satisfied,false);
  } finally {f.close();}
});

test("runtime/resource/toolchain/scope and requirement identity deltas cannot stay current",()=>{
  const f=fixture();try {
    const identity=captureEvidenceIdentity(f.scope,[requirement],false);
    for(const key of ["runtime_sha256","resource_sha256","upstream_lock_sha256","dependency_lock_sha256","scope_sha256","requirements_sha256"] as const) assert.deepEqual(compareEvidenceIdentity(identity,{...identity,[key]:"changed"}),[key]);
    assert.deepEqual(compareEvidenceIdentity({...identity,toolchain_sha256:"old"},identity),["toolchain_sha256"]);
  } finally {f.close();}
});

test("large retained results are read through bounded artifact pages with exact length validation",()=>{
  const f=fixture();try {
    const body={large:"x".repeat(150000)},artifact=f.store.artifact("request",JSON.stringify(body),"application/json");
    assert.deepEqual(resolveEvidenceResult(f.store,{result_artifact:artifact}),body);
    assert.throws(()=>resolveEvidenceResult(f.store,{result_artifact:{...artifact,bytes:artifact.bytes+1}}),{code:"EVIDENCE_ARTIFACT_INVALID"});
  } finally {f.close();}
});

test("acceptance reports changed components and preserves independently current requirements", () => {
  const f=fixture();try {
    const first=f.native();
    const secondProject=path.join(f.root,"second");
    fs.cpSync(f.project,secondProject,{recursive:true});
    const secondRequirement={...requirement,id:"R2",text:"The second application builds"};
    const second=f.store.create("project_build",{requirements:[secondRequirement]}).run;
    const scope={project_path:secondProject},artifact=path.join(secondProject,"build","fixture.hap");
    f.store.update(second.id,"succeeded",{_evidence:{identity:captureEvidenceIdentity(scope,[secondRequirement],false),scope,requirements:[secondRequirement],artifacts:[{path:artifact,sha256:fileDigest(artifact)}]}});
    fs.appendFileSync(path.join(f.project,"entry/src/main/ets/pages/Index.ets"),"\n// new input");
    const result=f.service.assess({action:"assess",requirements:[requirement,secondRequirement].map(row=>({...row,original_text:row.text,task_ids:["T1"],mode:"build-only"})),evidence:[{requirement_id:"R1",requirement_revision:1,task_id:"T1",run_id:first},{requirement_id:"R2",requirement_revision:1,task_id:"T1",run_id:second.id}]});
    assert.deepEqual(result.coverage.pending_requirements,["R1"]);
    assert.deepEqual(result.coverage.satisfied_requirements,["R2"]);
    const follow=z.object({action:z.literal("fresh_bound_evidence"),workflow_chain:z.array(z.string()),changed_inputs:z.array(z.object({input:z.string(),recorded:z.unknown(),current:z.unknown()})),unaffected_file_scope_proven:z.literal(false),automatic_replay:z.literal(false)}).parse(result.results[0]!.pending_tasks[0]!.evidence[0]!.follow_up);
    assert.deepEqual(follow.workflow_chain,["project_build"]);
    assert.ok(follow.changed_inputs.some(item=>item.input==="source_tree_sha256" && item.recorded!==item.current));
    assert.equal(f.store.get(first).status,"succeeded");
    assert.equal(f.store.runCount(),3,"Assessment creates one receipt, never a rerun");
  } finally {f.close();}
});

test("artifact/revision changes identify their inputs; missing or unsettled runs remain inspection cases", () => {
  const f=fixture();try {
    const id=f.native();fs.writeFileSync(f.artifact,"replaced output");
    const artifact=f.assess(id);
    assert.match(JSON.stringify(artifact.results),/"input":"artifact"/);
    assert.match(JSON.stringify(artifact.results),/fixture\.hap/);
    const pending=f.store.create("app_deploy",{}).run;
    for(const run_id of [pending.id,randomUUID()]) {
      const result=f.assess(run_id);
      const follow=z.object({action:z.literal("inspect_original_run"),call:z.object({action:z.literal("status"),run_id:z.literal(run_id)}),automatic_replay:z.literal(false)}).parse(result.results[0]!.pending_tasks[0]!.evidence[0]!.follow_up);
      assert.equal(follow.call.run_id,run_id);
    }
    const next={...requirement,revision:2,text:"Build the revised feature",original_text:requirement.text,history:[{revision:1,text:requirement.text,reason:"Requested revision"}],task_ids:["T1"],mode:"build-only"};
    const changed=f.assess(id,{requirements:[next]});
    assert.match(JSON.stringify(changed.results),/"input":"requirement_revision","recorded":1,"current":2/);
  } finally {f.close();}
});

test("selected evidence resolves original bindings and refuses ambiguous or retroactive task mappings", () => {
  const f=fixture();try {
    const id=f.native();
    const input={action:"assess",requirements:[{...requirement,original_text:requirement.text,task_ids:["T1"],mode:"build-only"}],evidence_run_ids:[id,id]};
    const selected=f.service.assess(input);
    assert.equal(selected.contract_satisfied,true);
    const body=JSON.parse(f.store.get(selected.run_id).result!);
    assert.deepEqual(body.input.evidence,[{requirement_id:"R1",requirement_revision:1,task_id:"T1",run_id:id}]);
    const ambiguous=f.service.assess({...input,requirements:[{...input.requirements[0],task_ids:["T1","T2"]}]});
    assert.equal(ambiguous.contract_satisfied,false);
    assert.match(JSON.stringify(ambiguous.reference_resolution),/EVIDENCE_TASK_MAPPING_REQUIRED/);
    const original=f.native("project_build",[{...requirement,text:"An unrelated original requirement"}]);
    const unbound=f.service.assess({...input,evidence_run_ids:[original]});
    assert.equal(unbound.contract_satisfied,false);
    assert.match(JSON.stringify(unbound.reference_resolution),/REQUIREMENT_EVIDENCE_UNBOUND/);
    assert.equal(JSON.parse(f.store.get(original).result!)._evidence.requirements[0].text,"An unrelated original requirement");
  } finally {f.close();}
});

test("selected deployment follows only digest-matching build references", () => {
  const f=fixture();try {
    const build=f.native(),buildResult=JSON.parse(f.store.get(build).result!);
    const deployment=f.store.create("app_deploy",{requirements:[requirement]}).run;
    const seal={...buildResult._evidence,build:{run_id:build,result_sha256:digest(buildResult),requirements:[requirement]}};
    f.store.update(deployment.id,"succeeded",{_evidence:seal});
    const input={action:"assess",requirements:[{...requirement,original_text:requirement.text,task_ids:["T1"],mode:"build-only"}],evidence_run_ids:[deployment.id]};
    const good=f.service.assess(input);
    assert.equal(good.contract_satisfied,true);
    assert.ok(f.store.db.prepare("SELECT 1 FROM run_dependencies WHERE parent_run_id=? AND run_id=?").get(good.run_id,deployment.id));
    // Simulate corrupt retained bytes; normal settled-run updates are ownership-protected.
    f.store.db.prepare("UPDATE runs SET result=? WHERE id=?").run(JSON.stringify({...buildResult,changed:true}),build);
    const changed=f.service.assess(input);
    assert.equal(changed.contract_satisfied,false);
    assert.match(JSON.stringify(changed.reference_resolution),/EVIDENCE_LINK_CHANGED/);
  } finally {f.close();}
});
