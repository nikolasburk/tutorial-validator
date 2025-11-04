import { ollama } from 'ai-sdk-ollama';
import { generateObject } from 'ai';
import { z } from 'zod';

export interface OllamaClientOptions {
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
}

export interface OllamaHealthCheck {
  healthy: boolean;
  responseTime: number;
  models: string[];
  error?: string;
}

/**
 * Service for managing Ollama model interactions with timeout, abort, and diagnostics
 */
export class OllamaClient {
  private model: ReturnType<typeof ollama>;
  private modelName: string;
  private baseURL: string;
  private timeoutMs: number;

  constructor(options: OllamaClientOptions = {}) {
    this.modelName = options.model || 'qwen2.5:7b-instruct';
    this.baseURL = options.baseURL || 'http://localhost:11434';
    this.timeoutMs = options.timeoutMs || 3 * 60 * 1000; // 3 minutes default

    this.model = ollama(this.modelName);
  }

  /**
   * Generate structured object with timeout and abort support
   */
  async generateObject<T extends z.ZodTypeAny>(options: {
    schema: T;
    prompt: string;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<z.infer<T>> {
    const { schema, prompt, temperature = 0, timeoutMs = this.timeoutMs } = options;

    const startTime = Date.now();

    // Create AbortController to cancel the request on timeout
    const abortController = new AbortController();
    const { signal } = abortController;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      console.error(
        `[ERROR] generateObject timeout after ${timeoutMs}ms (${timeoutMs / 1000 / 60} minutes) - aborting request`
      );
      abortController.abort();
    }, timeoutMs);

    try {
      const result = await generateObject({
        model: this.model,
        schema,
        prompt,
        temperature,
        abortSignal: signal,
      });

      // Clear timeout since we completed successfully
      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      const durationSeconds = (duration / 1000).toFixed(2);
      console.log(`[DEBUG] ⏱️  Extraction completed in ${durationSeconds}s`);

      return result.object as z.infer<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      // Check if this is an abort/timeout error
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('timeout'))
      ) {
        console.error('[FATAL] generateObject timed out or was aborted');
        console.error('[FATAL] Error:', error.message);
        console.error('[FATAL] Timeout duration:', timeoutMs, 'ms');

        // Additional diagnostics
        await this.diagnoseTimeout();

        // Re-throw to fail the entire execution
        throw new Error(`generateObject timed out after ${timeoutMs / 1000 / 60} minutes: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Check Ollama server health and availability
   */
  async checkHealth(): Promise<OllamaHealthCheck> {
    try {
      const startTime = Date.now();

      // Check if Ollama is running
      const response = await fetch(`${this.baseURL}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout for health check
      });

      const healthCheckDuration = Date.now() - startTime;

      if (!response.ok) {
        return {
          healthy: false,
          responseTime: healthCheckDuration,
          models: [],
          error: `Ollama returned status ${response.status}`,
        };
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models || [];
      const modelNames = models.map((m) => m.name);

      console.log(`[DEBUG] ✅ Ollama server healthy (${healthCheckDuration}ms)`);

      // Check if our model is available
      const hasModel = models.some(
        (m) => m.name.includes('qwen2.5') && m.name.includes('7b')
      );
      if (!hasModel && this.modelName.includes('qwen2.5')) {
        console.warn(`[WARN] Model ${this.modelName} may not be available. Available models: ${modelNames.join(', ')}`);
      }

      return {
        healthy: true,
        responseTime: healthCheckDuration,
        models: modelNames,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[WARN] Ollama health check failed: ${errorMsg}`);
      console.warn(`[WARN] Make sure Ollama is running: ollama serve`);
      console.warn(`[WARN] Check if model is pulled: ollama pull ${this.modelName}`);

      return {
        healthy: false,
        responseTime: -1,
        models: [],
        error: errorMsg,
      };
    }
  }

  /**
   * Run diagnostics when timeout occurs
   */
  async diagnoseTimeout(): Promise<void> {
    console.log('\n[DEBUG] ========== Timeout Diagnostics ==========');

    // Check Ollama health
    const health = await this.checkHealth();
    console.log(`[DEBUG] Health check result:`, health);

    // Check system resources (if possible)
    try {
      const { execSync } = await import('child_process');

      // Check Ollama process info
      try {
        const ollamaPs = execSync('ps aux | grep -i ollama | grep -v grep', { encoding: 'utf-8' });
        console.log(`[DEBUG] Ollama processes:\n${ollamaPs}`);
      } catch {
        console.log('[DEBUG] Could not check Ollama processes');
      }

      // Check memory usage (macOS)
      try {
        const memInfo = execSync('vm_stat | head -10', { encoding: 'utf-8' });
        console.log(`[DEBUG] Memory info:\n${memInfo}`);
      } catch {
        // Ignore on non-macOS
      }
    } catch (error) {
      console.warn('[WARN] Could not run system diagnostics:', error);
    }

    console.log('[DEBUG] ========== End Timeout Diagnostics ==========\n');
  }

  /**
   * Get the model name being used
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Get the base URL being used
   */
  getBaseURL(): string {
    return this.baseURL;
  }
}
