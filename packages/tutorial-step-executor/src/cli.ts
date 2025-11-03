#!/usr/bin/env node

/**
 * CLI for the tutorial step executor
 * 
 * Usage: node cli.js <yaml-file>
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { TutorialSpecSchema } from './dsl/schemas.js';
import type { TutorialSpec } from './dsl/index.js';
import { z } from 'zod';
import { ZodError } from 'zod';
import { TutorialExecutor } from './executor/index.js';

function parseYamlFile(filePath: string): unknown {
  console.log(`[DEBUG] Reading YAML file: ${filePath}`);
  
  // Try multiple resolution strategies
  let resolvedPath: string | null = null;
  
  // Strategy 1: Resolve relative to current working directory
  const cwdPath = resolve(filePath);
  console.log(`[DEBUG] Trying path (relative to CWD): ${cwdPath}`);
  if (existsSync(cwdPath)) {
    resolvedPath = cwdPath;
  } else {
    // Strategy 2: If absolute path, use as-is
    if (filePath.startsWith('/')) {
      resolvedPath = filePath;
    } else {
      // Strategy 3: Try relative to monorepo root (2 levels up from package)
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const packageDir = resolve(__dirname, '..');
      const monorepoRoot = resolve(packageDir, '../..');
      const monorepoPath = resolve(monorepoRoot, filePath);
      console.log(`[DEBUG] Trying path (relative to monorepo root): ${monorepoPath}`);
      if (existsSync(monorepoPath)) {
        resolvedPath = monorepoPath;
      }
    }
  }
  
  if (!resolvedPath || !existsSync(resolvedPath)) {
    console.error(`[ERROR] File not found: ${filePath}`);
    console.error(`[ERROR] Tried: ${cwdPath}`);
    if (filePath.startsWith('/') === false) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const packageDir = resolve(__dirname, '..');
      const monorepoRoot = resolve(packageDir, '../..');
      const monorepoPath = resolve(monorepoRoot, filePath);
      console.error(`[ERROR] Also tried: ${monorepoPath}`);
    }
    process.exit(1);
  }
  
  console.log(`[DEBUG] Using resolved path: ${resolvedPath}`);
  
  try {
    const fileContents = readFileSync(resolvedPath, 'utf-8');
    console.log(`[DEBUG] Read ${fileContents.length} characters from file`);
    
    const parsed = yaml.load(fileContents);
    console.log(`[DEBUG] Successfully parsed YAML into JavaScript object`);
    console.log(`[DEBUG] Parsed object keys: ${Object.keys(parsed as object).join(', ')}`);
    
    return parsed;
  } catch (error) {
    console.error(`[ERROR] Failed to read or parse YAML file: ${error}`);
    process.exit(1);
  }
}

function parseTutorialSpec(data: unknown): TutorialSpec {
  console.log(`[DEBUG] Parsing tutorial specification with Zod`);
  
  try {
    const result = TutorialSpecSchema.parse(data);
    
    console.log(`[DEBUG] Successfully validated tutorial spec`);
    if (result.metadata) {
      console.log(`[DEBUG] Tutorial metadata: title="${result.metadata.title || '(none)'}"`);
    }
    if (result.prerequisites) {
      console.log(`[DEBUG] Tutorial prerequisites: ${result.prerequisites.commands?.length || 0} commands`);
    }
    console.log(`[DEBUG] Found ${result.steps.length} steps`);
    
    return result;
  } catch (error) {
    if (error instanceof ZodError) {
      console.error(`[ERROR] Validation failed:`);
      console.error(JSON.stringify(z.treeifyError(error), null, 2));
    } else {
      console.error(`[ERROR] Failed to parse tutorial spec: ${error}`);
    }
    process.exit(1);
  }
}

async function main() {
  console.log('[INFO] Starting tutorial step executor CLI');

  const args = process.argv.slice(2);
  
  // Parse flags
  const keepWorkspace = args.includes('--keep-workspace') || args.includes('-k');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const debugScreenshots = args.includes('--screenshots') || args.includes('--debug-screenshots');
  const yamlFile = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));

  if (!yamlFile) {
    console.error('[ERROR] No YAML file provided');
    console.error('Usage: tutorial-executor <yaml-file> [options]');
    console.error('Options:');
    console.error('  --keep-workspace, -k    Keep workspace after execution (for debugging)');
    console.error('  --verbose, -v          Show detailed debug output');
    console.error('  --screenshots          Automatically save screenshots after browser steps');
    process.exit(1);
  }

  if (verbose) {
    console.log(`[DEBUG] YAML file: ${yamlFile}`);
    console.log(`[DEBUG] Keep workspace: ${keepWorkspace}`);
    console.log(`[DEBUG] Debug screenshots: ${debugScreenshots}`);
  }

  // Parse and validate tutorial spec
  const parsedYaml = parseYamlFile(yamlFile);
  const tutorialSpec = parseTutorialSpec(parsedYaml);

  // Display tutorial info
  console.log('\n[INFO] Tutorial Specification:');
  if (tutorialSpec.metadata?.title) {
    console.log(`  Title: ${tutorialSpec.metadata.title}`);
  }
  if (tutorialSpec.metadata?.version) {
    console.log(`  Version: ${tutorialSpec.metadata.version}`);
  }
  if (tutorialSpec.metadata?.description) {
    console.log(`  Description: ${tutorialSpec.metadata.description}`);
  }
  console.log(`  Total Steps: ${tutorialSpec.steps.length}`);
  console.log(`  Step Types: ${[...new Set(tutorialSpec.steps.map(s => s.type))].join(', ')}`);

  // Execute tutorial
  console.log('\n[INFO] Executing tutorial steps...\n');
  
  const executor = new TutorialExecutor(tutorialSpec, undefined, { debugScreenshots });
  
  try {
    const result = await executor.execute();

    // Display results
    console.log('\n[INFO] Execution Results:');
    console.log(`  Workspace: ${result.workspaceRoot}`);
    console.log(`  Steps Executed: ${result.stepResults.length}/${tutorialSpec.steps.length}`);
    console.log(`  Overall Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}\n`);

    // Display step-by-step results
    for (const stepResult of result.stepResults) {
      const step = tutorialSpec.steps.find(s => s.id === stepResult.stepId);
      const icon = stepResult.success ? '✅' : '❌';
      const status = stepResult.success ? 'PASS' : 'FAIL';
      
      console.log(`${icon} Step ${stepResult.stepNumber}: ${step?.description || stepResult.stepId} [${status}]`);
      
      if (!stepResult.success && stepResult.error) {
        console.log(`   Error: ${stepResult.error}`);
      }
      
      if (verbose && stepResult.output) {
        const outputLines = stepResult.output.split('\n');
        const preview = outputLines.length > 5 
          ? outputLines.slice(0, 5).join('\n') + `\n   ... (${outputLines.length - 5} more lines)`
          : stepResult.output;
        console.log(`   Output:\n${preview.split('\n').map(line => `   ${line}`).join('\n')}`);
      }
    }

    // Cleanup
    await executor.cleanup(keepWorkspace);

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
  } catch (error: any) {
    console.error('\n[ERROR] Fatal error during execution:');
    console.error(error.message || String(error));
    
    if (verbose && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    await executor.cleanup(keepWorkspace);
    process.exit(1);
  }
}

main();
