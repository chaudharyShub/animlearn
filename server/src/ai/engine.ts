// The only module that talks to the AI. Swap `createEngine` to change providers.
import { query } from '@anthropic-ai/claude-agent-sdk';

export interface CompleteRequest {
  system: string;
  prompt: string;
  /** Short label used in logs, e.g. "plan" or "step 3". */
  label?: string;
}

export interface AiEngine {
  readonly name: string;
  complete(req: CompleteRequest): Promise<string>;
}

/**
 * Uses the Claude Agent SDK with the local Claude Code login (subscription).
 * Tools are disabled: we only want text back.
 */
export class ClaudeAgentEngine implements AiEngine {
  readonly name = 'claude-agent-sdk';

  constructor(private readonly model?: string) {}

  async complete({ system, prompt, label = 'ai' }: CompleteRequest): Promise<string> {
    const started = Date.now();
    // Make sure the SDK subprocess never sees an API key, so it always uses the subscription login.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const run = query({
      prompt,
      options: {
        systemPrompt: system,
        tools: [],
        maxTurns: 1,
        settingSources: [],
        persistSession: false,
        env,
        ...(this.model ? { model: this.model } : {}),
      },
    });

    let text: string | undefined;
    for await (const msg of run) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success' && !msg.is_error) {
          text = msg.result;
        } else {
          const detail = 'result' in msg ? String(msg.result) : msg.subtype;
          throw new Error(`Claude call failed (${label}): ${detail}`);
        }
      }
    }
    if (!text) throw new Error(`Claude returned no text (${label})`);
    console.log(`[ai] ${label} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return text;
  }
}

export function checkApiKeyWarning(): void {
  if (process.env.ANTHROPIC_API_KEY) {
    const line = '!'.repeat(72);
    console.warn(
      `\n${line}\n  WARNING: ANTHROPIC_API_KEY is set in your environment.\n` +
        `  If Claude Code uses it, calls are billed to the paid API, not your subscription.\n` +
        `  AnimLearn removes it from the Claude subprocess, but you should unset it.\n${line}\n`,
    );
  }
}

export function createEngine(): AiEngine {
  return new ClaudeAgentEngine(process.env.ANIMLEARN_MODEL || undefined);
}
