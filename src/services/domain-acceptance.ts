import fs from "node:fs";
import { z } from "zod";
import { domainAcceptanceSchema } from "../core/acceptance-contracts.js";
import { digest } from "../core/files.js";
import { invariant, errorResult, object } from "../core/errors.js";
import type { StateStore } from "../core/store.js";
import { captureEvidenceIdentity, compareEvidenceIdentity, evidenceIdentityChanges } from "./evidence-identity.js";
import { acceptanceFollowUp } from "./acceptance-follow-up.js";
import { resolveAcceptanceReferences } from "./acceptance-references.js";

import { evidenceSealSchema, resolveEvidenceResult, verifyEvidenceArtifacts } from "./evidence-result.js";

/** Immutable assessment receipts, not a planning/task lifecycle. Host keeps requirement editing. */
export class DomainAcceptanceService {
  constructor(readonly store: StateStore, readonly uiStatus: (id: string) => Record<string, unknown>) {}
  private resolveResult(raw:unknown) { return resolveEvidenceResult(this.store,raw); }
  assess(raw: unknown) {
    const input=domainAcceptanceSchema.parse(raw);
    const resolved = resolveAcceptanceReferences(this.store, input, this.uiStatus);
    input.evidence = resolved.references;
    const scope=input.project_path ? {project_path:fs.realpathSync.native(input.project_path),product:input.product,module_targets:input.module_targets} : undefined;
    const requirements=new Map(input.requirements.map(row=>[row.id,row]));
    for(const row of input.requirements) {
      invariant(new Set(row.task_ids).size===row.task_ids.length,"ACCEPTANCE_TASK_DUPLICATE","Task references must be unique");
      invariant(row.history.every((item,index)=>item.revision===index+1) && row.history.length===row.revision-1,"REQUIREMENT_HISTORY_INVALID","Retain every prior requirement revision in order");
      invariant((row.revision===1 ? row.text : row.history[0]?.text)===row.original_text,"REQUIREMENT_ORIGINAL_CHANGED","Original requirement text must remain available");
    }
    if(input.previous_assessment_id) {
      const previous=this.store.get(input.previous_assessment_id);
      invariant(previous.workflow==="domain_acceptance" && previous.result,"ASSESSMENT_NOT_FOUND","previous_assessment_id must identify a retained assessment receipt");
      const prior=domainAcceptanceSchema.parse(object(JSON.parse(previous.result)).input);
      for(const old of prior.requirements) {
        const next=requirements.get(old.id);
        invariant(next && next.original_text===old.original_text && next.revision>=old.revision,"REQUIREMENT_REMOVED","A linked revision cannot drop or replace an original requirement");
        invariant(next.revision===old.revision ? next.text===old.text && digest(next.history)===digest(old.history) : next.history[old.revision-1]?.text===old.text && digest(next.history.slice(0,old.history.length))===digest(old.history),"REQUIREMENT_HISTORY_CHANGED","Linked assessments must preserve previous requirement revisions");
      }
    }
    const dependencies=new Set<string>([...resolved.retained_runs,...(input.previous_assessment_id?[input.previous_assessment_id]:[])]);
    const results=input.requirements.map(requirement=>{
      const tasks=requirement.task_ids.map(task_id=>{
        const references=input.evidence.filter(item=>item.requirement_id===requirement.id && item.task_id===task_id);
        const evidence=references.map(reference=>{
          let workflow: string | undefined;
          let projectBound = !!scope;
          try {
            const run=this.store.get(reference.run_id);
            workflow = run.workflow;
            dependencies.add(run.id);
            invariant(reference.requirement_revision===requirement.revision,"REQUIREMENT_EVIDENCE_STALE","Evidence maps an earlier requirement revision", {
              changed_inputs: [{ input: "requirement_revision", recorded: reference.requirement_revision, current: requirement.revision }],
            });
            const result=this.resolveResult(run.result ? JSON.parse(run.result):{}), context=object(JSON.parse(run.input));
            projectBound ||= typeof context.project_path === "string";
            invariant(run.status==="succeeded","EVIDENCE_NOT_SUCCEEDED","The native run has not succeeded");
            const seal=evidenceSealSchema.parse(result._evidence);
            projectBound ||= typeof seal.scope.project_path === "string";
            const bindings=seal.requirements ?? context.requirements;
            invariant(Array.isArray(bindings) && bindings.some(item=>item.id===requirement.id && item.revision===requirement.revision && item.text===requirement.text),"REQUIREMENT_EVIDENCE_UNBOUND","The native operation did not capture this requirement and revision at start; use fresh bound evidence", {
              changed_inputs: [{ input: "requirement_binding", requirement_id: requirement.id, recorded: Array.isArray(bindings) ? bindings.find(item=>item.id===requirement.id) ?? null : null, current: { id: requirement.id, revision: requirement.revision, text: requirement.text } }],
            });
            const current=captureEvidenceIdentity(seal.scope,bindings,!!seal.identity.toolchain_sha256);
            const changed=compareEvidenceIdentity(seal.identity,current);
            invariant(!changed.length,"EVIDENCE_STALE",`Evidence input identity changed: ${changed.join(", ")}`, {
              changed_inputs: evidenceIdentityChanges(seal.identity, current),
              file_manifest_available: false,
            });
            if(scope) invariant(seal.identity.project_path===scope.project_path && (!scope.product || seal.identity.product===scope.product) && (!scope.module_targets || digest(seal.identity.module_targets)===digest(scope.module_targets)),"EVIDENCE_SCOPE_MISMATCH","Evidence belongs to a different project/product/module scope", {
              changed_inputs: [{ input: "requested_scope", recorded: {project_path:seal.identity.project_path,product:seal.identity.product,module_targets:seal.identity.module_targets}, current: scope }],
            });
            verifyEvidenceArtifacts(seal.artifacts,this.store);
            let passed=false;
            if(requirement.mode==="build-only") passed=["project_build","build_run","build_deploy_verify"].includes(run.workflow) && seal.artifacts.length>0;
            if(requirement.mode==="run") {
              const launch=this.resolveResult(result.launch_application ?? {}), build=this.resolveResult(result.build_or_hot_apply ?? {}), startup=object(launch.startup_check ?? object(build.result ?? {}).startup_check ?? {});
              passed=["app_deploy","build_run","build_deploy_verify"].includes(run.workflow) && startup.process==="stable";
            }
            if(requirement.mode==="ui") {
              if(run.workflow==="ui_test") {
                invariant(!scope || seal.deployment,"UI_DEPLOYMENT_UNBOUND","Project acceptance requires UI evidence linked to a successful deployment of the same source and artifact identity");
                if(seal.deployment) {
                  dependencies.add(seal.deployment.run_id);
                  const deployed=this.store.get(seal.deployment.run_id);
                  const deploymentResult=this.resolveResult(JSON.parse(deployed.result!));
                  invariant(deployed.status==="succeeded" && digest(deploymentResult)===seal.deployment.result_sha256,"UI_DEPLOYMENT_CHANGED","Linked deployment result changed or is no longer retained");
                  const deploymentSeal=evidenceSealSchema.parse(deploymentResult._evidence);
                  verifyEvidenceArtifacts(deploymentSeal.artifacts,this.store);
                  const deploymentChanges = evidenceIdentityChanges(deploymentSeal.identity,captureEvidenceIdentity(deploymentSeal.scope,deploymentSeal.requirements,!!deploymentSeal.identity.toolchain_sha256));
                  invariant(!deploymentChanges.length,"UI_DEPLOYMENT_STALE","Linked deployment inputs no longer match current inputs", {
                    deployment_run_id: deployed.id, changed_inputs: deploymentChanges, file_manifest_available: false,
                  });
                }
                const status=this.uiStatus(run.id), steps=Array.isArray(status.steps)?status.steps:[];
                passed=status.verified===true && steps.some(step=> {const value=object(step); return value.id===reference.assertion_id && (!reference.review_id || object(value.check ?? {}).review_id===reference.review_id) && value.status==="passed" && Array.isArray(value.requirement_ids) && value.requirement_ids.includes(requirement.id) && Array.isArray(value.task_ids) && value.task_ids.includes(task_id);});
              } else passed=run.workflow==="build_deploy_verify" && reference.assertion_id==="final_assertion" && this.resolveResult(result.final_assertion).verified===true;
            }
            return {run_id:run.id,passed,kind:"native",changed,reason:passed?null:"Native outcome does not meet the selected requirement mode",result_sha256:digest(result),assertion_id:reference.assertion_id??null,
              ...(!passed ? {follow_up: {action:"inspect_evidence_mapping",requirement_id:reference.requirement_id,task_id:reference.task_id,original_run_id:run.id,
                call:{tool:"workflow_run",action:"read_result",run_id:run.id},automatic_replay:false,
                reason:"Check the declared mode and assertion/review/task references before obtaining another outcome."}} : {})};
          } catch(error) {
            const failure = errorResult(error);
            return {run_id:reference.run_id,passed:false,kind:"native",error:failure,
              follow_up: acceptanceFollowUp(requirement.mode, reference, failure, workflow, projectBound)};
          }
        });
        const review=input.host_reviews.find(item=>item.requirement_id===requirement.id && item.task_id===task_id && item.requirement_revision===requirement.revision);
        if(review) for(const id of review.evidence_artifact_ids) { this.store.readArtifact(id,0,1); const row=this.store.db.prepare("SELECT run_id FROM artifacts WHERE id=?").get(id) as {run_id:string}; if(this.store.db.prepare("SELECT id FROM runs WHERE id=?").get(row.run_id)) dependencies.add(row.run_id); }
        const satisfied=requirement.mode==="host-review" ? review?.assessment==="satisfied" : evidence.some(item=>item.passed);
        return {task_id,satisfied:!!satisfied,evidence,host_review:review??null};
      });
      return {requirement_id:requirement.id,revision:requirement.revision,mode:requirement.mode,satisfied:tasks.every(item=>item.satisfied),tasks};
    });
    for(const item of [...input.evidence,...input.host_reviews]) invariant(requirements.get(item.requirement_id)?.task_ids.includes(item.task_id),"ACCEPTANCE_REFERENCE_UNKNOWN","Every evidence or review reference must resolve to a declared requirement and task");
    const body={format:1,input,reference_resolution:{selected_run_ids:input.evidence_run_ids,issues:resolved.issues,issue_count:resolved.issue_count,issues_truncated:resolved.issues_truncated},requirements_sha256:digest(input.requirements),results,contract_satisfied:results.every(row=>row.satisfied),
      native_verification_satisfied:results.filter(row=>row.mode!=="host-review").every(row=>row.satisfied),
      business_verified:false,meaning:"This receipt checks the declared requirement/task/evidence mapping. Host translation of prose and visual judgment remain explicit assessments, not independent proof of arbitrary business correctness.",created_at:Date.now()};
    return this.store.db.transaction(()=>{
      this.store.capacity(Buffer.byteLength(JSON.stringify(body))*3+8192);
      const {run}=this.store.create("domain_acceptance",{requirements_sha256:body.requirements_sha256},undefined,{input});
      for(const id of dependencies) { this.store.get(id); this.store.db.prepare("INSERT OR IGNORE INTO run_dependencies VALUES (?,?)").run(run.id,id); }
      const artifact=this.store.artifact(run.id,JSON.stringify(body),"application/json");
      this.store.update(run.id,"succeeded",{...body,artifact});
      return {assessment_id:run.id,run_id:run.id,contract_satisfied:body.contract_satisfied,business_verified:false,
        reference_resolution: body.reference_resolution,
        coverage: {
          declared_requirements: results.length,
          satisfied_requirements: results.filter(row => row.satisfied).map(row => row.requirement_id),
          pending_requirements: results.filter(row => !row.satisfied).map(row => row.requirement_id),
          native_requirements: results.filter(row => row.mode !== "host-review").length,
          host_review_requirements: results.filter(row => row.mode === "host-review").length,
          scope: "Only explicitly declared tasks and independently checked evidence; no inferred file-level impact boundary",
        },
        results:results.map(({tasks,...row})=>({...row,pending_tasks:tasks.filter(task=>!task.satisfied).map(task=>({task_id:task.task_id,evidence:task.evidence}))})),artifact,
        next_action:body.contract_satisfied?"Retain this assessment with its declared scope and host judgment limits":"Read the evidence diagnostics and rerun only affected requirements with fresh bindings"};
    }).immediate();
  }
}
