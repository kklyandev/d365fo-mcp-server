import { z } from 'zod';
import { execFile, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import { access, writeFile, readFile, unlink, appendFile } from 'fs/promises';
import { openSync as openSyncFs, closeSync as closeSyncFs } from 'fs';
import os from 'os';
import crypto from 'crypto';
import { getConfigManager } from '../utils/configManager.js';
import { forceReleaseLock } from '../utils/operationLocks.js';

const execFileAsync = util.promisify(execFile);

// ---------------------------------------------------------------------------
// Build-tool file logger
// ---------------------------------------------------------------------------

async function buildLog(level: 'INFO' | 'WARN' | 'ERROR', message: string): Promise<void> {
  console.error(`[build_d365fo_project] ${message}`);
  try {
    const configManager = getConfigManager();
    const logFile = configManager.getContext()?.bridgeLogFile;
    if (!logFile) return;
    const line = `[${new Date().toISOString()}] [BuildTool] [${level}] ${message}\n`;
    await appendFile(logFile, line, 'utf-8');
  } catch {
    // Best-effort — never throw from logging
  }
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

function assertSafePath(value: string, label: string): void {
  if (/[&|<>^`!;$%"'\n\r]/.test(value)) {
    throw new Error(
      `${label} contains potentially dangerous characters and cannot be used in a build command: ${value}`
    );
  }
}

// ---------------------------------------------------------------------------
// Async build state management
// State and log files live in os.tmpdir(), keyed by a hash of the project path.
// ---------------------------------------------------------------------------

interface BuildJobState {
  pid: number;
  projectPath: string;
  tool: string;
  startTime: string;
  logFile: string;
  status: 'running' | 'succeeded' | 'failed';
  exitCode?: number;
  endTime?: string;
}

function buildJobPaths(projectPath: string): { stateFile: string; logFile: string } {
  const hash = crypto.createHash('md5').update(projectPath.toLowerCase()).digest('hex').slice(0, 10);
  return {
    stateFile: path.join(os.tmpdir(), `d365build_state_${hash}.json`),
    logFile:   path.join(os.tmpdir(), `d365build_log_${hash}.log`),
  };
}

async function readBuildState(projectPath: string): Promise<BuildJobState | null> {
  const { stateFile } = buildJobPaths(projectPath);
  try {
    const raw = await readFile(stateFile, 'utf-8');
    return JSON.parse(raw) as BuildJobState;
  } catch {
    return null;
  }
}

async function writeBuildState(state: BuildJobState): Promise<void> {
  const { stateFile } = buildJobPaths(state.projectPath);
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

async function clearBuildState(projectPath: string): Promise<void> {
  const { stateFile } = buildJobPaths(projectPath);
  await unlink(stateFile).catch(() => {});
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function readLogTail(logFile: string, lines = 60): Promise<string> {
  try {
    const content = await readFile(logFile, 'utf-8');
    const all = content.split(/\r?\n/);
    return all.slice(-lines).join('\n').trim();
  } catch {
    return '(log not yet available)';
  }
}

// ---------------------------------------------------------------------------
// Parse xppc.exe diagnostic XML (BuildModelResult.err.xml)
// xppc.exe does not print errors to stdout — it writes them to:
//   {customPackagesPath}/{modelName}/BuildModelResult.err.xml
// ---------------------------------------------------------------------------

interface XppcDiagnostic {
  severity: string;
  path: string;
  message: string;
  line?: string;
  column?: string;
}

function parseBuildDiagnostics(xml: string): XppcDiagnostic[] {
  const diagnostics: XppcDiagnostic[] = [];
  const itemRegex = /<Diagnostic>([\s\S]*?)<\/Diagnostic>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    diagnostics.push({
      severity: get('Severity'),
      path:     get('Path'),
      message:  get('Message'),
      line:     get('Line') || undefined,
      column:   get('Column') || undefined,
    });
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Parse model name from .rnrproj XML
// ---------------------------------------------------------------------------

async function getModelFromRnrproj(projectPath: string): Promise<string | null> {
  try {
    const content = await readFile(projectPath, 'utf-8');
    const match = content.match(/<Model>\s*([^<]+)\s*<\/Model>/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Locate xppc.exe from microsoftPackagesPath
// ---------------------------------------------------------------------------

async function findXppcExe(microsoftPackagesPath: string | null): Promise<string | null> {
  const candidates: string[] = [];

  if (microsoftPackagesPath) {
    candidates.push(path.join(microsoftPackagesPath, 'bin', 'xppc.exe'));
  }

  // Search AppData for any installed UDE version
  const appDataLocal = process.env.LOCALAPPDATA ||
    path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
  const d365Base = path.join(appDataLocal, 'Microsoft', 'Dynamics365');
  try {
    const { readdir } = await import('fs/promises');
    const versions = await readdir(d365Base);
    for (const ver of versions.sort().reverse()) {
      candidates.push(path.join(d365Base, ver, 'PackagesLocalDirectory', 'bin', 'xppc.exe'));
    }
  } catch { /* ignore */ }

  // CHE well-known locations
  candidates.push(
    'C:\\AOSService\\PackagesLocalDirectory\\bin\\xppc.exe',
    'K:\\AOSService\\PackagesLocalDirectory\\bin\\xppc.exe',
    'J:\\AOSService\\PackagesLocalDirectory\\bin\\xppc.exe',
    'I:\\AOSService\\PackagesLocalDirectory\\bin\\xppc.exe',
  );

  for (const c of candidates) {
    try { await access(c); return c; } catch { /* next */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Background xppc.exe launch
// ---------------------------------------------------------------------------

async function launchXppcBackground(
  xppcExe: string,
  projectPath: string,
  modelName: string,
  customPackagesPath: string,
  microsoftPackagesPath: string,
): Promise<BuildJobState> {
  assertSafePath(xppcExe, 'xppc.exe path');
  assertSafePath(projectPath, 'Project path');
  assertSafePath(modelName, 'Model name');
  assertSafePath(customPackagesPath, 'Custom packages path');
  assertSafePath(microsoftPackagesPath, 'Microsoft packages path');

  const { logFile } = buildJobPaths(projectPath);
  const outputPath = path.join(customPackagesPath, modelName, 'bin');

  const xppcArgs = [
    `-metadata=${customPackagesPath}`,
    `-compilermetadata=${microsoftPackagesPath}`,
    `-modelmodule=${modelName}`,
    `-referenceFolder=${microsoftPackagesPath}`,
    `-referenceFolder=${customPackagesPath}`,
    `-output=${outputPath}`,
    '-incremental',
  ];

  await buildLog('INFO', `xppc.exe args: ${xppcArgs.join(' ')}`);

  // xppc.exe is a normal console app — file descriptor redirect works fine
  const logFd = openSyncFs(logFile, 'w');

  const child = spawn(xppcExe, xppcArgs, {
    detached: false,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });

  const state: BuildJobState = {
    pid: child.pid!,
    projectPath,
    tool: 'xppc.exe',
    startTime: new Date().toISOString(),
    logFile,
    status: 'running',
  };

  await writeBuildState(state);
  await buildLog('INFO', `xppc.exe launched — PID: ${child.pid} | model: ${modelName} | log: ${logFile}`);

  child.on('close', async (code) => {
    closeSyncFs(logFd);
    const exitCode = code ?? -1;
    const succeeded = exitCode === 0;

    // xppc.exe writes diagnostics to {customPackagesPath}/{modelName}/BuildModelResult.err.xml
    // rather than stdout. Append a formatted summary so the caller sees actual error messages.
    try {
      const errXmlPath = path.join(customPackagesPath, modelName, 'BuildModelResult.err.xml');
      const errXml = await readFile(errXmlPath, 'utf-8');
      const diagnostics = parseBuildDiagnostics(errXml);
      if (diagnostics.length > 0) {
        const lines = ['\n--- Compiler diagnostics ---'];
        for (const d of diagnostics) {
          const loc = d.line ? ` (line ${d.line}${d.column ? `, col ${d.column}` : ''})` : '';
          lines.push(`[${d.severity}] ${d.path}${loc}: ${d.message}`);
        }
        await appendFile(logFile, lines.join('\n') + '\n', 'utf-8');
      }
    } catch { /* file may not exist on clean builds */ }

    const updated: BuildJobState = {
      ...state,
      status: succeeded ? 'succeeded' : 'failed',
      exitCode,
      endTime: new Date().toISOString(),
    };
    await writeBuildState(updated).catch(() => {});
    await buildLog(succeeded ? 'INFO' : 'ERROR', `xppc.exe finished — PID: ${child.pid} | exit: ${exitCode}`);
  });

  child.on('error', async (err) => {
    closeSyncFs(logFd);
    const updated: BuildJobState = { ...state, status: 'failed', exitCode: -1, endTime: new Date().toISOString() };
    await writeBuildState(updated).catch(() => {});
    await buildLog('ERROR', `xppc.exe error — PID: ${child.pid}: ${err.message}`);
  });

  return state;
}

// ---------------------------------------------------------------------------
// Kill orphaned build processes
// ---------------------------------------------------------------------------

async function killOrphanedBuildProcesses(): Promise<void> {
  await execFileAsync('taskkill', ['/F', '/IM', 'xppc.exe'], { timeout: 10_000, windowsHide: true })
    .then(({ stdout }) => console.error(`[build_d365fo_project] killed xppc.exe: ${stdout.trim() || '(no output)'}`))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const buildProjectToolDefinition = {
  name: 'build_d365fo_project',
  description: [
    'Builds a D365FO .rnrproj project using the X++ compiler (xppc.exe) and returns compiler errors.',
    'Because compilation can take several minutes, the build runs in the background.',
    'First call: starts the build and returns immediately.',
    'Subsequent calls on the same project: return current status + latest log output.',
    'Use force:true to kill a stuck build and restart.',
  ].join(' '),
  parameters: z.object({
    projectPath: z.string().optional().describe('Absolute path to the .rnrproj file. Auto-detected from .mcp.json if omitted.'),
    force: z.boolean().optional().describe('Kill any running build processes and restart.'),
  }),
};

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export const buildProjectTool = async (params: any, _context: any) => {
  const force = params.force === true;

  const configManager = getConfigManager();
  await configManager.ensureLoaded();

  const resolvedProjectPath: string = params.projectPath || await configManager.getProjectPath() || '';
  if (!resolvedProjectPath) {
    return { content: [{ type: 'text', text: '❌ Cannot determine project path.\n\nProvide projectPath parameter or set it in .mcp.json.' }], isError: true };
  }

  // ------------------------------------------------------------------
  // Check for an existing background build for this project
  // ------------------------------------------------------------------
  const existingState = await readBuildState(resolvedProjectPath);

  if (existingState && !force) {
    const alive = isProcessAlive(existingState.pid);
    const logTail = await readLogTail(existingState.logFile);

    if (existingState.status === 'running' && alive) {
      const elapsed = Math.round((Date.now() - new Date(existingState.startTime).getTime()) / 1000);
      return {
        content: [{
          type: 'text',
          text: `⏳ Build in progress (${existingState.tool} PID: ${existingState.pid}, running ${elapsed}s)\n\nProject: ${resolvedProjectPath}\n\nCall again to refresh status.\n\n--- Latest log ---\n${logTail}`,
        }],
      };
    }

    if (existingState.status === 'running' && !alive) {
      await clearBuildState(resolvedProjectPath);
      return {
        content: [{
          type: 'text',
          text: `❌ Build process (PID: ${existingState.pid}) exited unexpectedly without reporting a result.\n\nProject: ${resolvedProjectPath}\n\n--- Log ---\n${logTail}`,
        }],
        isError: true,
      };
    }

    // Build finished — return result and clear state
    await clearBuildState(resolvedProjectPath);
    const succeeded = existingState.status === 'succeeded';
    const hasErrors = !succeeded || /\b(error|Error)\s+(CS|AX|X\+\+|MSB)\d+|Build FAILED|\berror\s*:/i.test(logTail);
    const hasWarnings = !hasErrors && /\b(warning)\s+(CS|AX|X\+\+|MSB|BP)\d+|\bwarning\s*:/i.test(logTail);
    const statusIcon = hasErrors ? '❌ Build FAILED' : hasWarnings ? '⚠️ Build succeeded with warnings' : '✅ Build succeeded';
    const duration = existingState.endTime
      ? Math.round((new Date(existingState.endTime).getTime() - new Date(existingState.startTime).getTime()) / 1000)
      : '?';
    return {
      content: [{
        type: 'text',
        text: `${statusIcon} (${existingState.tool}, ${duration}s)\n\nProject: ${resolvedProjectPath}\n\n${logTail || '(no output)'}`,
      }],
      ...(hasErrors ? { isError: true } : {}),
    };
  }

  // ------------------------------------------------------------------
  // force=true: kill existing processes and clear state
  // ------------------------------------------------------------------
  if (force) {
    await buildLog('WARN', `force=true — killing orphaned build processes for: ${resolvedProjectPath}`);
    if (existingState?.pid) {
      try { process.kill(existingState.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    await killOrphanedBuildProcesses();
    await clearBuildState(resolvedProjectPath);
    await forceReleaseLock(`build:${resolvedProjectPath}`);
  }

  // ------------------------------------------------------------------
  // Resolve paths — supports both UDE and CHE environments
  //
  // UDE (Unified Developer Experience):
  //   - XPP config JSON present in %LOCALAPPDATA%\Microsoft\Dynamics365\XPPConfig\
  //   - customPackagesPath  = ModelStoreFolder  (git repo metadata, e.g. src\Metadata)
  //   - microsoftPackagesPath = FrameworkDirectory (AppData UDE packages)
  //
  // CHE (Cloud-Hosted Environment):
  //   - No XPP config; all packages in a single PackagesLocalDirectory
  //   - Both customPackagesPath and microsoftPackagesPath = PackagesLocalDirectory
  //   - Typical locations: C:\AOSService\PackagesLocalDirectory or K:\, J:\, I:\
  // ------------------------------------------------------------------
  let customPackagesPath: string | null = null;
  let microsoftPackagesPath: string | null = null;

  // Priority 1: XPP config (UDE)
  try {
    const xppConfig = await (configManager as any).getActiveXppConfig?.();
    if (xppConfig) {
      customPackagesPath = xppConfig.customPackagesPath;
      microsoftPackagesPath = xppConfig.microsoftPackagesPath;
    }
  } catch { /* best-effort */ }

  // Priority 2: configManager methods (may cover either environment)
  if (!customPackagesPath) {
    try { customPackagesPath = await (configManager as any).getCustomPackagesPath?.() ?? null; } catch { /* */ }
  }
  if (!microsoftPackagesPath) {
    try { microsoftPackagesPath = await configManager.getMicrosoftPackagesPath?.() ?? null; } catch { /* */ }
  }
  if (!microsoftPackagesPath) {
    try { microsoftPackagesPath = configManager.getPackagePath() ?? null; } catch { /* */ }
  }

  // Priority 3: CHE fallback — probe well-known PackagesLocalDirectory locations
  if (!microsoftPackagesPath) {
    const cheCandidates = [
      'C:\\AOSService\\PackagesLocalDirectory',
      'K:\\AOSService\\PackagesLocalDirectory',
      'J:\\AOSService\\PackagesLocalDirectory',
      'I:\\AOSService\\PackagesLocalDirectory',
    ];
    for (const candidate of cheCandidates) {
      try { await access(candidate); microsoftPackagesPath = candidate; break; } catch { /* next */ }
    }
  }

  // In CHE, custom and Microsoft packages share the same PackagesLocalDirectory
  if (!customPackagesPath && microsoftPackagesPath) {
    customPackagesPath = microsoftPackagesPath;
  }

  if (!customPackagesPath || !microsoftPackagesPath) {
    return {
      content: [{
        type: 'text',
        text: [
          `❌ Cannot resolve D365FO package paths.`,
          ``,
          `Custom packages path:    ${customPackagesPath ?? '(not found)'}`,
          `Microsoft packages path: ${microsoftPackagesPath ?? '(not found)'}`,
          ``,
          `For UDE: ensure an XPP config is present at %LOCALAPPDATA%\\Microsoft\\Dynamics365\\XPPConfig\\`,
          `For CHE: ensure PackagesLocalDirectory exists at C:\\AOSService\\PackagesLocalDirectory (or K:\\, J:\\, I:\\)`,
        ].join('\n'),
      }],
      isError: true,
    };
  }

  // ------------------------------------------------------------------
  // Get model name from .rnrproj
  // ------------------------------------------------------------------
  const modelName = await getModelFromRnrproj(resolvedProjectPath);
  if (!modelName) {
    return {
      content: [{
        type: 'text',
        text: `❌ Cannot read model name from .rnrproj: ${resolvedProjectPath}`,
      }],
      isError: true,
    };
  }

  // ------------------------------------------------------------------
  // Find xppc.exe
  // ------------------------------------------------------------------
  const xppcExe = await findXppcExe(microsoftPackagesPath);
  if (!xppcExe) {
    return {
      content: [{
        type: 'text',
        text: `❌ Cannot find xppc.exe.\n\nLooked in: ${microsoftPackagesPath}\\bin\\xppc.exe\n\nEnsure the D365FO UDE tools are installed.`,
      }],
      isError: true,
    };
  }

  await buildLog('INFO', `Starting xppc.exe build — model: ${modelName} | project: ${resolvedProjectPath}`);
  await buildLog('INFO', `  xppc.exe:              ${xppcExe}`);
  await buildLog('INFO', `  customPackagesPath:    ${customPackagesPath}`);
  await buildLog('INFO', `  microsoftPackagesPath: ${microsoftPackagesPath}`);

  // ------------------------------------------------------------------
  // Launch xppc.exe in background
  // ------------------------------------------------------------------
  const jobState = await launchXppcBackground(
    xppcExe,
    resolvedProjectPath,
    modelName,
    customPackagesPath,
    microsoftPackagesPath,
  );

  return {
    content: [{
      type: 'text',
      text: [
        `🔨 Build started (xppc.exe PID: ${jobState.pid})`,
        ``,
        `Project: ${resolvedProjectPath}`,
        `Model:   ${modelName}`,
        `Log:     ${jobState.logFile}`,
        ``,
        `Call **build_d365fo_project** again (same project path) to check status and see output.`,
      ].join('\n'),
    }],
  };
};
