/**
 * Bridge to the host. Screens never open sockets themselves: the web shell talks
 * to the web service, and the native shells talk to the encrypted tunnel. Both
 * expose the same `ReilHost` module, so every screen runs unchanged on both.
 */
import type { RpcMethod, RpcParams, RpcResult } from '@reilai/protocol';

import type { HostResult } from '../env';

export class HostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function host() {
  'background only';
  return NativeModules.ReilHost;
}

export function rpc<M extends RpcMethod>(method: M, params?: RpcParams<M>): Promise<RpcResult<M>> {
  'background only';
  return new Promise((resolve, reject) => {
    const h = host();
    if (!h) return reject(new HostError('no_host', 'Host bridge unavailable'));
    h.rpc(method, (params ?? {}) as Record<string, unknown>, (result: HostResult) => {
      if (result?.ok) resolve(result.result as RpcResult<M>);
      else reject(new HostError(result?.error?.code ?? 'unknown', result?.error?.message ?? 'Request failed'));
    });
  });
}

export function push(screen: string, params: Record<string, unknown> = {}) {
  'background only';
  host()?.push(screen, params);
}

export function pop() {
  'background only';
  host()?.pop();
}

export function present(screen: string, params: Record<string, unknown> = {}) {
  'background only';
  host()?.present(screen, params);
}

export function dismiss() {
  'background only';
  host()?.dismiss();
}

export function selectTab(tab: 'sessions' | 'new' | 'settings') {
  'background only';
  host()?.selectTab?.(tab);
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  'background only';
  host()?.haptic?.(style);
}

export function copyText(text: string) {
  'background only';
  host()?.copyText?.(text);
}

export function kvGet(key: string): Promise<string | null> {
  'background only';
  return new Promise((resolve) => {
    const h = host();
    if (!h) return resolve(null);
    h.kvGet(key, (v) => resolve(v ?? null));
  });
}

export function kvSet(key: string, value: string | null) {
  'background only';
  host()?.kvSet(key, value);
}

export function setThemePref(pref: 'system' | 'light' | 'dark') {
  'background only';
  host()?.setTheme(pref);
}

export function openSession(id: string) {
  'background only';
  push('chat', { id });
}
