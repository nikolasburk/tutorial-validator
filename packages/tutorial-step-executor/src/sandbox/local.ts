/**
 * Local sandbox implementation
 * 
 * Executes tutorial steps on the local machine without Docker isolation.
 * Uses a temporary directory in /tmp for the workspace.
 */

import { promises as fs } from 'fs';
import { resolve, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import type { FileChange } from '../dsl/index.js';
import type { Sandbox, CommandResult } from './index.js';
import { applyFileChangeToContents } from './fileChangeUtils.js';
import { resolveWorkspacePath } from './pathUtils.js';

const execAsync = promisify(exec);

/**
 * Local sandbox that executes commands directly on the host machine
 */
export class LocalSandbox implements Sandbox {
  private workspaceRoot: string;
  private tutorialId: string;
  private keepWorkspace: boolean = false;
  private backgroundProcesses: Array<{ pid: number; port?: number; description: string }> = [];

  constructor(tutorialId?: string, baseDir?: string) {
    // Use tutorial ID or generate a UUID
    this.tutorialId = tutorialId ? tutorialId.replace(/ /g, '-') : randomUUID();
    
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

    // Check if this is a background process command
    const isBackground = command.includes('&') || command.trim().endsWith('&');
    const isNohup = command.includes('nohup');
    
    // Declare port outside the if block so it's accessible later
    let port: number | undefined;
    
    if (isBackground || isNohup) {
      // Extract port number if we can identify it (e.g., from URL in command or common dev ports)
      const portMatch = command.match(/localhost:(\d+)|:(\d+)/);
      if (portMatch) {
        port = parseInt(portMatch[1] || portMatch[2], 10);
      }

      // For dev servers, try to detect common ports if not found
      if (!port && (command.includes('dev') || command.includes('vite') || command.includes('next'))) {
        port = 5173; // Default Vite port
      }

      // Track this as a background process
      if (port) {
        this.backgroundProcesses.push({ pid: -1, port, description: command });
      }
    }

    try {
      // Execute the command
      const result = await execAsync(command, {
        cwd,
        env: processEnv,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // If it's a background command, wait a bit and then find the actual process
      if (isBackground || isNohup) {
        await this.trackBackgroundProcess(cwd, port);
      }

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

  /**
   * Track background processes after they've been started
   */
  private async trackBackgroundProcess(cwd: string, port?: number): Promise<void> {
    // Wait a moment for the process to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      if (port) {
        // Find process using the port
        // lsof returns exit code 1 when no process is found, which is normal and expected
        try {
          const result = await execAsync(`lsof -ti:${port}`, { cwd });
          const pids = result.stdout.trim().split('\n').filter(Boolean).map(p => parseInt(p, 10));
          for (const pid of pids) {
            if (pid && !isNaN(pid)) {
              // Verify it's actually in our workspace
              try {
                const processInfo = await execAsync(`lsof -p ${pid} | grep "${cwd}" || true`, { cwd });
                if (processInfo.stdout.trim()) {
                  this.backgroundProcesses.push({ pid, port, description: `process on port ${port}` });
                }
              } catch {
                // If we can't verify, still track it - better safe than sorry
                this.backgroundProcesses.push({ pid, port, description: `process on port ${port}` });
              }
            }
          }
        } catch (error: any) {
          // Only log actual errors (not "no processes found")
          // lsof returns exit code 1 when nothing is found, which is expected and normal
          if (error.code !== 1 && error.code !== 'ENOENT') {
            console.warn(`[WARN] Could not check port ${port} for processes: ${error.message}`);
          }
          // Exit code 1 means no processes found - this is normal, silently continue
        }
      }

      // Also find processes in the workspace directory (pnpm, node, vite, etc.)
      try {
        const workspaceProcesses = await execAsync(
          `pgrep -f "${cwd}" || true`,
          { cwd }
        );
        const wpids = workspaceProcesses.stdout.trim().split('\n').filter(Boolean).map(p => parseInt(p, 10));
        for (const pid of wpids) {
          if (pid && !isNaN(pid) && !this.backgroundProcesses.some(p => p.pid === pid)) {
            this.backgroundProcesses.push({ pid, description: `process in ${cwd}` });
          }
        }
      } catch (error: any) {
        // pgrep returns exit code 1 when nothing is found, which is normal
        if (error.code !== 1 && error.code !== 'ENOENT') {
          console.warn(`[WARN] Could not check workspace for processes: ${error.message}`);
        }
      }
    } catch (error: any) {
      // Only log unexpected errors
      if (error.code !== 1 && error.code !== 'ENOENT') {
        console.warn(`[WARN] Could not track background processes: ${error.message}`);
      }
    }
  }

  async readFile(path: string): Promise<string> {
    const fullPath = resolveWorkspacePath(path, this.workspaceRoot);
    return await fs.readFile(fullPath, 'utf-8');
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      const fullPath = resolveWorkspacePath(path, this.workspaceRoot);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const fullPath = resolveWorkspacePath(path, this.workspaceRoot);
    // Ensure parent directory exists
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, contents, 'utf-8');
  }

  async applyFileChange(change: FileChange): Promise<void> {
    if (change.type === 'replace') {
      await this.writeFile(change.path, change.contents);
      return;
    }

    // Read existing file if it exists
    let contents = '';
    if (await this.fileExists(change.path)) {
      contents = await this.readFile(change.path);
    }

    // Apply transformation (pure function)
    const modifiedContents = applyFileChangeToContents(
      contents,
      change,
      change.path
    );

    // Write back
    await this.writeFile(change.path, modifiedContents);
  }

  async cleanup(keepWorkspace?: boolean): Promise<void> {
    this.keepWorkspace = keepWorkspace || false;
    
    // Kill all tracked background processes
    await this.killBackgroundProcesses();
    
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
   * Kill all tracked background processes
   */
  private async killBackgroundProcesses(): Promise<void> {
    if (this.backgroundProcesses.length === 0) {
      return;
    }

    console.log(`[INFO] Cleaning up ${this.backgroundProcesses.length} background process(es)...`);

    for (const proc of this.backgroundProcesses) {
      try {
        if (proc.pid > 0) {
          // Try graceful shutdown first (SIGTERM)
          try {
            process.kill(proc.pid, 'SIGTERM');
            // Wait a bit for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if process still exists
            try {
              process.kill(proc.pid, 0); // Signal 0 just checks if process exists
              // Process still exists, force kill
              process.kill(proc.pid, 'SIGKILL');
              console.log(`[INFO] Force killed process ${proc.pid}`);
            } catch {
              // Process already gone, good
              console.log(`[INFO] Process ${proc.pid} terminated gracefully`);
            }
          } catch (error: any) {
            if (error.code !== 'ESRCH') {
              // ESRCH means process doesn't exist, which is fine
              console.warn(`[WARN] Could not kill process ${proc.pid}: ${error.message}`);
            }
          }
        }

        // Also kill by port if specified (in case PID tracking failed)
        if (proc.port) {
          try {
            await execAsync(`lsof -ti:${proc.port} | xargs kill -TERM 2>/dev/null || true`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            await execAsync(`lsof -ti:${proc.port} | xargs kill -KILL 2>/dev/null || true`);
          } catch {
            // Ignore errors
          }
        }
      } catch (error) {
        console.warn(`[WARN] Error cleaning up process: ${error}`);
      }
    }

    // Also do a final sweep: kill any processes still using our workspace
    try {
      const workspacePath = this.workspaceRoot;
      // Find and kill processes in the workspace
      const result = await execAsync(
        `pkill -f "${workspacePath}" || true`,
        { timeout: 5000 }
      );
    } catch {
      // Ignore errors in final cleanup
    }

    this.backgroundProcesses = [];
  }

}
