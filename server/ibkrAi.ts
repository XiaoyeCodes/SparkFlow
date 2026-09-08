import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AiModel } from '../src/lib/ibkr/workbenchTypes.ts';

type IntegrationAiSettings = { ai?: { provider?: unknown; apiKey?: unknown; model?: unknown; baseUrl?: unknown } };
const providerEnvironment: Record<string, { provider: string; key: string; base: string }> = {
  openai: { provider: 'openai', key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
  custom: { provider: 'openai', key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
  deepseek: { provider: 'deepseek', key: 'DEEPSEEK_API_KEY', base: 'DEEPSEEK_BASE_URL' },
  zhipu: { provider: 'zhipu', key: 'ZHIPU_API_KEY', base: 'ZHIPU_BASE_URL' },
  qwen: { provider: 'qwen', key: 'DASHSCOPE_API_KEY', base: 'DASHSCOPE_BASE_URL' },
};

const boundedText = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length <= maximum ? value.trim() : '';

/** Map the user-visible local integration setting to the isolated IBKR worker.
 * The key stays only in the child process environment and is never logged. */
export function ibkrAiEnvironmentFromIntegrationSettings(value: unknown): NodeJS.ProcessEnv {
  const ai = (value as IntegrationAiSettings | null)?.ai;
  const provider = boundedText(ai?.provider, 32).toLowerCase();
  const mapping = providerEnvironment[provider];
  const apiKey = boundedText(ai?.apiKey, 1024);
  const model = boundedText(ai?.model, 160);
  const baseUrl = boundedText(ai?.baseUrl, 1024).replace(/\/+$/, '');
  if (!mapping || !apiKey || !model || !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(baseUrl)) return {};
  return {
    LANGCHAIN_PROVIDER: mapping.provider,
    LANGCHAIN_MODEL_NAME: model,
    [mapping.key]: apiKey,
    [mapping.base]: baseUrl,
  };
}

async function ibkrAiIntegrationEnvironment() {
  const file = path.join(homedir(), '.SparkFlow', 'apikey', 'integration-settings.json');
  try { return ibkrAiEnvironmentFromIntegrationSettings(JSON.parse(await readFile(file, 'utf8'))); }
  catch { return {}; }
}

export function aiFailureCode(output: string) {
  try { const code = JSON.parse(output).error; if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(code)) return code; } catch { /* Never expose raw provider output. */ }
  return 'AI_INVOCATION_FAILED_CHECK_MODEL_SETTINGS';
}
export function createIbkrAi(root: string) {
  const children = new Set<ReturnType<typeof spawn>>();
  let cache: { at: number; value: AiModel } | undefined;
  let statusFlight: Promise<AiModel> | undefined;
  async function execute(action: 'status' | 'analyze' | 'tool', input?: unknown, signal?: AbortSignal): Promise<any> {
    const executable = path.join(root, 'services/vibe-trading/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const integrationEnvironment = await ibkrAiIntegrationEnvironment();
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [path.join(root, 'scripts/ibkr-ai-analysis.py'), action], { cwd: path.join(root, 'services/vibe-trading/agent'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...integrationEnvironment, PYTHONIOENCODING: 'utf-8', LANGCHAIN_TRACING_V2: 'false', LANGSMITH_TRACING: 'false' } });
      children.add(child); let output = ''; let completed = false;
      const finish = (error?: Error) => { if (completed) return; completed = true; clearTimeout(timer); children.delete(child); signal?.removeEventListener('abort', abort); if (error) reject(error); else { try { const value = JSON.parse(output); if (value.error) { reject(new Error(/^[A-Z][A-Z0-9_]{1,100}$/.test(value.error) ? value.error : 'AI_RESPONSE_INVALID_OR_MODEL_UNAVAILABLE')); return; } resolve(value); } catch { reject(new Error('AI_RESPONSE_INVALID_OR_MODEL_UNAVAILABLE')); } } };
      const abort = () => { child.kill(); finish(new Error('RESEARCH_CANCELLED')); };
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => { child.kill(); finish(new Error('AI_REQUEST_TIMEOUT')); }, action === 'status' ? 20000 : action === 'tool' ? 65000 : 600000);
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 1000000) { child.kill(); finish(new Error('AI_RESPONSE_TOO_LARGE')); } });
      child.stderr.resume(); child.on('error', () => finish(new Error('VIBE_RUNTIME_UNAVAILABLE')));
      child.on('close', code => finish(code ? new Error(aiFailureCode(output)) : undefined));
      if (signal?.aborted) abort();
      child.stdin.on('error', () => {}); child.stdin.end(input ? JSON.stringify(input) : '');
    });
  }
  return { async status(fresh = false): Promise<AiModel> { if (!fresh && cache && Date.now() - cache.at < 60000) return cache.value; if (statusFlight) return statusFlight; statusFlight = execute('status').then(value => { cache = { at: Date.now(), value }; return value; }).finally(() => { statusFlight = undefined; }); return statusFlight; },
    async analyze(prompt: string, model: AiModel, signal?: AbortSignal, outputMode: 'json' | 'text' | 'brief-json' = 'json') { return execute('analyze', { prompt, fingerprint: model.fingerprint, outputMode }, signal); },
    async tool(tool: string, args: Record<string, unknown>, signal?: AbortSignal) { const result = await execute('tool', { tool, args }, signal); return result.data; },
    close() { for (const child of children) child.kill(); children.clear(); } };
}
