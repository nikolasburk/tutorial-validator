import type { ExecutionResult, TutorialSpec } from '@tutorial-validator/step-executor';

/**
 * Tutorial file input representation
 */
export interface TutorialInput {
  files: Array<{
    path: string;
    contents: string;
  }>;
}

/**
 * Execution failure information
 */
export interface ExecutionFailureDossier {
  kind: 'execution-failure';
  summary: {
    stepId: string;
    stepNumber: number;
    stepType: string;
    description?: string;
    error: string;
  };
  /** The full step definition that was attempted */
  stepDefinition?: any;
  /** Successful steps that executed before this failure */
  successfulStepsBeforeFailure?: Array<{
    stepId: string;
    stepNumber: number;
    description?: string;
    type?: string;
  }>;
  /** The execution output (stdout/stderr combined) */
  output: string;
  /** Workspace root path where execution occurred */
  workspaceRoot: string;
  /** Relevant tutorial content snippet for context (if available) */
  tutorialContext?: string;
}

/**
 * Schema validation failure information
 */
export interface SchemaValidationDossier {
  kind: 'schema-validation';
  schemaErrorsJson: string;
  message: string;
}

/**
 * Union type for all failure dossiers
 */
export type FailureDossier = ExecutionFailureDossier | SchemaValidationDossier;

/**
 * Options for extracting steps from a tutorial
 */
export interface ExtractOptions {
  priorFailures?: FailureDossier[];
  tutorialPath?: string;
}

/**
 * Options for generating feedback
 */
export interface FeedbackOptions {
  executionResult: ExecutionResult;
  tutorialSpec: TutorialSpec;
  tutorialInput: TutorialInput;
  priorFailures?: FailureDossier[];
}