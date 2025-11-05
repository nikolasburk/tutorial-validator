import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { TutorialExecutor } from '../../src/executor/index.js';
import { TutorialSpecSchema } from '../../src/dsl/schemas.js';
import { LocalSandbox } from '../../src/sandbox/local.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Integration: file-system tutorial', () => {
  let executor: TutorialExecutor;
  let sandbox: LocalSandbox;

  beforeAll(async () => {
    // Load the YAML test file
    const yamlPath = resolve(__dirname, '../../tests/file-system-steps.yml');
    const yamlContent = readFileSync(yamlPath, 'utf-8');
    const parsed = yaml.load(yamlContent);
    const spec = TutorialSpecSchema.parse(parsed);

    // Create sandbox and executor
    sandbox = new LocalSandbox('test-file-system');
    executor = new TutorialExecutor(spec, sandbox);
  }, 30000);

  afterAll(async () => {
    await executor.cleanup(false); // Clean up workspace
  }, 60000); // Increase timeout for cleanup

  it('should execute all steps successfully', async () => {
    const result = await executor.execute();

    expect(result.success).toBe(true);
    expect(result.stepResults.length).toBeGreaterThan(0);
    expect(result.stepResults.every(r => r.success)).toBe(true);
  }, 30000); // 30 second timeout

  it('should create expected directory structure', async () => {
    // Re-execute to ensure directory is created
    await executor.execute();
    const workspaceRoot = sandbox.getWorkspaceRoot();

    // Verify directory was created
    const dirExists = await sandbox.fileExists('terminal-tutorial');
    expect(dirExists).toBe(true);
  }, 30000);

  it('should create expected files', async () => {
    // Re-execute to ensure files are created
    await executor.execute();

    // Verify files were created
    const notesExists = await sandbox.fileExists('terminal-tutorial/notes.txt');
    expect(notesExists).toBe(true);

    // Verify other files from the tutorial
    const file1Exists = await sandbox.fileExists('terminal-tutorial/file1.txt');
    expect(file1Exists).toBe(true);

    const file2Exists = await sandbox.fileExists('terminal-tutorial/file2.txt');
    expect(file2Exists).toBe(true);
  }, 30000);

  it('should have correct file contents', async () => {
    // Re-execute to ensure files have correct content
    await executor.execute();

    // Verify file contents
    const notesContent = await sandbox.readFile('terminal-tutorial/notes.txt');
    expect(notesContent).toContain('Hello, Terminal!');
    expect(notesContent).toContain('This is my first tutorial.');

    // Verify docs/readme.txt exists (created in the tutorial)
    const readmeExists = await sandbox.fileExists('terminal-tutorial/docs/readme.txt');
    expect(readmeExists).toBe(true);
  }, 30000);

  it('should track working directory changes', async () => {
    // Create a fresh executor for this test to avoid state issues
    const yamlPath = resolve(__dirname, '../../tests/file-system-steps.yml');
    const yamlContent = readFileSync(yamlPath, 'utf-8');
    const parsed = yaml.load(yamlContent);
    const spec = TutorialSpecSchema.parse(parsed);
    const testSandbox = new LocalSandbox('test-file-system-wd');
    const testExecutor = new TutorialExecutor(spec, testSandbox);

    try {
      const result = await testExecutor.execute();

      // Verify that steps executed successfully (which means working directory tracking worked)
      expect(result.success).toBe(true);
      // The tutorial includes steps that change directory and verify location
      // If all steps passed, working directory tracking is working
    } finally {
      await testExecutor.cleanup(false);
    }
  }, 30000);
});

