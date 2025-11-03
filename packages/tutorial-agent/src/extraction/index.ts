import type { TutorialSpec } from '@tutorial-validator/step-executor';
import type { FailureDossier, ExtractOptions, TutorialInput } from '../shared/index.js'; // or move to shared types
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export class ExtractionAgent {
  private promptDoc: string;
  private tutorialTitle?: string;
  private priorFailures?: FailureDossier[];

  constructor(options: ExtractOptions) {
    this.promptDoc = this.loadPromptDoc();
    this.priorFailures = options.priorFailures;
    this.tutorialTitle = this.inferTitle(options.tutorialPath);
  }

  async extractSteps(
    tutorial: TutorialInput,
  ): Promise<TutorialSpec> {
    console.log('[DEBUG] Extracting steps from tutorial...');
    return {
      steps: [],
    };
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