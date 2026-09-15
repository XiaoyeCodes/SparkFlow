import { setTimeout as delay } from 'node:timers/promises';

export type AssistantRun = { sessionId: string; attemptId: string; provider: string; model: string; baseUrl: string };
export type AssistantResearch = {
  start(prompt: string, signal: AbortSignal, authorize: (model: { provider: string; model: string }) => void | Promise<void>, sessionId?: string): Promise<AssistantRun>;
  wait(run: AssistantRun, signal: AbortSignal): Promise<string>;
};
type Transport = <T>(baseUrl: string, pathname: string, init?: RequestInit) => Promise<T>;

/** Observe the same durable Vibe session as the assistant, without a second model call. */
export function createAssistantResearch(prepare: (sessionId?: string) => Promise<Omit<AssistantRun, 'attemptId'>>, request: Transport, interval = 1500): AssistantResearch {
  const cancellations = new Map<string, () => void>();
  const cancel = async (run: Pick<AssistantRun, 'baseUrl' | 'sessionId'> & { attemptId?: string }) => {
    const expected = run.attemptId ? `?expected_attempt_id=${encodeURIComponent(run.attemptId)}` : '';
    await request(run.baseUrl, `/sessions/${encodeURIComponent(run.sessionId)}/cancel${expected}`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
  };
  return {
    async start(prompt, signal, authorize, sessionId) {
      if (!prompt.trim() || prompt.length > 64000) throw new Error('持仓报告输入超过 64000 字符限制');
      signal.throwIfAborted();
      const prepared = await prepare(sessionId);
      if (sessionId && prepared.sessionId !== sessionId) throw new Error('ASSISTANT_SESSION_UNAVAILABLE');
      signal.throwIfAborted();
      await authorize(prepared);
      signal.throwIfAborted();
      if (sessionId) {
        const session = await request<{ last_attempt_status?: string }>(prepared.baseUrl, `/sessions/${encodeURIComponent(sessionId)}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
        if (['pending', 'running'].includes(session.last_attempt_status ?? '')) throw new Error('ASSISTANT_SESSION_BUSY');
      }
      try {
        // Do not retry a POST with an uncertain outcome: it could launch duplicate research.
        const sent = await request<{ attempt_id: string }>(prepared.baseUrl, `/sessions/${encodeURIComponent(prepared.sessionId)}/messages`, {
          method: 'POST', body: JSON.stringify({ content: prompt, ...(sessionId ? { require_idle: true } : {}) }), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        });
        if (!sent.attempt_id) throw new Error('研究引擎未返回任务标识');
        const onAbort = () => { cancellations.delete(sent.attempt_id); void cancel({ ...prepared, attemptId: sent.attempt_id }); };
        cancellations.set(sent.attempt_id, onAbort);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        return { ...prepared, attemptId: sent.attempt_id };
      } catch (error) {
        // An existing session may have another turn in flight: an uncertain/rejected
        // POST must neither be retried nor cancel a turn we have not acknowledged.
        if (!sessionId) await cancel(prepared);
        throw error;
      }
    },
    async wait(run, signal) {
      const route = `/sessions/${encodeURIComponent(run.sessionId)}`;
      let completedReads = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const init = { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) };
          let messages: { role: string; content: string; linked_attempt_id?: string }[];
          let session: { last_attempt_id?: string; last_attempt_status?: string };
          try {
            [messages, session] = await Promise.all([
              request<typeof messages>(run.baseUrl, `${route}/messages?limit=1000`, init),
              request<typeof session>(run.baseUrl, route, init),
            ]);
          } catch {
            // Transient read failures do not restart or regenerate an expensive research run.
            await delay(interval, undefined, { signal });
            continue;
          }
          if (session.last_attempt_id === run.attemptId && ['failed', 'cancelled', 'interrupted'].includes(session.last_attempt_status ?? '')) {
            throw new Error(session.last_attempt_status === 'cancelled' ? '研究已取消' : 'AI 助手研究未返回完整报告，请在助手历史中查看详情后重试');
          }
          const result = messages.find(message => message.role === 'assistant' && message.linked_attempt_id === run.attemptId && message.content.trim());
          // Vibe also stores assistant messages for failed attempts. These are not reports.
          if (result && /^Execution failed:/i.test(result.content.trim())) throw new Error('AI 助手研究失败');
          if (result && (session.last_attempt_id !== run.attemptId || session.last_attempt_status === 'completed')) return result.content;
          // The status and message are read independently; allow the final message to commit.
          if (session.last_attempt_id === run.attemptId && session.last_attempt_status === 'completed' && ++completedReads >= 3) throw new Error('AI 助手研究未返回完整报告');
          await delay(interval, undefined, { signal });
        }
      } finally {
        const listener = cancellations.get(run.attemptId);
        if (listener) signal.removeEventListener('abort', listener);
        cancellations.delete(run.attemptId);
      }
    },
  };
}
