#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { resolve, join, extname, basename } from 'path';
import type { FailureDossier, ExecutionFailureDossier, TutorialInput } from './shared/index.js';
import type { TutorialSpec } from '@tutorial-validator/step-executor';
import { TutorialSpecSchema, TutorialExecutor } from '@tutorial-validator/step-executor';
import { ExtractionAgent } from './extraction/index.js';
import yaml from 'js-yaml';

async function main() {
  console.log('[DEBUG] Starting tutorial validator CLI');

  const args = process.argv.slice(2);
  const tutorialPath = args.find(a => !a.startsWith('-'));
  if (!tutorialPath) {
    console.error('Usage: tutorial-validator <tutorial.(md|mdx)|dir> [--max-iters 3] [--keep-workspace] [--debug-screenshots] [--out steps.yml] [--debugFiles]');
    process.exit(1);
  }

  console.log(`[DEBUG] Tutorial path: ${tutorialPath}`);

  const keepWorkspace = args.includes('--keep-workspace') || args.includes('-k');
  const debugScreenshots = args.includes('--debug-screenshots') || args.includes('--screenshots');
  const debugFiles = args.includes('--debugFiles') || args.includes('--debug-files') || args.includes('-df');
  const maxIters = getNumericFlag(args, ['--max-iters', '--maxIters'], 3);
  const outFile = getStringFlag(args, '--out', '');
  const execVerbose = args.includes('--executor-verbose') || args.includes('-v');

  console.log('[DEBUG] Configuration:');
  console.log(`[DEBUG]   - keepWorkspace: ${keepWorkspace}`);
  console.log(`[DEBUG]   - debugScreenshots: ${debugScreenshots}`);
  console.log(`[DEBUG]   - debugFiles: ${debugFiles}`);
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
  const extractionAgent = new ExtractionAgent(tutorialPath);
  console.log('[DEBUG] Initialized ExtractionAgent');

  // Create debug directory if debugFiles is enabled
  let debugDir: string | null = null;
  if (debugFiles) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const tutorialPathSanitized = basename(tutorialPath).replace(/[^a-zA-Z0-9-_]/g, '-');
    debugDir = join('debug', `validate-${tutorialPathSanitized}-${timestamp}`);
    await mkdir(debugDir, { recursive: true });
    console.log(`[DEBUG] Created debug directory: ${debugDir}`);
  }

  for (let iter = 1; iter <= maxIters; iter++) {
    console.log(`\n[DEBUG] ========== Iteration ${iter}/${maxIters} ==========`);

    const startExtract = Date.now();
    const { spec, prompt } = await extractionAgent.extractSteps(tutorial, { priorFailures });
    const extractDuration = Date.now() - startExtract;

    // Save prompt and YML for this iteration if debugFiles is enabled
    if (debugFiles && debugDir) {
      await writeFile(join(debugDir, `prompt-${iter}.md`), prompt, 'utf-8');
      console.log(`[DEBUG] Saved prompt to ${debugDir}/prompt-${iter}.md`);

      const ymlContent = yamlFromSpec(spec);
      await writeFile(join(debugDir, `steps-${iter}.yml`), ymlContent, 'utf-8');
      console.log(`[DEBUG] Saved steps to ${debugDir}/steps-${iter}.yml`);
    }
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
      const schemaFailure: FailureDossier = {
        kind: 'schema-validation',
        schemaErrorsJson: JSON.stringify(parse.error, null, 2),
        message: 'Spec failed schema validation. Please fix and regenerate.',
      };
      priorFailures.push(schemaFailure);
      console.log(`[DEBUG] Added schema validation failure to priorFailures (total: ${priorFailures.length})`);
      
      // Update failures.md with all failures so far if debugFiles is enabled
      if (debugFiles && debugDir) {
        await writeFailuresFile(debugDir, priorFailures);
      }
      
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
      
      // Write final failures.md (should be empty on success) if debugFiles is enabled
      if (debugFiles && debugDir) {
        await writeFailuresFile(debugDir, priorFailures);
      }
      
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

    // Update failures.md with all failures so far if debugFiles is enabled
    if (debugFiles && debugDir) {
      await writeFailuresFile(debugDir, priorFailures);
    }

    if (iter < maxIters) {
      console.log(`[DEBUG] Retrying with failure context...`);
    }
  }

  // If we reach here, we exhausted retries
  console.log(`[DEBUG] ========== Exhausted all ${maxIters} iteration(s) ==========`);
  console.log(`[DEBUG] Final failure count: ${priorFailures.length}`);
  
  // Final update to failures.md if debugFiles is enabled
  if (debugFiles && debugDir) {
    await writeFailuresFile(debugDir, priorFailures);
  }
  
  writeReport({ ok: false, priorFailures });
  process.exit(1);
}

function getNumericFlag(args: string[], names: string[], def: number): number {
  for (const name of names) {
    const idx = args.findIndex(a => a === name);
    if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
      const parsed = parseInt(args[idx + 1], 10);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return def;
}

function getStringFlag(args: string[], name: string, def: string): string {
  const idx = args.findIndex(a => a === name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return args[idx + 1];
  }
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
  // Add schema comment at the top (like other YAML files in the project)
  const schemaComment = '# yaml-language-server: $schema=../../packages/tutorial-step-executor/src/dsl/schema.json\n\n';
  const yamlContent = yaml.dump(spec, {
    indent: 2,
    lineWidth: -1, // Disable line wrapping
    quotingType: '"', // Use double quotes for strings
    forceQuotes: false,
    sortKeys: false,
  });
  return schemaComment + yamlContent;
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

async function writeFailuresFile(debugDir: string, failures: FailureDossier[]): Promise<void> {
  let content = '# Failure Dossiers\n\n';
  
  if (failures.length === 0) {
    content += 'No failures recorded.\n';
  } else {
    failures.forEach((failure, idx) => {
      content += `## Failure ${idx + 1}\n\n`;
      
      if (failure.kind === 'schema-validation') {
        content += `**Type:** Schema Validation Error\n\n`;
        content += `**Message:** ${failure.message}\n\n`;
        content += `**Errors:**\n\n\`\`\`json\n${failure.schemaErrorsJson}\n\`\`\`\n\n`;
      } else if (failure.kind === 'execution-failure') {
        content += `**Type:** Execution Failure\n\n`;
        content += `**Step ID:** ${failure.summary.stepId}\n\n`;
        content += `**Step Number:** ${failure.summary.stepNumber}\n\n`;
        content += `**Step Type:** ${failure.summary.stepType}\n\n`;
        if (failure.summary.description) {
          content += `**Description:** ${failure.summary.description}\n\n`;
        }
        content += `**Error:** ${failure.summary.error}\n\n`;
        if (failure.workspaceRoot) {
          content += `**Workspace Root:** ${failure.workspaceRoot}\n\n`;
        }
        if (failure.output) {
          content += `**Output:**\n\n\`\`\`\n${failure.output}\n\`\`\`\n\n`;
        }
      }
      
      content += '---\n\n';
    });
  }
  
  await writeFile(join(debugDir, 'failures.md'), content, 'utf-8');
  console.log(`[DEBUG] Updated failures.md with ${failures.length} failure(s)`);
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