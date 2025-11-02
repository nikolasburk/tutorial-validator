import { z } from 'zod';

// Base step schema
const BaseStepSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  stepNumber: z.number().int().positive(),
});

// Validation schemas
const ValidateCliOutputSchema = z.object({
  type: z.literal('cli-output'),
  command: z.string(),
  workingDirectory: z.string().optional(),
  check: z.object({
    contains: z.string().optional(),
    containsError: z.string().optional(),
    matches: z.string().optional(),
    exitCode: z.number().int().optional(),
  }),
});

const ValidateFileContentsSchema = z.object({
  type: z.literal('file-contents'),
  path: z.string(),
  check: z.object({
    contains: z.string().optional(),
    matches: z.string().optional(),
    equals: z.string().optional(),
    exists: z.boolean().optional(),
  }),
});

const ValidateBrowserSchema = z.object({
  type: z.literal('browser'),
  url: z.string(),
  check: z.object({
    containsText: z.string().optional(),
    selector: z.string().optional(),
    elementText: z.string().optional(),
    attribute: z.object({
      name: z.string(),
      value: z.string(),
    }).optional(),
    evaluate: z.string().optional(),
  }),
});

export const ValidationSchema = z.discriminatedUnion('type', [
  ValidateCliOutputSchema,
  ValidateFileContentsSchema,
  ValidateBrowserSchema,
]);

// File change schemas
const ReplaceFileContentsSchema = z.object({
  type: z.literal('replace'),
  path: z.string(),
  contents: z.string(),
});

const ApplyDiffChangeSchema = z.object({
  type: z.literal('diff'),
  path: z.string(),
  removeLines: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }).optional(),
  insertLines: z.object({
    at: z.number().int().min(0),
    lines: z.array(z.string()),
  }).optional(),
  findReplace: z.object({
    find: z.string(),
    replace: z.string(),
  }).optional(),
});

const ContextBasedChangeSchema = z.object({
  type: z.literal('context'),
  path: z.string(),
  searchPattern: z.string(),
  action: z.enum(['before', 'after', 'replace']),
  content: z.string(),
});

export const FileChangeSchema = z.discriminatedUnion('type', [
  ReplaceFileContentsSchema,
  ApplyDiffChangeSchema,
  ContextBasedChangeSchema,
]);

// Step schemas
const RunCommandStepSchema = BaseStepSchema.extend({
  type: z.literal('run-command'),
  command: z.string(),
  workingDirectory: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  expectedExitCode: z.number().int().optional(),
  captureOutput: z.boolean().optional(),
});

const ChangeFileStepSchema = BaseStepSchema.extend({
  type: z.literal('change-file'),
  change: FileChangeSchema,
});

const ValidateStepSchema = BaseStepSchema.extend({
  type: z.literal('validate'),
  validation: ValidationSchema,
});

export const TutorialStepSchema = z.discriminatedUnion('type', [
  RunCommandStepSchema,
  ChangeFileStepSchema,
  ValidateStepSchema,
]);

// Main tutorial spec schema
export const TutorialSpecSchema = z.object({
  metadata: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    author: z.string().optional(),
    version: z.string().optional(),
  }).optional(),
  prerequisites: z.object({
    commands: z.array(z.string()).optional(),
    envVars: z.array(z.string()).optional(),
    versions: z.record(z.string(), z.string()).optional(),
  }).optional(),
  workingDirectory: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  steps: z.array(TutorialStepSchema),
});
