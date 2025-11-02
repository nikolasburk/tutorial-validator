/**
 * Step execution logic
 * 
 * Handles the execution of tutorial steps based on the DSL.
 */

import type {
  TutorialSpec,
  TutorialStep,
  RunCommandStep,
  ChangeFileStep,
  ValidateStep,
} from '../dsl/index.js';
import type { Sandbox } from '../sandbox/index.js';
import { LocalSandbox } from '../sandbox/local.js';
import { resolve } from 'path';

/**
 * Result of executing a single step
 */
export interface StepResult {
  /** Step ID */
  stepId: string;
  /** Step number */
  stepNumber: number;
  /** Whether the step succeeded */
  success: boolean;
  /** Error message if step failed */
  error?: string;
  /** Execution output/details */
  output?: string;
}

/**
 * Result of executing a tutorial
 */
export interface ExecutionResult {
  /** Tutorial metadata */
  tutorialId?: string;
  /** Tutorial title */
  title?: string;
  /** Results for each step */
  stepResults: StepResult[];
  /** Overall success */
  success: boolean;
  /** Workspace root path */
  workspaceRoot: string;
}

/**
 * Executes a tutorial specification
 */
export class TutorialExecutor {
  private sandbox: Sandbox;
  private spec: TutorialSpec;
  /** Current working directory relative to workspace root */
  private currentWorkingDir: string;

  constructor(spec: TutorialSpec, sandbox?: Sandbox) {
    this.spec = spec;
    this.sandbox = sandbox || new LocalSandbox(spec.metadata?.title);
    // Initialize current working directory from spec
    this.currentWorkingDir = spec.workingDirectory || '';
  }

  /**
   * Execute all steps in the tutorial
   */
  async execute(): Promise<ExecutionResult> {
    const stepResults: StepResult[] = [];

    try {
      // Initialize sandbox
      await this.sandbox.initialize();

      // Check prerequisites if specified
      if (this.spec.prerequisites) {
        await this.checkPrerequisites();
      }

      // Initialize current working directory from spec
      this.currentWorkingDir = this.spec.workingDirectory || '';

      // Merge global environment variables
      const globalEnv = this.spec.env || {};

      // Execute each step
      for (const step of this.spec.steps) {
        const result = await this.executeStep(step, globalEnv);
        stepResults.push(result);

        // Stop on first failure (can be made configurable later)
        if (!result.success) {
          break;
        }
      }

      const allSuccessful = stepResults.every(r => r.success);

      return {
        tutorialId: this.spec.metadata?.title,
        title: this.spec.metadata?.title,
        stepResults,
        success: allSuccessful,
        workspaceRoot: this.sandbox.getWorkspaceRoot(),
      };
    } catch (error: any) {
      // Add error result for the step that failed
      const failedStepIndex = stepResults.length;
      const lastStep = failedStepIndex < this.spec.steps.length 
        ? this.spec.steps[failedStepIndex] 
        : null;
      
      if (lastStep) {
        stepResults.push({
          stepId: lastStep.id,
          stepNumber: lastStep.stepNumber,
          success: false,
          error: error.message || String(error),
        });
      }

      return {
        tutorialId: this.spec.metadata?.title,
        title: this.spec.metadata?.title,
        stepResults,
        success: false,
        workspaceRoot: this.sandbox.getWorkspaceRoot(),
      };
    }
  }

  /**
   * Check prerequisites before execution
   */
  private async checkPrerequisites(): Promise<void> {
    const { prerequisites } = this.spec;
    if (!prerequisites) return;

    // Check required commands
    if (prerequisites.commands) {
      for (const command of prerequisites.commands) {
        const cmdName = command.split(' ')[0];
        const result = await this.sandbox.executeCommand(
          `command -v ${cmdName} > /dev/null 2>&1 || which ${cmdName} > /dev/null 2>&1`
        );
        if (result.exitCode !== 0) {
          throw new Error(`Prerequisite command not found: ${cmdName}`);
        }
      }
    }

    // Check required environment variables
    if (prerequisites.envVars) {
      for (const envVar of prerequisites.envVars) {
        if (!process.env[envVar]) {
          throw new Error(`Required environment variable not set: ${envVar}`);
        }
      }
    }

    // TODO: Check versions (could use command --version and parse)
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: TutorialStep,
    globalEnv: Record<string, string>
  ): Promise<StepResult> {
    const stepId = step.id;
    const stepNumber = step.stepNumber;
    
    try {
      if (step.type === 'run-command') {
        return await this.executeRunCommandStep(step, globalEnv);
      } else if (step.type === 'change-file') {
        return await this.executeChangeFileStep(step);
      } else if (step.type === 'validate') {
        return await this.executeValidateStep(step, globalEnv);
      } else {
        return {
          stepId,
          stepNumber,
          success: false,
          error: `Unknown step type: ${(step as any).type}`,
        };
      }
    } catch (error: any) {
      return {
        stepId,
        stepNumber,
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Execute a run-command step
   */
  private async executeRunCommandStep(
    step: RunCommandStep,
    globalEnv: Record<string, string>
  ): Promise<StepResult> {
    // Use step-specific working directory if provided, otherwise use current state
    let workingDir = step.workingDirectory
      ? resolveWorkingDir(this.currentWorkingDir, step.workingDirectory)
      : this.currentWorkingDir || undefined;

    const env = { ...globalEnv, ...(step.env || {}) };

    // Execute the command
    const result = await this.sandbox.executeCommand(step.command, workingDir, env);

    // Check if this is a 'cd' command and update state
    if (result.exitCode === 0 && this.isCdCommand(step.command)) {
      const newDir = await this.parseCdTarget(step.command, workingDir || '');
      if (newDir !== null) {
        this.currentWorkingDir = newDir;
      }
    }

    const expectedExitCode = step.expectedExitCode ?? 0;
    const success = result.exitCode === expectedExitCode;

    return {
      stepId: step.id,
      stepNumber: step.stepNumber,
      success,
      error: success
        ? undefined
        : `Expected exit code ${expectedExitCode}, got ${result.exitCode}`,
      output: step.captureOutput !== false ? result.stdout + result.stderr : undefined,
    };
  }

  /**
   * Execute a change-file step
   */
  private async executeChangeFileStep(
    step: ChangeFileStep
  ): Promise<StepResult> {
    // File changes use the path as-is (sandbox resolves relative to workspace root)
    // If needed, we could resolve relative to currentWorkingDir here
    await this.sandbox.applyFileChange(step.change);

    return {
      stepId: step.id,
      stepNumber: step.stepNumber,
      success: true,
      output: `Applied ${step.change.type} change to ${step.change.path}`,
    };
  }

  /**
   * Execute a validate step
   */
  private async executeValidateStep(
    step: ValidateStep,
    globalEnv: Record<string, string>
  ): Promise<StepResult> {
    const { validation } = step;

    if (validation.type === 'cli-output') {
      return await this.validateCliOutput(step, validation, globalEnv);
    } else if (validation.type === 'file-contents') {
      return await this.validateFileContents(step, validation);
    } else if (validation.type === 'browser') {
      return {
        stepId: step.id,
        stepNumber: step.stepNumber,
        success: false,
        error: 'Browser validation not yet implemented',
      };
    } else {
      return {
        stepId: step.id,
        stepNumber: step.stepNumber,
        success: false,
        error: `Unknown validation type: ${(validation as any).type}`,
      };
    }
  }

  /**
   * Validate CLI output
   */
  private async validateCliOutput(
    step: ValidateStep,
    validation: Extract<typeof step.validation, { type: 'cli-output' }>,
    globalEnv: Record<string, string>
  ): Promise<StepResult> {
    // Use validation-specific working directory if provided, otherwise use current state
    const workingDir = validation.workingDirectory
      ? resolveWorkingDir(this.currentWorkingDir, validation.workingDirectory)
      : this.currentWorkingDir || undefined;

    const result = await this.sandbox.executeCommand(
      validation.command,
      workingDir,
      globalEnv
    );

    const { check } = validation;
    const errors: string[] = [];

    // Check exit code
    if (check.exitCode !== undefined && result.exitCode !== check.exitCode) {
      errors.push(`Expected exit code ${check.exitCode}, got ${result.exitCode}`);
    }

    // Check stdout contains
    if (check.contains && !result.stdout.includes(check.contains)) {
      errors.push(`Expected stdout to contain "${check.contains}"`);
    }

    // Check stderr contains
    if (check.containsError && !result.stderr.includes(check.containsError)) {
      errors.push(`Expected stderr to contain "${check.containsError}"`);
    }

    // Check regex match
    if (check.matches) {
      const regex = new RegExp(check.matches);
      const combinedOutput = (result.stdout + result.stderr).trim(); // Trim whitespace/newlines
      if (!regex.test(combinedOutput)) {
        errors.push(`Output did not match pattern: ${check.matches}`);
      }
    }

    const success = errors.length === 0;

    return {
      stepId: step.id,
      stepNumber: step.stepNumber,
      success,
      error: success ? undefined : errors.join('; '),
      output: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''),
    };
  }

  /**
   * Validate file contents
   */
  private async validateFileContents(
    step: ValidateStep,
    validation: Extract<typeof step.validation, { type: 'file-contents' }>
  ): Promise<StepResult> {
    // Resolve file path relative to current working directory
    const filePath = resolveWorkingDir(this.currentWorkingDir, validation.path);

    // Check if file exists
    const exists = await this.sandbox.fileExists(filePath);

    if (validation.check.exists !== undefined) {
      if (validation.check.exists && !exists) {
        return {
          stepId: step.id,
          stepNumber: step.stepNumber,
          success: false,
          error: `File does not exist: ${validation.path}`,
        };
      }
      if (!validation.check.exists && exists) {
        return {
          stepId: step.id,
          stepNumber: step.stepNumber,
          success: false,
          error: `File should not exist: ${validation.path}`,
        };
      }
    }

    if (!exists && (validation.check.contains || validation.check.matches || validation.check.equals)) {
      return {
        stepId: step.id,
        stepNumber: step.stepNumber,
        success: false,
        error: `File does not exist: ${validation.path}`,
      };
    }

    if (!exists) {
      return {
        stepId: step.id,
        stepNumber: step.stepNumber,
        success: true,
        output: `File existence check passed: ${validation.path}`,
      };
    }

    // Read file contents
    const contents = await this.sandbox.readFile(filePath);
    const errors: string[] = [];

    // Check contains
    if (validation.check.contains && !contents.includes(validation.check.contains)) {
      errors.push(`File does not contain: "${validation.check.contains}"`);
    }

    // Check equals
    if (validation.check.equals !== undefined) {
      // Normalize line endings for comparison
      const normalizedContents = contents.replace(/\r\n/g, '\n');
      const normalizedExpected = validation.check.equals.replace(/\r\n/g, '\n');
      if (normalizedContents !== normalizedExpected) {
        errors.push(`File contents do not match exactly`);
      }
    }

    // Check regex match
    if (validation.check.matches) {
      const regex = new RegExp(validation.check.matches);
      if (!regex.test(contents)) {
        errors.push(`File contents do not match pattern: ${validation.check.matches}`);
      }
    }

    const success = errors.length === 0;

    return {
      stepId: step.id,
      stepNumber: step.stepNumber,
      success,
      error: success ? undefined : errors.join('; '),
      output: success ? `File validation passed: ${validation.path}` : contents.substring(0, 500),
    };
  }

  /**
   * Cleanup the sandbox
   */
  async cleanup(keepWorkspace?: boolean): Promise<void> {
    await this.sandbox.cleanup(keepWorkspace);
  }

  /**
   * Check if a command is a 'cd' command
   */
  private isCdCommand(command: string): boolean {
    const trimmed = command.trim();
    // Check for 'cd ' at the start (with space), or 'cd' at end of string
    // This catches: 'cd dir', 'cd ~', 'cd ..', etc.
    // But not: 'echo cd' or 'cdir'
    return /^cd\s/.test(trimmed) || trimmed === 'cd';
  }

  /**
   * Parse the target directory from a 'cd' command
   * Returns the resolved path relative to workspace root, or null if parsing fails
   */
  private async parseCdTarget(command: string, currentWorkingDir: string): Promise<string | null> {
    const trimmed = command.trim();
    const workspaceRoot = this.sandbox.getWorkspaceRoot();
    
    // Handle 'cd' without arguments (goes to home directory)
    if (trimmed === 'cd') {
      // Execute the cd command and then pwd to see where we end up
      const pwdResult = await this.sandbox.executeCommand('cd && pwd', currentWorkingDir || undefined);
      if (pwdResult.exitCode === 0) {
        const absolutePath = pwdResult.stdout.trim();
        return this.absoluteToRelative(absolutePath, workspaceRoot);
      }
      return '';
    }

    // Extract the target path after 'cd'
    const match = trimmed.match(/^cd\s+(.+)$/);
    if (!match) {
      return null;
    }

    let target = match[1].trim();
    
    // Remove quotes if present
    if ((target.startsWith('"') && target.endsWith('"')) ||
        (target.startsWith("'") && target.endsWith("'"))) {
      target = target.slice(1, -1);
    }

    // For paths that might resolve outside workspace or use ~, execute cd + pwd
    // This handles: ~, ~/path, and absolute paths
    if (target === '~' || target.startsWith('~/') || target.startsWith('/')) {
      // Execute the cd command followed by pwd to see where we actually end up
      const cdCommand = trimmed; // e.g., "cd ~"
      const pwdResult = await this.sandbox.executeCommand(`${cdCommand} && pwd`, currentWorkingDir || undefined);
      if (pwdResult.exitCode === 0) {
        const absolutePath = pwdResult.stdout.trim();
        return this.absoluteToRelative(absolutePath, workspaceRoot);
      }
      return null;
    }

    // Relative path - resolve relative to current working directory
    if (target === '..') {
      // Go up one level
      const parts = currentWorkingDir.split('/').filter(p => p);
      parts.pop();
      return parts.join('/');
    }

    if (target.startsWith('../')) {
      // Handle multiple levels up (e.g., '../..')
      const parts = currentWorkingDir.split('/').filter(p => p);
      const upLevels = target.split('../').length - 1;
      const remaining = target.replace(/\.\.\//g, '');
      
      for (let i = 0; i < upLevels && parts.length > 0; i++) {
        parts.pop();
      }
      
      if (remaining) {
        parts.push(remaining);
      }
      
      return parts.join('/');
    }

    // Simple relative path
    if (currentWorkingDir) {
      return `${currentWorkingDir}/${target}`.replace(/\/+/g, '/');
    }
    
    return target;
  }

  /**
   * Convert an absolute path to a path relative to workspace root
   */
  private absoluteToRelative(absolutePath: string, workspaceRoot: string): string {
    // Normalize paths
    const normalizedAbsolute = resolve(absolutePath);
    const normalizedWorkspace = resolve(workspaceRoot);
    
    // If the absolute path is the workspace root, return empty string
    if (normalizedAbsolute === normalizedWorkspace) {
      return '';
    }
    
    // If absolute path starts with workspace root, extract the relative part
    if (normalizedAbsolute.startsWith(normalizedWorkspace + '/')) {
      return normalizedAbsolute.slice(normalizedWorkspace.length + 1);
    }
    
    // If the path is outside the workspace, we can't track it relative to workspace
    // Return null to indicate we can't track it
    return '';
  }
}

/**
 * Resolve working directory, handling relative paths
 */
function resolveWorkingDir(baseDir: string, relativeDir: string): string {
  if (!baseDir) return relativeDir;
  if (!relativeDir) return baseDir;
  
  // If relativeDir is absolute, use it
  if (relativeDir.startsWith('/')) {
    return relativeDir;
  }
  
  // Otherwise, join them
  return `${baseDir}/${relativeDir}`.replace(/\/+/g, '/');
}