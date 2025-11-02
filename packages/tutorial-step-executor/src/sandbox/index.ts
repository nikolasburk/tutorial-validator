/**
 * Sandboxing utilities
 * 
 * Provides isolation for executing tutorial steps safely.
 */

/**
 * Result of executing a command in the sandbox
 */
export interface CommandResult {
  /** Exit code of the command */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
}

/**
 * Abstract interface for sandbox implementations
 * 
 * This allows swapping between local execution and Docker-based execution
 * without changing the executor logic.
 */
export interface Sandbox {
  /**
   * Get the root directory of the sandbox workspace
   */
  getWorkspaceRoot(): string;

  /**
   * Initialize the sandbox workspace
   * Creates the working directory and prepares the environment
   */
  initialize(): Promise<void>;

  /**
   * Execute a command in the sandbox
   * @param command The command to execute
   * @param workingDirectory Working directory relative to workspace root (or absolute)
   * @param env Environment variables to set for this command
   */
  executeCommand(
    command: string,
    workingDirectory?: string,
    env?: Record<string, string>
  ): Promise<CommandResult>;

  /**
   * Read file contents from the sandbox
   * @param path Path relative to workspace root (or absolute)
   */
  readFile(path: string): Promise<string>;

  /**
   * Check if a file exists in the sandbox
   * @param path Path relative to workspace root (or absolute)
   */
  fileExists(path: string): Promise<boolean>;

  /**
   * Write file contents to the sandbox
   * @param path Path relative to workspace root (or absolute)
   * @param contents File contents to write
   */
  writeFile(path: string, contents: string): Promise<void>;

  /**
   * Apply a file change operation (replace, diff, or context-based)
   * @param change The file change operation to perform
   */
  applyFileChange(change: import('../dsl/index.js').FileChange): Promise<void>;

  /**
   * Clean up the sandbox workspace
   * @param keepWorkspace If true, don't delete the workspace (for debugging)
   */
  cleanup(keepWorkspace?: boolean): Promise<void>;
}

export * from './local.js';