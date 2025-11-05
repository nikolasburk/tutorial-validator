import { describe, it, expect } from 'vitest';
import { TutorialSpecSchema } from '../../src/dsl/schemas.js';

describe('TutorialSpecSchema', () => {
  describe('minimal valid spec', () => {
    it('should validate a spec with just steps', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'run-command',
            stepNumber: 1,
            command: 'echo hello',
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
      const result = TutorialSpecSchema.parse(spec);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].id).toBe('step-1');
    });

    it('should validate a spec with metadata', () => {
      const spec = {
        metadata: {
          title: 'Test Tutorial',
          description: 'A test',
          version: '1.0.0',
        },
        steps: [
          {
            id: 'step-1',
            type: 'run-command',
            stepNumber: 1,
            command: 'echo hello',
          },
        ],
      };
      const result = TutorialSpecSchema.parse(spec);
      expect(result.metadata?.title).toBe('Test Tutorial');
    });
  });

  describe('step validation', () => {
    it('should validate run-command step', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'run-command',
            stepNumber: 1,
            command: 'echo hello',
            workingDirectory: 'test',
            env: { KEY: 'value' },
            expectedExitCode: 0,
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should validate change-file step with replace', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'change-file',
            stepNumber: 1,
            change: {
              type: 'replace',
              path: 'test.txt',
              contents: 'new content',
            },
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should validate change-file step with diff', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'change-file',
            stepNumber: 1,
            change: {
              type: 'diff',
              path: 'test.txt',
              removeLines: { start: 0, end: 1 },
            },
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should validate change-file step with context', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'change-file',
            stepNumber: 1,
            change: {
              type: 'context',
              path: 'test.txt',
              searchPattern: 'pattern',
              action: 'after',
              content: 'new content',
            },
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should validate validate step with cli-output', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'validate',
            stepNumber: 1,
            validation: {
              type: 'cli-output',
              command: 'echo test',
              check: {
                contains: 'test',
                exitCode: 0,
              },
            },
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should validate validate step with file-contents', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'validate',
            stepNumber: 1,
            validation: {
              type: 'file-contents',
              path: 'test.txt',
              check: {
                contains: 'content',
                exists: true,
              },
            },
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should validate validate step with browser', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'validate',
            stepNumber: 1,
            validation: {
              type: 'browser',
              url: 'http://localhost:3000',
              check: {
                selector: 'body',
                containsText: 'Hello',
              },
            },
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should validate browser-action step', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'browser-action',
            stepNumber: 1,
            url: 'http://localhost:3000',
            actions: [
              {
                type: 'click',
                selector: 'button',
              },
            ],
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });
  });

  describe('invalid specs', () => {
    it('should reject spec without steps', () => {
      const spec = {};
      expect(() => TutorialSpecSchema.parse(spec)).toThrow();
    });

    it('should accept spec with empty steps array (schema allows it)', () => {
      const spec = { steps: [] };
      // The schema doesn't enforce minimum array length, so empty arrays are valid
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });

    it('should reject step with invalid type', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'invalid-type',
            stepNumber: 1,
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).toThrow();
    });

    it('should reject step without required fields', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'run-command',
            // missing stepNumber and command
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).toThrow();
    });

    it('should reject step with invalid stepNumber', () => {
      const spec = {
        steps: [
          {
            id: 'step-1',
            type: 'run-command',
            stepNumber: 0, // must be positive
            command: 'echo hello',
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).toThrow();
    });
  });

  describe('prerequisites', () => {
    it('should validate prerequisites', () => {
      const spec = {
        prerequisites: {
          commands: ['node', 'npm'],
          envVars: ['API_KEY'],
        },
        steps: [
          {
            id: 'step-1',
            type: 'run-command',
            stepNumber: 1,
            command: 'echo hello',
          },
        ],
      };
      expect(() => TutorialSpecSchema.parse(spec)).not.toThrow();
    });
  });
});

