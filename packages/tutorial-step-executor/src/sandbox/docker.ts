/**
 * Docker sandbox implementation
 * 
 * Executes tutorial steps in a Docker container for isolation.
 * Supports both volume mount (for debugging) and copy file modes (for production).
 */

import Docker from 'dockerode';
import { promises as fs } from 'fs';
import { resolve, dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type { FileChange } from '../dsl/index.js';
import type { Sandbox, CommandResult } from './index.js';
import { applyFileChangeToContents } from './fileChangeUtils.js';
import { resolveWorkspacePath } from './pathUtils.js';

/**
 * Docker sandbox that executes commands in a Docker container
 */
export class DockerSandbox implements Sandbox {
  private docker: Docker;
  private containerId: string | null = null;
  private container: Docker.Container | null = null;
  private workspaceRoot: string;
  private tutorialId: string;
  private imageName: string;
  private useVolumeMount: boolean;
  private keepWorkspace: boolean = false;
  private backgroundProcesses: Array<{ pid: number; port?: number; description: string }> = [];

  constructor(
    tutorialId?: string,
    options?: {
      baseDir?: string;
      imageName?: string;
      useVolumeMount?: boolean;
    }
  ) {
    this.docker = new Docker();
    this.tutorialId = tutorialId ? tutorialId.replace(/ /g, '-') : randomUUID();
    
    // Determine workspace root
    const workspaceBase = options?.baseDir || process.env.TUTORIAL_WORKSPACE_ROOT || '/tmp';
    const timestamp = Date.now();
    this.workspaceRoot = resolve(workspaceBase, `tutorial-validator-${this.tutorialId}-${timestamp}`);
    
    // Docker image to use (default: tutorial-validator image)
    this.imageName = options?.imageName || 'tutorial-validator:latest';
    
    // Default to volume mount for easier debugging
    this.useVolumeMount = options?.useVolumeMount !== false;
    console.log(`[DEBUG] Docker sandbox initialized with image: ${this.imageName} and useVolumeMount: ${this.useVolumeMount}`);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async initialize(): Promise<void> {
    // Create the workspace directory on host
    await fs.mkdir(this.workspaceRoot, { recursive: true });

    // Ensure Docker image exists
    await this.ensureImage();

    // Create and start container
    const containerPath = this.useVolumeMount ? this.workspaceRoot : '/workspace';
    
    const containerConfig: Docker.ContainerCreateOptions = {
      Image: this.imageName,
      Cmd: ['tail', '-f', '/dev/null'], // Keep container running
      WorkingDir: '/workspace',
      HostConfig: {
        AutoRemove: false, // We'll manage cleanup ourselves
      },
    };

    // Add volume mount if enabled
    if (this.useVolumeMount) {
      containerConfig.HostConfig = {
        ...containerConfig.HostConfig,
        Binds: [`${this.workspaceRoot}:/workspace`],
      };
    }

    this.container = await this.docker.createContainer(containerConfig);
    this.containerId = this.container.id;
    await this.container.start();

    // If not using volume mount, we'll need to copy files manually
    // For now, volume mount is the default and recommended approach
  }

  private async ensureImage(): Promise<void> {
    try {
      // Check if image exists
      const image = this.docker.getImage(this.imageName);
      await image.inspect();
    } catch (error: any) {
      // Image doesn't exist, build it
      if (error.statusCode === 404) {
        console.log(`[INFO] Docker image ${this.imageName} not found, building...`);
        await this.buildImage();
      } else {
        throw error;
      }
    }
  }

  private async buildImage(): Promise<void> {
    // Find Dockerfile - check in executor package
    const dockerfilePath = resolve(__dirname, '../../Dockerfile');
    
    let dockerfileExists = false;
    try {
      await fs.access(dockerfilePath);
      dockerfileExists = true;
    } catch {
      // Dockerfile not found
    }

    if (!dockerfileExists) {
      throw new Error(
        `Docker image ${this.imageName} not found and Dockerfile not available for auto-build.\n` +
        `Please build the Docker image manually:\n` +
        `  docker build -t ${this.imageName} -f ${dockerfilePath} ${dirname(dockerfilePath)}`
      );
    }

    // For now, require manual build - auto-building is complex and error-prone
    // Users should build the image before running: docker build -t tutorial-validator:latest -f packages/tutorial-step-executor/Dockerfile packages/tutorial-step-executor
    throw new Error(
      `Docker image ${this.imageName} not found.\n` +
      `Please build it manually:\n` +
      `  docker build -t ${this.imageName} -f ${dockerfilePath} ${dirname(dockerfilePath)}\n` +
      `Or from the project root:\n` +
      `  docker build -t ${this.imageName} -f packages/tutorial-step-executor/Dockerfile packages/tutorial-step-executor`
    );
  }

  async executeCommand(
    command: string,
    workingDirectory?: string,
    env?: Record<string, string>
  ): Promise<CommandResult> {
    if (!this.container) {
      throw new Error('Container not initialized. Call initialize() first.');
    }

    // Resolve working directory in container
    const cwd = workingDirectory
      ? `/workspace/${workingDirectory.replace(/^\/+/, '')}`
      : '/workspace';

    // Ensure working directory exists in container
    await this.execInContainer(`mkdir -p "${cwd}"`);

    // Build environment variables
    const envVars: string[] = [];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        envVars.push(`${key}=${value}`);
      }
    }

    // Execute command
    const execOptions: Docker.ExecCreateOptions = {
      Cmd: ['sh', '-c', command],
      WorkingDir: cwd,
      Env: envVars.length > 0 ? envVars : undefined,
      AttachStdout: true,
      AttachStderr: true,
    };

    const exec = await this.container.exec(execOptions);
    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise<CommandResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      
      stream.on('data', (chunk: Buffer) => {
        // Docker exec streams use multiplexed format:
        // [8-byte header][payload]
        // Header: [stream type (1 byte)][reserved 3 bytes][size (4 bytes)]
        let offset = 0;
        while (offset < chunk.length) {
          if (chunk.length - offset < 8) {
            // Incomplete header, wait for more data
            break;
          }
          
          const streamType = chunk[offset];
          const payloadSize = chunk.readUInt32BE(offset + 4);
          offset += 8;
          
          if (chunk.length - offset < payloadSize) {
            // Incomplete payload, wait for more data
            break;
          }
          
          const payload = chunk.slice(offset, offset + payloadSize);
          offset += payloadSize;
          
          if (streamType === 1) {
            // stdout
            stdoutChunks.push(payload);
          } else if (streamType === 2) {
            // stderr
            stderrChunks.push(payload);
          }
        }
      });

      stream.on('end', async () => {
        const inspect = await exec.inspect();
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        
        resolve({
          exitCode: inspect.ExitCode || 0,
          stdout,
          stderr,
        });
      });

      stream.on('error', reject);
    });
  }

  private async execInContainer(command: string): Promise<void> {
    if (!this.container) {
      throw new Error('Container not initialized');
    }

    const exec = await this.container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }

  async readFile(path: string): Promise<string> {
    if (this.useVolumeMount) {
      // Read from host filesystem
      const fullPath = resolveWorkspacePath(path, this.workspaceRoot);
      return await fs.readFile(fullPath, 'utf-8');
    } else {
      // Read from container
      if (!this.container) {
        throw new Error('Container not initialized');
      }

      const containerPath = path.startsWith('/') ? path : `/workspace/${path}`;
      const exec = await this.container.exec({
        Cmd: ['cat', containerPath],
        AttachStdout: true,
        AttachStderr: true,
      });

      const stream = await exec.start({ hijack: true, stdin: false });
      const chunks: Buffer[] = [];

      return new Promise<string>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        stream.on('end', () => {
          const output = Buffer.concat(chunks).toString();
          resolve(output.trim());
        });

        stream.on('error', reject);
      });
    }
  }

  async fileExists(path: string): Promise<boolean> {
    if (this.useVolumeMount) {
      // Check on host filesystem
      try {
        const fullPath = resolveWorkspacePath(path, this.workspaceRoot);
        await fs.access(fullPath);
        return true;
      } catch {
        return false;
      }
    } else {
      // Check in container
      if (!this.container) {
        throw new Error('Container not initialized');
      }

      const containerPath = path.startsWith('/') ? path : `/workspace/${path}`;
      const result = await this.executeCommand(`test -f "${containerPath}" || test -d "${containerPath}"`);
      return result.exitCode === 0;
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    if (this.useVolumeMount) {
      // Write to host filesystem
      const fullPath = resolveWorkspacePath(path, this.workspaceRoot);
      await fs.mkdir(dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, contents, 'utf-8');
    } else {
      // Write to container
      if (!this.container) {
        throw new Error('Container not initialized');
      }

      // Write file to container using base64 encoding to avoid shell escaping issues
      const containerPath = path.startsWith('/') ? path : `/workspace/${path}`;
      const dir = dirname(containerPath);
      await this.execInContainer(`mkdir -p "${dir}"`);
      
      // Encode contents to base64 and write via base64 decode
      const encoded = Buffer.from(contents, 'utf-8').toString('base64');
      const result = await this.executeCommand(
        `echo "${encoded}" | base64 -d > "${containerPath}"`
      );
      
      if (result.exitCode !== 0) {
        throw new Error(`Failed to write file to container: ${result.stderr || result.stdout}`);
      }
    }
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

    // Stop and remove container
    if (this.container) {
      try {
        await this.container.stop();
        await this.container.remove();
      } catch (error: any) {
        // Container might already be stopped/removed
        if (error.statusCode !== 404 && error.statusCode !== 409) {
          console.warn(`[WARN] Error cleaning up container: ${error.message}`);
        }
      }
      this.container = null;
      this.containerId = null;
    }

    // Clean up workspace on host
    if (!this.keepWorkspace) {
      try {
        await fs.rm(this.workspaceRoot, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[WARN] Failed to cleanup workspace: ${error}`);
      }
    } else {
      console.log(`[INFO] Workspace preserved at: ${this.workspaceRoot}`);
      if (!this.useVolumeMount) {
        console.log(`[INFO] Note: Container has been removed. Files in ${this.workspaceRoot} may be out of sync with container state.`);
      }
    }
  }

}

