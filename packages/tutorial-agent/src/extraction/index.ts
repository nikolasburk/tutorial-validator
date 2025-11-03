import { ollama } from 'ai-sdk-ollama';
import { generateObject } from 'ai';
import type { TutorialSpec } from '@tutorial-validator/step-executor';
import { TutorialSpecSchema } from '@tutorial-validator/step-executor';
import type { FailureDossier, ExtractOptions, TutorialInput } from '../shared/index.js';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export class ExtractionAgent {
  private promptDoc: string;
  private tutorialTitle?: string;
  private priorFailures?: FailureDossier[];
  private model: ReturnType<typeof ollama>;

  constructor(tutorialPath: string) {
    this.promptDoc = this.loadPromptDoc();
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
  ): Promise<TutorialSpec> {
    console.log('[DEBUG] Extracting steps from tutorial...');
    
    // Build the prompt
    const prompt = this.buildPrompt(tutorial, options?.priorFailures || []);

    console.log('[DEBUG] Prompt:', prompt);
    
    try {
      const result = await generateObject({
        model: this.model,
        schema: TutorialSpecSchema,
        prompt,
        temperature: 0.1, // Lower temperature for more consistent structured output
      });

      console.log('[DEBUG] Successfully extracted tutorial spec');
      
      return result.object as TutorialSpec;
    } catch (error) {
      console.error('[ERROR] Failed to extract steps:', error);
      
      // Return empty spec on error (will be caught by validation)
      return {
        steps: [],
        metadata: {
          title: this.tutorialTitle || 'Tutorial',
        },
      };
    }
  }

  private buildPrompt(tutorial: TutorialInput, priorFailures: FailureDossier[]): string {
    const tutorialContent = tutorial.files
      .map(file => `## ${file.path}\n\n${file.contents}`)
      .join('\n\n---\n\n');

    let prompt = `${this.promptDoc}\n\n`;

    if (priorFailures.length > 0) {
      prompt += `\n## Previous Failures to Avoid\n\n`;
      priorFailures.forEach((failure, idx) => {
        prompt += `### Failure ${idx + 1}\n`;
        if (failure.kind === 'schema-validation') {
          prompt += `**Type:** Schema Validation Error\n`;
          prompt += `**Message:** ${failure.message}\n`;
          prompt += `**Errors:**\n\`\`\`json\n${failure.schemaErrorsJson}\n\`\`\`\n\n`;
        } else if (failure.kind === 'execution-failure') {
          prompt += `**Type:** Execution Failure\n`;
          prompt += `**Step:** ${failure.summary.stepId} (Step ${failure.summary.stepNumber})\n`;
          prompt += `**Description:** ${failure.summary.description || 'N/A'}\n`;
          prompt += `**Error:** ${failure.summary.error}\n\n`;
        }
      });
      prompt += `\nPlease carefully review these failures and ensure your extraction avoids these issues.\n\n`;
    }

    prompt += `\n## Tutorial Content\n\n${tutorialContent}\n\n`;
    prompt += `\n## Task\n\nExtract executable steps from the tutorial content above and generate a valid TutorialSpec JSON object following the schema and guidelines provided.`;

    return prompt;
  }

  private loadPromptDoc(): string {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const promptPath = resolve(here, '../prompt-steps-extraction.md');
    return existsSync(promptPath) ? readFileSync(promptPath, 'utf-8') : '';
  }

  private inferTitle(source: string) {
    const base = source.split('/').pop() || 'Tutorial';
    return base.replace(/\.(md|mdx)$/, '');
  }
}