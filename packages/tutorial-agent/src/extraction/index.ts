import { ollama } from 'ai-sdk-ollama';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { TutorialSpec } from '@tutorial-validator/step-executor';
import { TutorialSpecSchema } from '@tutorial-validator/step-executor';
import type { FailureDossier, ExtractOptions, TutorialInput } from '../shared/index.js';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Wrapper schema that includes both the spec and optional learnings reflection
const ExtractionResultSchema = z.object({
  spec: TutorialSpecSchema,
  learnings: z.string().optional().describe(
    'Reflection on what was done differently after considering prior failures. ' +
    'Only include if priorFailures were provided and influenced the extraction. ' +
    'Explain what specific changes were made to avoid the previous failures.'
  ),
});

export class ExtractionAgent {
  private promptDoc: string;
  private tutorialTitle?: string;
  private model: ReturnType<typeof ollama>;

  constructor(tutorialPath: string) {
    this.promptDoc = this.loadPromptDoc();
    // console.log('[DEBUG] promptDoc:', this.promptDoc);
    this.tutorialTitle = this.inferTitle(tutorialPath);
    
    // Initialize Ollama provider with Qwen2.5
    // Default: qwen2.5:7b-instruct (7B model)
    // Alternative: qwen2.5:72b-instruct for better quality (requires more RAM)
    this.model = ollama('qwen2.5:7b-instruct', {
      // Optional: specify custom base URL if Ollama is running elsewhere
      // baseURL: 'http://localhost:11434',
    });
  }

  async extractSteps(
    tutorial: TutorialInput,
    options?: ExtractOptions,
  ): Promise<{ spec: TutorialSpec; prompt: string; learnings?: string }> {
    console.log('[DEBUG] Extracting steps from tutorial...');
    
    // Build the prompt
    let prompt = this.buildPrompt(tutorial, options?.priorFailures || []);

    // Add reflection instruction if there are prior failures
    const hasPriorFailures = options?.priorFailures && options.priorFailures.length > 0;
    if (hasPriorFailures) {
      prompt += `\n\n## Reflection on Prior Failures\n\n` +
        `After generating the steps above, please reflect on what you did differently ` +
        `to avoid the previous failures. Consider:\n` +
        `- What specific issues from the previous failures did you address?\n` +
        `- What changes did you make to your extraction approach?\n` +
        `- What details did you pay extra attention to that you might have missed otherwise?\n\n` +
        `Provide a concise explanation in the "learnings" field. If you did not make ` +
        `any significant changes based on the failures, you can leave this field empty.`;
    }

    // Add debugging for prompt size
    const promptSize = prompt.length;
    const promptSizeKB = (promptSize / 1024).toFixed(2);
    console.log(`[DEBUG] Prompt size: ${promptSize} chars (${promptSizeKB} KB)`);
    if (hasPriorFailures) {
      console.log(`[DEBUG] Prior failures count: ${options?.priorFailures?.length || 0}`);
    }

    try {
      const startTime = Date.now();
      console.log(`[DEBUG] Starting generateObject call at ${new Date().toISOString()}`);
      
      // Add a heartbeat to show progress
      const heartbeatInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const elapsedSeconds = (elapsed / 1000).toFixed(1);
        console.log(`[DEBUG] ⏳ generateObject still running... (${elapsedSeconds}s elapsed)`);
      }, 10000); // Log every 10 seconds

      // Add timeout wrapper (3 minutes default)
      const timeoutMs = 3 * 60 * 1000; // 3 minutes
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`generateObject timeout after ${timeoutMs}ms (${timeoutMs / 1000 / 60} minutes)`));
        }, timeoutMs);
      });

      const generatePromise = generateObject({
        model: this.model,
        schema: ExtractionResultSchema,
        prompt,
        temperature: 0, // Lower temperature for more consistent structured output
      });

      const result = await Promise.race([generatePromise, timeoutPromise]);
      
      clearInterval(heartbeatInterval);
      
      const duration = Date.now() - startTime;
      const durationSeconds = (duration / 1000).toFixed(2);
      console.log(`[DEBUG] ✅ generateObject completed in ${durationSeconds}s (${duration}ms)`);
      console.log('[DEBUG] Successfully extracted tutorial spec');
      if (result.object.learnings) {
        console.log('[DEBUG] Learnings captured:', result.object.learnings.substring(0, 100) + '...');
      }

      return {
        spec: result.object.spec as TutorialSpec,
        prompt,
        learnings: result.object.learnings,
      };
    } catch (error) {
      console.error('[ERROR] Failed to extract steps:', error);
      if (error instanceof Error) {
        console.error('[ERROR] Error message:', error.message);
        console.error('[ERROR] Error stack:', error.stack);
      }
      
      // Return empty spec on error (will be caught by validation)
      return {
        spec: {
          steps: [],
          metadata: {
            title: this.tutorialTitle || 'Tutorial',
          },
        },
        prompt,
      };
    }
  }

  buildPrompt(tutorial: TutorialInput, priorFailures: FailureDossier[]): string {
    const tutorialContent = tutorial.files
      .map(file => `## ${file.path}\n\n${file.contents}`)
      .join('\n\n---\n\n');

    let prompt = `${this.promptDoc}\n\n`;
    if (priorFailures.length > 0) {
      prompt += `\n## Previous Failures to Avoid\n\n`;
      prompt += `The following failures occurred during previous attempts. Analyze each failure carefully ` +
        `to understand what went wrong and ensure your extraction avoids these issues.\n\n`;
      
      priorFailures.forEach((failure, idx) => {
        prompt += `### Failure ${idx + 1}\n\n`;
        
        if (failure.kind === 'schema-validation') {
          prompt += `**Type:** Schema Validation Error\n\n`;
          prompt += `**Message:** ${failure.message}\n\n`;
          prompt += `**Errors:**\n\`\`\`json\n${failure.schemaErrorsJson}\n\`\`\`\n\n`;
        } else if (failure.kind === 'execution-failure') {
          prompt += `**Type:** Execution Failure\n\n`;
          prompt += `**Step:** ${failure.summary.stepId} (Step ${failure.summary.stepNumber})\n`;
          prompt += `**Step Type:** ${failure.summary.stepType}\n`;
          prompt += `**Description:** ${failure.summary.description || 'N/A'}\n`;
          prompt += `**Error:** ${failure.summary.error}\n\n`;
          
          // Include successful steps before failure for context
          if (failure.successfulStepsBeforeFailure && failure.successfulStepsBeforeFailure.length > 0) {
            prompt += `**Successful Steps Before Failure:**\n`;
            failure.successfulStepsBeforeFailure.forEach((s, i) => {
              prompt += `  ${i + 1}. Step ${s.stepNumber} (${s.stepId}): ${s.description || s.type || 'N/A'}\n`;
            });
            prompt += `\n`;
          }
          
          // Include the full step definition
          if (failure.stepDefinition) {
            prompt += `**Step Definition (What Was Attempted):**\n`;
            prompt += `\`\`\`json\n${JSON.stringify(failure.stepDefinition, null, 2)}\n\`\`\`\n\n`;
            
            // Add step-specific details based on type
            if (failure.stepDefinition.type === 'run-command') {
              const cmd = failure.stepDefinition as any;
              prompt += `**Command Details:**\n`;
              prompt += `- Command: \`${cmd.command}\`\n`;
              if (cmd.workingDirectory) {
                prompt += `- Working Directory: ${cmd.workingDirectory}\n`;
              }
              if (cmd.expectedExitCode !== undefined) {
                prompt += `- Expected Exit Code: ${cmd.expectedExitCode}\n`;
              }
              if (cmd.env && Object.keys(cmd.env).length > 0) {
                prompt += `- Environment Variables: ${JSON.stringify(cmd.env)}\n`;
              }
              prompt += `\n`;
            } else if (failure.stepDefinition.type === 'validate') {
              const val = failure.stepDefinition as any;
              prompt += `**Validation Details:**\n`;
              prompt += `- Validation Type: ${val.validation?.type || 'N/A'}\n`;
              if (val.validation?.type === 'cli-output') {
                prompt += `- Command: ${val.validation.command}\n`;
                if (val.validation.check) {
                  prompt += `- Checks: ${JSON.stringify(val.validation.check)}\n`;
                }
              } else if (val.validation?.type === 'file-contents') {
                prompt += `- File Path: ${val.validation.path}\n`;
                if (val.validation.check) {
                  prompt += `- Checks: ${JSON.stringify(val.validation.check)}\n`;
                }
              }
              prompt += `\n`;
            } else if (failure.stepDefinition.type === 'change-file') {
              const fileChange = failure.stepDefinition as any;
              prompt += `**File Change Details:**\n`;
              prompt += `- Change Type: ${fileChange.change?.type || 'N/A'}\n`;
              prompt += `- File Path: ${fileChange.change?.path || 'N/A'}\n`;
              if (fileChange.workingDirectory) {
                prompt += `- Working Directory: ${fileChange.workingDirectory}\n`;
              }
              prompt += `\n`;
            }
          }
          
          // Include execution output
          if (failure.output && failure.output.length > 0) {
            const outputPreview = failure.output.length > 2000 
              ? failure.output.substring(0, 2000) + '\n... (truncated)'
              : failure.output;
            prompt += `**Execution Output:**\n\`\`\`\n${outputPreview}\n\`\`\`\n\n`;
          }
          
          // Include tutorial context if available
          if (failure.tutorialContext) {
            prompt += `**Relevant Tutorial Context:**\n`;
            prompt += `\`\`\`\n${failure.tutorialContext}\n\`\`\`\n\n`;
          }
        }
        
        prompt += `---\n\n`;
      });
      
      prompt += `\n## Analysis Instructions\n\n`;
      prompt += `For each failure above, consider:\n`;
      prompt += `1. **What went wrong?** - Analyze the error message and execution output\n`;
      prompt += `2. **Why did it fail?** - Look at the step definition and tutorial context\n`;
      prompt += `3. **What should be different?** - How should the step be extracted/modified to succeed?\n`;
      prompt += `4. **What worked before?** - Use the successful steps context to understand the state\n`;
      prompt += `5. **Tutorial intent** - Match the tutorial context to understand what the user should actually do\n\n`;
    }

    // console.log('[DEBUG] Prompt without tutorial content:', prompt);

    prompt += `\n## Tutorial Content\n\n${tutorialContent}\n\n`;
    prompt += `\n## Task\n\nExtract executable steps from the tutorial content above and generate a valid TutorialSpec JSON object following the schema and guidelines provided.`;

    return prompt;
  }

  private loadPromptDoc(): string {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const promptPath = resolve(here, '../../prompt-steps-extraction.md');
    return existsSync(promptPath) ? readFileSync(promptPath, 'utf-8') : '';
  }

  private inferTitle(source: string) {
    const base = source.split('/').pop() || 'Tutorial';
    return base.replace(/\.(md|mdx)$/, '');
  }
}