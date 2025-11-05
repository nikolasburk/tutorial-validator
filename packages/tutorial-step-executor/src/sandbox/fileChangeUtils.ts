/**
 * Shared utilities for file change operations
 * 
 * Pure functions that transform file contents without performing I/O.
 * These can be used by both LocalSandbox and DockerSandbox.
 */

import type { FileChange } from '../dsl/index.js';

/**
 * Find the line index where a search pattern occurs in file contents
 * Supports both single-line and multiline patterns
 */
export function findPatternLineIndex(
  contents: string,
  pattern: string,
  filePath: string
): number {
  const lines = contents.split('\n');
  let foundIndex = -1;

  if (pattern.includes('\n')) {
    // Multiline pattern: search in full content
    const patternIndex = contents.indexOf(pattern);
    if (patternIndex === -1) {
      throw new Error(`Search pattern not found in file ${filePath}`);
    }
    // Find the line index of the last line of the matched pattern
    const beforePattern = contents.substring(0, patternIndex);
    const patternLines = pattern.split('\n');
    foundIndex = beforePattern.split('\n').length - 1 + patternLines.length;
  } else {
    // Single-line pattern: search line by line (backward compatibility)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) {
        foundIndex = i;
        break;
      }
    }
  }

  if (foundIndex === -1) {
    throw new Error(`Search pattern "${pattern}" not found in file ${filePath}`);
  }

  return foundIndex;
}

/**
 * Apply a diff change to file contents
 */
export function applyDiffChange(
  contents: string,
  change: Extract<FileChange, { type: 'diff' }>
): string {
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
    return contents.replace(find, replace);
  }

  return lines.join('\n');
}

/**
 * Apply a context-based change to file contents
 */
export function applyContextChange(
  contents: string,
  change: Extract<FileChange, { type: 'context' }>,
  filePath: string
): string {
  const lines = contents.split('\n');
  const pattern = change.searchPattern;
  
  const foundIndex = findPatternLineIndex(contents, pattern, filePath);

  // Apply the action
  if (change.action === 'before') {
    lines.splice(foundIndex, 0, change.content);
  } else if (change.action === 'after') {
    // For JSON files, handle comma requirements properly
    const isJsonFile = filePath.endsWith('.json');
    if (isJsonFile && foundIndex >= 0 && foundIndex < lines.length) {
      const matchedLine = lines[foundIndex];
      const trimmedLine = matchedLine.trim();
      
      // Step 1: Ensure the matched line has a comma if it's not the last property
      if (
        trimmedLine.length > 0 &&
        !trimmedLine.endsWith(',') &&
        !trimmedLine.endsWith('{') &&
        !trimmedLine.endsWith('[') &&
        !trimmedLine.endsWith('}') &&
        !trimmedLine.endsWith(']')
      ) {
        // Check if we're inserting a property after this line
        const insertedContent = change.content.trim();
        if (insertedContent.startsWith('"')) {
          // We're adding a property, so the matched line needs a comma
          lines[foundIndex] = matchedLine.replace(/([^,])$/, '$1,');
        }
      }
      
      // Step 2: Check if the inserted content will be the last property
      // and remove trailing comma if so
      let insertedContent = change.content;
      const trimmedInserted = insertedContent.trim();
      
      // Look ahead to see if there are more properties after what we're inserting
      let hasMoreProperties = false;
      let braceDepth = 0;
      
      // Count braces from the matched line to determine object context
      for (let i = 0; i <= foundIndex; i++) {
        const line = lines[i];
        for (const char of line) {
          if (char === '{') braceDepth++;
          if (char === '}') braceDepth--;
        }
      }
      
      // Check lines after the insertion point
      for (let j = foundIndex + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        const trimmedNext = nextLine.trim();
        
        // Update brace depth
        for (const char of nextLine) {
          if (char === '{') braceDepth++;
          if (char === '}') braceDepth--;
        }
        
        if (trimmedNext.length === 0) continue;
        
        // If we've closed more braces than opened, we've left the object
        if (braceDepth < 0) {
          break;
        }
        
        // If we find another property (starts with quote) in the same object
        if (trimmedNext.startsWith('"') && braceDepth >= 0) {
          hasMoreProperties = true;
          break;
        }
        
        // If we find a closing brace before another property
        if (trimmedNext === '}' || trimmedNext.startsWith('}')) {
          break;
        }
      }
      
      // If this is the last property (no more properties found), remove trailing comma
      if (!hasMoreProperties && trimmedInserted.endsWith(',')) {
        insertedContent = insertedContent.replace(/,\s*$/, '');
      }
      
      lines.splice(foundIndex + 1, 0, insertedContent);
    } else {
      // Non-JSON file or no special handling needed
      lines.splice(foundIndex + 1, 0, change.content);
    }
  } else if (change.action === 'replace') {
    lines[foundIndex] = change.content;
  }

  return lines.join('\n');
}

/**
 * Apply any file change to file contents (main entry point)
 * Returns the modified contents
 */
export function applyFileChangeToContents(
  contents: string,
  change: FileChange,
  filePath: string
): string {
  if (change.type === 'replace') {
    return change.contents;
  } else if (change.type === 'diff') {
    return applyDiffChange(contents, change);
  } else if (change.type === 'context') {
    return applyContextChange(contents, change, filePath);
  }
  return contents;
}

