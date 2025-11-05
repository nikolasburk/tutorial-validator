/**
 * Shared utilities for path operations
 */

import { resolve } from 'path';

/**
 * Resolve a path relative to workspace root
 * If the path is absolute, it's returned as-is
 */
export function resolveWorkspacePath(
  path: string,
  workspaceRoot: string
): string {
  if (path.startsWith('/')) {
    return path;
  }
  return resolve(workspaceRoot, path);
}

