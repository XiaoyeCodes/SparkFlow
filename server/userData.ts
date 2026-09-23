import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type SparkFlowUserDataPaths = ReturnType<typeof createUserDataPaths>;

export function createUserDataPaths(rootDir: string) {
  const root = path.resolve(process.env.SPARKFLOW_USER_DATA_DIR || path.join(rootDir, 'UserData'));
  return {
    root,
    assistantDir: path.join(root, 'assistant'),
    assistantSessionsDir: path.join(root, 'assistant', 'conversations'),
    assistantRunsDir: path.join(root, 'assistant', 'runs'),
    assistantUploadsDir: path.join(root, 'assistant', 'uploads'),
    accountsDir: path.join(root, 'accounts'),
    ibkrWorkbenchDir: path.join(root, 'accounts', 'ibkr-workbench'),
    ibkrTerminalDir: path.join(root, 'accounts', 'ibkr-terminal'),
    settingsDir: path.join(root, 'settings'),
    integrationSettingsFile: path.join(root, 'settings', 'integration-settings.json'),
    vibeEnvFile: path.join(root, 'settings', 'vibe.env'),
    exportsDir: path.join(root, 'exports'),
    pdfExportsDir: path.join(root, 'exports', 'pdf'),
    reportsDir: path.join(root, 'reports'),
  };
}

function copyLegacy(source: string, target: string, exclude: string[] = []) {
  if (!existsSync(source)) return;
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: false,
    preserveTimestamps: true,
    filter: sourcePath => !exclude.includes(path.basename(sourcePath)),
  });
}

export function initializeUserData(rootDir: string) {
  const paths = createUserDataPaths(rootDir);
  for (const directory of [
    paths.assistantSessionsDir,
    paths.assistantRunsDir,
    paths.assistantUploadsDir,
    paths.ibkrWorkbenchDir,
    paths.ibkrTerminalDir,
    paths.settingsDir,
    paths.pdfExportsDir,
    paths.reportsDir,
  ]) mkdirSync(directory, { recursive: true });

  const vibeAgent = path.join(rootDir, 'services', 'vibe-trading', 'agent');
  copyLegacy(path.join(rootDir, '.sparkflow', 'ibkr-workbench'), paths.ibkrWorkbenchDir, ['worker.lock']);
  copyLegacy(path.join(rootDir, '.sparkflow', 'ibkr-terminal'), paths.ibkrTerminalDir);
  copyLegacy(path.join(vibeAgent, 'sessions'), paths.assistantSessionsDir);
  copyLegacy(path.join(vibeAgent, 'runs'), paths.assistantRunsDir);
  copyLegacy(path.join(vibeAgent, 'uploads'), paths.assistantUploadsDir);
  copyLegacy(path.join(vibeAgent, '.env'), paths.vibeEnvFile);
  copyLegacy(path.join(homedir(), '.SparkFlow', 'apikey', 'integration-settings.json'), paths.integrationSettingsFile);
  copyLegacy(path.join(rootDir, '.sparkflow', 'integration-settings.json'), paths.integrationSettingsFile);
  copyLegacy(path.join(rootDir, '.sparkflow', 'coze-reports'), path.join(paths.reportsDir, 'coze-reports'));

  const readme = path.join(paths.root, 'README.txt');
  if (!existsSync(readme)) writeFileSync(readme, [
    'SparkFlow personal user data',
    '',
    'assistant/  AI conversations, research runs and uploads',
    'accounts/   IBKR state, net asset value history, paper orders and backtests',
    'settings/   Local model settings and API credentials',
    'exports/    Files exported from SparkFlow',
    'reports/    Generated research reports and report attachments',
    '',
    'This directory is local-only and excluded from Git. Back it up with the rest of your personal files.',
  ].join('\n'), 'utf8');
  return paths;
}

export function safeExportName(value: string, fallback = 'SparkFlow-export.pdf') {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned && cleaned.toLowerCase().endsWith('.pdf') ? cleaned : fallback;
}
