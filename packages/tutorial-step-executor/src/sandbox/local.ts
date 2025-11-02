/**
 * Local sandbox implementation
 * 
 * Executes tutorial steps on the local machine without Docker isolation.
 * Uses a temporary directory in /tmp for the workspace.
 */

import { promises as fs } from 'fs';
import { join, resolve, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import type { FileChange } from '../dsl/index.js';
import type { Sandbox, CommandResult } from './index.js';

const execAsync = promisify(exec);

/**
 * Local sandbox that executes commands directly on the host machine
 */
export class LocalSandbox implements Sandbox {
  private workspaceRoot: string;
  private tutorialId: string;
  private keepWorkspace: boolean = false;

  constructor(tutorialId?: string, baseDir?: string) {
    // Use tutorial ID or generate a UUID
    this.tutorialId = tutorialId || randomUUID();
    
    // Determine workspace root
    const workspaceBase = baseDir || process.env.TUTORIAL_WORKSPACE_ROOT || '/tmp';
    const timestamp = Date.now();
    this.workspaceRoot = resolve(workspaceBase, `tutorial-validator-${this.tutorialId}-${timestamp}`);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async initialize(): Promise<void> {
    // Create the workspace directory
    await fs.mkdir(this.workspaceRoot, { recursive: true });
  }

  async executeCommand(
    command: string,
    workingDirectory?: string,
    env?: Record<string, string>
  ): Promise<CommandResult> {
    // Resolve working directory
    const cwd = workingDirectory
      ? resolve(this.workspaceRoot, workingDirectory)
      : this.workspaceRoot;

    // Ensure working directory exists
    await fs.mkdir(cwd, { recursive: true });

    // Merge environment variables
    const processEnv = { ...process.env, ...env };

    try {
      // Execute the command
      const result = await execAsync(command, {
        cwd,
        env: processEnv,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return {
        exitCode: 0,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    } catch (error: any) {
      // execAsync rejects on non-zero exit codes, but we want to capture them
      if (error.code !== undefined) {
        return {
          exitCode: error.code,
          stdout: error.stdout || '',
          stderr: error.stderr || '',
        };
      }
      throw error;
    }
  }

  async readFile(path: string): Promise<string> {
    const fullPath = this.resolvePath(path);
    return await fs.readFile(fullPath, 'utf-8');
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(path);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    // Ensure parent directory exists
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, contents, 'utf-8');
  }

  async applyFileChange(change: FileChange): Promise<void> {
    if (change.type === 'replace') {
      await this.writeFile(change.path, change.contents);
    } else if (change.type === 'diff') {
      const fullPath = this.resolvePath(change.path);
      let contents = '';

      // Read existing file if it exists
      try {
        contents = await fs.readFile(fullPath, 'utf-8');
      } catch {
        // File doesn't exist, start with empty content
      }

      const lines = contents.split('\n');

      // Remove lines if specified
      if (change.removeLines) {
        const { start, end } = change.removeLines;
        lines.splice(start, end - start + 1);
      }

      // Insert lines if specified
      if (change.insertLines) {
        const { at, lines: linesToInsert } = change.insertLines;
        lines.splice(at, 0, ...linesToInsert);
      }

      // Find and replace if specified
      if (change.findReplace) {
        const { find, replace } = change.findReplace;
        contents = contents.replace(find, replace);
        await this.writeFile(change.path, contents);
        return;
      }

      // Write the modified content
      await this.writeFile(change.path, lines.join('\n'));
    } else if (change.type === 'context') {
      const fullPath = this.resolvePath(change.path);
      let contents = '';

      // Read existing file
      try {
        contents = await fs.readFile(fullPath, 'utf-8');
      } catch {
        // File doesn't exist, start with empty content
      }

      const lines = contents.split('\n');
      const pattern = change.searchPattern;
      let foundIndex = -1;

      // Find the line matching the search pattern
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(pattern)) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex === -1) {
        throw new Error(`Search pattern "${pattern}" not found in file ${change.path}`);
      }

      // Apply the action
      if (change.action === 'before') {
        lines.splice(foundIndex, 0, change.content);
      } else if (change.action === 'after') {
        lines.splice(foundIndex + 1, 0, change.content);
      } else if (change.action === 'replace') {
        lines[foundIndex] = change.content;
      }

      await this.writeFile(change.path, lines.join('\n'));
    }
  }

  async cleanup(keepWorkspace?: boolean): Promise<void> {
    this.keepWorkspace = keepWorkspace || false;
    
    if (!this.keepWorkspace) {
      try {
        await fs.rm(this.workspaceRoot, { recursive: true, force: true });
      } catch (error) {
        // Log but don't throw - cleanup failures shouldn't break the flow
        console.warn(`[WARN] Failed to cleanup workspace: ${error}`);
      }
    } else {
      console.log(`[INFO] Workspace preserved at: ${this.workspaceRoot}`);
    }
  }

  /**
   * Resolve a path relative to the workspace root
   */
  private resolvePath(path: string): string {
    // If path is absolute, use it directly (might be outside workspace)
    if (path.startsWith('/')) {
      return path;
    }
    return resolve(this.workspaceRoot, path);
  }
}
