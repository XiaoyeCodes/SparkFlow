import type { AccountMode, Snapshot } from './types';
import { getSnapshot } from './client';
import { applyAccountEvent } from './events';
import { emptySnapshot } from './store';

type StreamDiagnostics = { streamMessages: number; streamPatchesApplied: number; streamResyncs: number;
  activeSockets: number; maxActiveSockets: number; pendingMessages: number; maxPendingMessages: number };
declare global { interface Window { __sparkflowDiagnostics?: StreamDiagnostics } }

/** One account stream per mount. Reconnect always obtains HTTP truth first. */
export function startAccountSync(mode: AccountMode, publish: (snapshot: Snapshot) => void) {
  let stopped = false;
  let generation = 0;
  let current = emptySnapshot(mode);
  let socket: WebSocket | null = null;
  let request: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let failures = 0;
  let lastMessageAt = 0;
  let socketCounted = false;
  const diagnostics = () => window.__sparkflowDiagnostics;

  const stopSocket = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.onerror = null; socket.close(); socket = null; }
    if (socketCounted) { const value = diagnostics(); if (value) value.activeSockets = Math.max(0, value.activeSockets - 1); socketCounted = false; }
  };
  const stale = (detail: string) => {
    current = { ...current, connection: 'disconnected', state: current.snapshotId ? 'stale' : 'error', detail };
    publish(current);
  };
  const reconnect = (detail: string, immediately = false) => {
    if (stopped) return;
    ++generation;
    request?.abort();
    stopSocket();
    if (retryTimer) clearTimeout(retryTimer);
    failures += 1;
    stale(failures > 5 ? `${detail} 自动重连已暂停，请点击刷新。` : detail);
    if (failures <= 5) retryTimer = setTimeout(() => void connect(), immediately ? 0 : Math.min(1000 * 2 ** (failures - 1), 16000));
  };
  const connect = async () => {
    const id = ++generation;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const baseline = await getSnapshot(mode, controller.signal);
      if (stopped || id !== generation) return;
      current = baseline;
      publish(current);
      const url = new URL('/api/ibkr-terminal/events', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.search = new URLSearchParams({ mode, accountKey: baseline.accountKey }).toString();
      socket = new WebSocket(url);
      socketCounted = true;
      const opened = diagnostics();
      if (opened) { opened.activeSockets += 1; opened.maxActiveSockets = Math.max(opened.maxActiveSockets, opened.activeSockets); }
      lastMessageAt = Date.now();
      let received = 0;
      socket.onmessage = message => {
        const observed = diagnostics();
        if (observed) { observed.streamMessages += 1; observed.pendingMessages += 1; observed.maxPendingMessages = Math.max(observed.maxPendingMessages, observed.pendingMessages); }
        try {
          if (stopped || id !== generation) return;
          let event: unknown;
          try { event = JSON.parse(String(message.data)); } catch { if (observed) observed.streamResyncs += 1; reconnect('事件格式无效，重新同步账户。'); return; }
          if (typeof event === 'object' && event !== null && 'mode' in event && 'accountKey' in event
            && (event.mode !== current.mode || event.accountKey !== current.accountKey)) return;
          const result = applyAccountEvent(current, event);
          if (result.action === 'resync') { if (observed) observed.streamResyncs += 1; reconnect('事件序号或会话已变化，正在补全快照。', true); return; }
          lastMessageAt = Date.now();
          if (++received >= 3) failures = 0; // A flapping handshake cannot reset the retry budget.
          if (result.action === 'apply') { current = result.snapshot; publish(current); if (observed) observed.streamPatchesApplied += 1; }
        } finally { if (observed) observed.pendingMessages = Math.max(0, observed.pendingMessages - 1); }
      };
      socket.onclose = () => { if (id === generation) reconnect('事件连接已断开；正在重新核对账户。'); };
      socket.onerror = () => { if (id === generation) reconnect('事件连接失败；正在重新核对账户。'); };
      heartbeatTimer = setInterval(() => { if (Date.now() - lastMessageAt > 15000) reconnect('账户心跳超时，缓存已过期。'); }, 5000);
    } catch (error) {
      if (!stopped && id === generation) reconnect(error instanceof Error ? error.message : '账户同步失败。');
    } finally { clearTimeout(timeout); }
  };
  publish({ ...current, state: 'loading' });
  void connect();
  return () => { stopped = true; ++generation; request?.abort(); stopSocket(); if (retryTimer) clearTimeout(retryTimer); };
}
