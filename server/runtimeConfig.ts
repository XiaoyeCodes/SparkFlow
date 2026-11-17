import path from 'node:path';

export function publicStateDirectory(root = process.cwd()) {
  return path.resolve(process.env.SPARKFLOW_STATE_DIR || path.join(root, '.sparkflow'));
}

/** An overseas cloud host has no desktop VPN listening on its loopback port. */
export function configuredProxy(variable = 'SPARKFLOW_FOREIGN_PROXY', environment: NodeJS.ProcessEnv = process.env) {
  const value = environment[variable] ?? environment.SPARKFLOW_FOREIGN_PROXY
    ?? (environment.SPARKFLOW_CLOUD_MODE === '1' ? 'direct' : 'http://127.0.0.1:7890');
  if (!value || value === 'direct') return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${variable} must be an HTTP proxy URL or direct`);
  return url.href.replace(/\/$/, '');
}
