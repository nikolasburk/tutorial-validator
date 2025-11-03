#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, extname } from 'path';
import type { FailureDossier, ExecutionFailureDossier, TutorialInput } from './shared/index.js';
import type { TutorialSpec } from '@tutorial-validator/step-executor';
import { TutorialSpecSchema, TutorialExecutor } from '@tutorial-validator/step-executor';
import { ExtractionAgent } from './extraction/index.js';

async function main() {
  console.log('[DEBUG] Starting tutorial validator CLI');
  
  const args = process.argv.slice(2);
  const tutorialPath = args.find(a => !a.startsWith('-'));
  if (!tutorialPath) {
    console.error('Usage: tutorial-validator <tutorial.(md|mdx)|dir> [--max-iters 3] [--keep-workspace] [--debug-screenshots] [--out steps.yml]');
    process.exit(1);
  }

  console.log(`[DEBUG] Tutorial path: ${tutorialPath}`);

  const keepWorkspace = args.includes('--keep-workspace') || args.includes('-k');
  const debugScreenshots = args.includes('--debug-screenshots') || args.includes('--screenshots');
  const maxIters = getFlag(args, '--max-iters', 3);
  const outFile = getFlag(args, '--out', '');
  const execVerbose = args.includes('--executor-verbose') || args.includes('-v');

  console.log('[DEBUG] Configuration:');
  console.log(`[DEBUG]   - keepWorkspace: ${keepWorkspace}`);
  console.log(`[DEBUG]   - debugScreenshots: ${debugScreenshots}`);
  console.log(`[DEBUG]   - maxIters: ${maxIters}`);
  console.log(`[DEBUG]   - outFile: ${outFile || '(none)'}`);
  console.log(`[DEBUG]   - execVerbose: ${execVerbose}`);

  console.log('[DEBUG] Loading tutorial input...');
  const tutorial = loadTutorialInput(tutorialPath);
  console.log(`[DEBUG] Loaded ${tutorial.files.length} tutorial file(s):`);
  tutorial.files.forEach((file, idx) => {
    console.log(`[DEBUG]   ${idx + 1}. ${file.path} (${file.contents.length} chars)`);
  });

  let priorFailures: FailureDossier[] = [];
  if (priorFailures.length > 0) {
    console.log(`[DEBUG] Starting with ${priorFailures.length} prior failure(s)`);
  }
  
  const extractionAgent = new ExtractionAgent({ priorFailures, tutorialPath });
  console.log('[DEBUG] Initialized ExtractionAgent');
  
  for (let iter = 1; iter <= maxIters; iter++) {
    console.log(`\n[DEBUG] ========== Iteration ${iter}/${maxIters} ==========`);
    
    console.log(`[DEBUG] Extracting steps from tutorial...`);
    const startExtract = Date.now();
    const spec = await extractionAgent.extractSteps(tutorial);
    const extractDuration = Date.now() - startExtract;
    console.log(`[DEBUG] Step extraction completed in ${extractDuration}ms`);
    console.log(`[DEBUG] Extracted ${spec.steps.length} step(s)`);
    if (spec.metadata?.title) {
      console.log(`[DEBUG] Tutorial title: ${spec.metadata.title}`);
    }
    
    // Validate before running
    console.log('[DEBUG] Validating extracted spec against schema...');
    const parse = TutorialSpecSchema.safeParse(spec);
    if (!parse.success) {
      console.log('[DEBUG] ❌ Schema validation failed');
      console.log(`[DEBUG] Validation errors: ${JSON.stringify(parse.error.issues.length)} issue(s)`);
      priorFailures.push({
        kind: 'schema-validation',
        schemaErrorsJson: JSON.stringify(parse.error, null, 2),
        message: 'Spec failed schema validation. Please fix and regenerate.',
      });
      console.log(`[DEBUG] Added schema validation failure to priorFailures (total: ${priorFailures.length})`);
      continue;
    }
    console.log('[DEBUG] ✅ Schema validation passed');

    if (outFile) {
      console.log(`[DEBUG] Writing spec to output file: ${outFile}`);
      await import('fs/promises').then(fs => fs.writeFile(outFile, yamlFromSpec(spec), 'utf-8'));
      console.log(`[DEBUG] Spec written to ${outFile}`);
    }

    console.log('[DEBUG] Initializing TutorialExecutor...');
    const executor = new TutorialExecutor(spec, undefined, { debugScreenshots });
    
    console.log('[DEBUG] Executing tutorial steps...');
    const startExecute = Date.now();
    const result = await executor.execute().finally(() => executor.cleanup(keepWorkspace));
    const executeDuration = Date.now() - startExecute;
    console.log(`[DEBUG] Execution completed in ${executeDuration}ms`);
    console.log(`[DEBUG] Execution result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`[DEBUG] Steps executed: ${result.stepResults.length}/${spec.steps.length}`);
    console.log(`[DEBUG] Workspace: ${result.workspaceRoot}`);

    if (result.success) {
      console.log('[DEBUG] Tutorial execution succeeded - exiting');
      printSuccess(result);
      writeReport({ ok: true, result, spec, outFile });
      process.exit(0);
    }

    console.log('[DEBUG] Tutorial execution failed - analyzing failure...');
    if (execVerbose) printStepResults(result);
    
    const failingStep = result.stepResults.find((s: any) => !s.success);
    console.log(`[DEBUG] First failing step: ${failingStep?.stepId} (step ${failingStep?.stepNumber})`);
    if (failingStep?.error) {
      console.log(`[DEBUG] Error: ${failingStep.error}`);
    }
    
    const dossier = buildFailureDossier(result, spec);
    priorFailures.push(dossier);
    console.log(`[DEBUG] Created failure dossier for step ${dossier.summary.stepId}`);
    console.log(`[DEBUG] Total prior failures: ${priorFailures.length}`);
    
    if (iter < maxIters) {
      console.log(`[DEBUG] Retrying with failure context...`);
    }
  }

  // If we reach here, we exhausted retries
  console.log(`[DEBUG] ========== Exhausted all ${maxIters} iteration(s) ==========`);
  console.log(`[DEBUG] Final failure count: ${priorFailures.length}`);
  writeReport({ ok: false, priorFailures });
  process.exit(1);
}

function getFlag(args: string[], name: string, def: any) {
  const idx = args.findIndex(a => a === name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('-')) return parseInt(args[idx + 1], 10);
  return def;
}

function loadTutorialInput(p: string): TutorialInput {
  const abs = resolve(p);
  const isDir = statSync(abs).isDirectory();
  console.log(`[DEBUG] Resolved tutorial path: ${abs} (${isDir ? 'directory' : 'file'})`);
  
  const paths = isDir
    ? walk(abs).filter(f => ['.md', '.mdx'].includes(extname(f)))
    : [abs];
  
  console.log(`[DEBUG] Found ${paths.length} file(s) to process`);
  return { files: paths.map(path => ({ path, contents: readFileSync(path, 'utf-8') })) };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}


function yamlFromSpec(spec: TutorialSpec): string {
  // Optional: emit YAML from object; or keep it JSON.
  return JSON.stringify(spec, null, 2);
}

function printSuccess(result: any) {
  console.log('\n✅ Tutorial executed successfully');
  console.log(`Workspace: ${result.workspaceRoot}`);
}

function printStepResults(result: any) {
  console.log('\n[INFO] Step results:');
  for (const s of result.stepResults) {
    const icon = s.success ? '✅' : '❌';
    console.log(`${icon} ${s.stepNumber} ${s.stepId}${s.error ? ` — ${s.error}` : ''}`);
  }
}

function buildFailureDossier(result: any, spec: TutorialSpec): ExecutionFailureDossier {
  console.log('[DEBUG] Building failure dossier...');
  const failing = result.stepResults.find((s: any) => !s.success);
  const failingStep = spec.steps.find(s => s.id === failing?.stepId);
  
  const dossier = {
    kind: 'execution-failure' as const,
    summary: {
      stepId: failing?.stepId,
      stepNumber: failing?.stepNumber,
      stepType: (failingStep as any)?.type,
      description: failingStep?.description,
      error: failing?.error,
    },
    output: failing?.output?.slice(0, 8000) || '',
    workspaceRoot: result.workspaceRoot,
  };
  
  console.log(`[DEBUG] Failure dossier created for step ${dossier.summary.stepId} (${dossier.summary.stepType})`);
  console.log(`[DEBUG] Output length: ${dossier.output.length} chars`);
  
  return dossier;
}

function writeReport(params: any) {
  console.log('[DEBUG] Writing report...');
  const out = params.outFile ? resolve(params.outFile + '.report.json') : undefined;
  const payload = JSON.stringify(params, null, 2);
  if (out) {
    require('fs').writeFileSync(out, payload, 'utf-8');
    console.log(`[DEBUG] Report written to: ${out}`);
  }
  console.log('\n--- Report ---');
  console.log(payload);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});