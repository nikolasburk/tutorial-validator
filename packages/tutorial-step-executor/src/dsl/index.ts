/**
 * DSL (Domain Specific Language) types and schema
 * 
 * Defines the structure for representing tutorial steps.
 */

/**
 * Base properties shared by all tutorial steps
 */
interface BaseStep {
  /** Unique identifier for this step */
  id: string;
  /** Human-readable description of what this step does */
  description?: string;
  /** Step number in the sequence */
  stepNumber: number;
}

/**
 * Step that runs a terminal command
 */
export interface RunCommandStep extends BaseStep {
  type: 'run-command';
  /** The command to execute */
  command: string;
  /** Working directory where the command should be executed */
  workingDirectory?: string;
  /** Environment variables to set for this command */
  env?: Record<string, string>;
  /** Expected exit code (default: 0) */
  expectedExitCode?: number;
  /** Whether to capture stdout/stderr (default: true) */
  captureOutput?: boolean;
}

/**
 * File change operations
 */

/**
 * Replace the entire contents of a file
 */
export interface ReplaceFileContents {
  type: 'replace';
  /** Path to the file */
  path: string;
  /** New contents of the file */
  contents: string;
}

/**
 * Apply a diff-like change to a file
 */
export interface ApplyDiffChange {
  type: 'diff';
  /** Path to the file */
  path: string;
  /** Lines to remove (0-indexed, inclusive) */
  removeLines?: { start: number; end: number };
  /** Lines to insert at a specific position */
  insertLines?: { at: number; lines: string[] };
  /** Text to find and replace */
  findReplace?: { find: string; replace: string };
}

/**
 * Context-based change (e.g., "add after line containing X")
 */
export interface ContextBasedChange {
  type: 'context';
  /** Path to the file */
  path: string;
  /** Search pattern to find the location for the change */
  searchPattern: string;
  /** What to do at the found location */
  action: 'before' | 'after' | 'replace';
  /** Content to insert or replace with */
  content: string;
}

export type FileChange = ReplaceFileContents | ApplyDiffChange | ContextBasedChange;

/**
 * Step that makes changes to a file
 */
export interface ChangeFileStep extends BaseStep {
  type: 'change-file';
  /** The file change operation to perform */
  change: FileChange;
}

/**
 * Validation operations
 */

/**
 * Validate CLI output
 */
export interface ValidateCliOutput {
  type: 'cli-output';
  /** Command to run to get the output */
  command: string;
  /** Working directory for the command */
  workingDirectory?: string;
  /** What to check in the output */
  check: {
    /** Expected text in stdout */
    contains?: string;
    /** Expected text in stderr */
    containsError?: string;
    /** Regex pattern to match */
    matches?: string;
    /** Expected exit code */
    exitCode?: number;
  };
}

/**
 * Validate file contents
 */
export interface ValidateFileContents {
  type: 'file-contents';
  /** Path to the file to check */
  path: string;
  /** What to check in the file */
  check: {
    /** File should contain this text */
    contains?: string;
    /** File should match this regex */
    matches?: string;
    /** File should equal this exact content */
    equals?: string;
    /** File should exist */
    exists?: boolean;
  };
}

/**
 * Validate browser state
 */
export interface ValidateBrowser {
  type: 'browser';
  /** URL to navigate to */
  url: string;
  /** What to check on the page */
  check: {
    /** Page should contain this text */
    containsText?: string;
    /** Element selector to check */
    selector?: string;
    /** Expected text content of the element */
    elementText?: string;
    /** Expected attribute value */
    attribute?: { name: string; value: string };
    /** Custom JavaScript expression to evaluate */
    evaluate?: string;
  };
}

export type Validation = ValidateCliOutput | ValidateFileContents | ValidateBrowser;

/**
 * Step that validates a certain outcome
 */
export interface ValidateStep extends BaseStep {
  type: 'validate';
  /** The validation operation to perform */
  validation: Validation;
}

/**
 * Union type of all possible tutorial steps
 */
export type TutorialStep = RunCommandStep | ChangeFileStep | ValidateStep;

/**
 * Complete tutorial specification
 */
export interface TutorialSpec {
  /** Metadata about the tutorial */
  metadata?: {
    title?: string;
    description?: string;
    author?: string;
    version?: string;
  };
  /** Prerequisites that should be checked before execution */
  prerequisites?: {
    /** Required tools/commands that must be available */
    commands?: string[];
    /** Required environment variables */
    envVars?: string[];
    /** Minimum versions of tools */
    versions?: Record<string, string>;
  };
  /** Steps to execute in order */
  steps: TutorialStep[];
  /** Working directory for the tutorial (if not specified, uses sandbox root) */
  workingDirectory?: string;
  /** Global environment variables for all steps */
  env?: Record<string, string>;
}

export * from './schemas.js';

