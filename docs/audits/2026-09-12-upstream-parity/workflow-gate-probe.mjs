import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const installation = '/Users/dreamlike/Library/Application Support/DevEcoMCP/installations/native-7-release-0.3.0-20260911-1';
const { StateStore } = await import(pathToFileURL(path.join(installation, 'dist/src/core/store.js')));
const { SkillWorkflowService } = await import(pathToFileURL(path.join(installation, 'dist/src/services/skill-workflow.js')));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deveco-workflow-audit-'));
const store = new StateStore(path.join(root, 'state'));
const service = new SkillWorkflowService(store);
const records = [];
function start(kind, objective) {
  const s = service.call({action:'start',kind,project_path:root,objective});
  const id = s.run_id;
  return {
    id,
    write(name,content) { return service.call({action:'write',run_id:id,expected_revision:service.read(id).revision,name,content}); },
    phase(phase,evidence_run_ids=[]) { return service.call({action:'transition',run_id:id,expected_revision:service.read(id).revision,phase,evidence_run_ids,rationale:'This is an isolated audit fixture; no real implementation or native build has occurred.'}); },
  };
}
try {
  for (const kind of ['plan','customize']) {
    const r=start(kind,'Implement and verify a real end-user feature or host configuration change');
    r.write('notes.md','x');
    r.phase('implementing');r.phase('verifying');
    const completed=r.phase('completed');
    records.push({scenario:kind+'_single_character_notes',phase:completed.phase,status:completed.status,verified:completed.verified,evidence:completed.transitions.at(-1).evidence,document:completed.documents['notes.md'].content});
  }
  const r=start('spec','US1: Clicking Save persists settings across restart. US2: Empty input shows validation. Require build and UI verification.');
  r.write('spec.md','# Spec\n## Requirements\nUS1 and US2 must both pass.\n## Success Criteria\nBoth requirements verified on the final build.\n## User Scenarios\nSave and empty input.');
  r.write('plan.md','# Plan\n## Technical Context\nArkUI\n## Project Structure\nentry');
  r.write('tasks.md','- [x] Both user stories implemented and checked');
  r.phase('implementing');r.phase('verifying');
  let noEvidenceError;
  try { r.phase('completed'); } catch(e) { noEvidenceError=e.code; }
  // Only fixture data is inserted into this temporary store. No compiler or device is invoked.
  const fixture=store.create('project_build',{project_path:fs.realpathSync.native(root),source_hash:'old-source-fixture'}).run;
  store.update(fixture.id,'succeeded',{fixture:true,artifacts:[]});
  fs.writeFileSync(path.join(root,'Index.ets'),'// Changed after the fixture build; no new native validation.\n');
  const completed=r.phase('completed',[fixture.id]);
  records.push({scenario:'spec_build_only_without_story_links_and_after_source_change',phase:completed.phase,status:completed.status,verified:completed.verified,noEvidenceError,evidence:completed.transitions.at(-1).evidence,fixture_notice:'Receipt is synthetic. This probes the service gate, not compiler/device correctness.'});
  const result={installation,node:process.version,scope:'isolated temporary SQLite only; no production state or device calls',temporary_state_root:root,records};
  fs.writeFileSync('/tmp/deveco-workflow-gate-probe-result.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {
  service.close();store.close();
  fs.rmSync(root,{recursive:true,force:true});
}
