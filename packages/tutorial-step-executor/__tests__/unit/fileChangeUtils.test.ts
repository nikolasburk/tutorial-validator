import { describe, it, expect } from 'vitest';
import {
  findPatternLineIndex,
  applyDiffChange,
  applyContextChange,
  applyFileChangeToContents,
} from '../../src/sandbox/fileChangeUtils.js';

describe('fileChangeUtils', () => {
  describe('findPatternLineIndex', () => {
    it('should find single-line pattern', () => {
      const contents = 'line1\nline2\nline3';
      const pattern = 'line2';
      const result = findPatternLineIndex(contents, pattern, 'test.txt');
      expect(result).toBe(1);
    });

    it('should find multiline pattern', () => {
      const contents = 'line1\nline2\nline3\nline4';
      const pattern = 'line2\nline3';
      const result = findPatternLineIndex(contents, pattern, 'test.txt');
      // The function returns the line index after the pattern ends
      expect(result).toBe(3);
    });

    it('should throw error if pattern not found', () => {
      const contents = 'line1\nline2\nline3';
      const pattern = 'notfound';
      expect(() => {
        findPatternLineIndex(contents, pattern, 'test.txt');
      }).toThrow('Search pattern "notfound" not found in file test.txt');
    });
  });

  describe('applyDiffChange', () => {
    it('should remove specified lines', () => {
      const contents = 'line1\nline2\nline3\nline4';
      const change = {
        type: 'diff' as const,
        path: 'test.txt',
        removeLines: { start: 1, end: 2 },
      };
      const result = applyDiffChange(contents, change);
      expect(result).toBe('line1\nline4');
    });

    it('should insert lines at specified position', () => {
      const contents = 'line1\nline2\nline3';
      const change = {
        type: 'diff' as const,
        path: 'test.txt',
        insertLines: { at: 1, lines: ['inserted1', 'inserted2'] },
      };
      const result = applyDiffChange(contents, change);
      expect(result).toBe('line1\ninserted1\ninserted2\nline2\nline3');
    });

    it('should apply find and replace', () => {
      const contents = 'hello world\nhello again';
      const change = {
        type: 'diff' as const,
        path: 'test.txt',
        findReplace: { find: 'hello', replace: 'hi' },
      };
      const result = applyDiffChange(contents, change);
      // String.replace() only replaces the first occurrence
      expect(result).toBe('hi world\nhello again');
    });

    it('should handle multiple operations', () => {
      const contents = 'line1\nline2\nline3\nline4';
      const change = {
        type: 'diff' as const,
        path: 'test.txt',
        removeLines: { start: 1, end: 1 },
        insertLines: { at: 1, lines: ['newline'] },
      };
      const result = applyDiffChange(contents, change);
      expect(result).toBe('line1\nnewline\nline3\nline4');
    });
  });

  describe('applyContextChange', () => {
    it('should insert before matched line', () => {
      const contents = 'line1\nline2\nline3';
      const change = {
        type: 'context' as const,
        path: 'test.txt',
        searchPattern: 'line2',
        action: 'before' as const,
        content: 'inserted',
      };
      const result = applyContextChange(contents, change, 'test.txt');
      expect(result).toBe('line1\ninserted\nline2\nline3');
    });

    it('should insert after matched line', () => {
      const contents = 'line1\nline2\nline3';
      const change = {
        type: 'context' as const,
        path: 'test.txt',
        searchPattern: 'line2',
        action: 'after' as const,
        content: 'inserted',
      };
      const result = applyContextChange(contents, change, 'test.txt');
      expect(result).toBe('line1\nline2\ninserted\nline3');
    });

    it('should replace matched line', () => {
      const contents = 'line1\nline2\nline3';
      const change = {
        type: 'context' as const,
        path: 'test.txt',
        searchPattern: 'line2',
        action: 'replace' as const,
        content: 'replaced',
      };
      const result = applyContextChange(contents, change, 'test.txt');
      expect(result).toBe('line1\nreplaced\nline3');
    });

    it('should handle multiline search pattern', () => {
      const contents = 'line1\nline2\nline3\nline4';
      const change = {
        type: 'context' as const,
        path: 'test.txt',
        searchPattern: 'line2\nline3',
        action: 'after' as const,
        content: 'inserted',
      };
      const result = applyContextChange(contents, change, 'test.txt');
      // The pattern ends at line 3 (index 3), so insertion happens after line 3
      expect(result).toBe('line1\nline2\nline3\nline4\ninserted');
    });
  });

  describe('applyFileChangeToContents', () => {
    it('should handle replace type', () => {
      const contents = 'old content';
      const change = {
        type: 'replace' as const,
        path: 'test.txt',
        contents: 'new content',
      };
      const result = applyFileChangeToContents(contents, change, 'test.txt');
      expect(result).toBe('new content');
    });

    it('should handle diff type', () => {
      const contents = 'line1\nline2\nline3';
      const change = {
        type: 'diff' as const,
        path: 'test.txt',
        removeLines: { start: 1, end: 1 },
      };
      const result = applyFileChangeToContents(contents, change, 'test.txt');
      expect(result).toBe('line1\nline3');
    });

    it('should handle context type', () => {
      const contents = 'line1\nline2\nline3';
      const change = {
        type: 'context' as const,
        path: 'test.txt',
        searchPattern: 'line2',
        action: 'after' as const,
        content: 'inserted',
      };
      const result = applyFileChangeToContents(contents, change, 'test.txt');
      expect(result).toBe('line1\nline2\ninserted\nline3');
    });
  });
});

