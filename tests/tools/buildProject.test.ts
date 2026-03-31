import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- hoisted mocks -----------------------------------------------------------
const { execFilePromisified, execFileMock, accessMock } = vi.hoisted(() => {
  const execFilePromisified = vi.fn();
  const execFileMock: any = vi.fn();
  execFileMock[Symbol.for('nodejs.util.promisify.custom')] = (
    file: string,
    args: string[],
    opts: any,
  ) => execFilePromisified(file, args, opts);
  const accessMock = vi.fn();
  return { execFilePromisified, execFileMock, accessMock };
});

vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('fs/promises', () => ({ access: accessMock }));
vi.mock('../../src/utils/configManager.js', () => ({
  getConfigManager: () => ({
    ensureLoaded: vi.fn(),
    getProjectPath: vi.fn().mockResolvedValue('C:\\MyProject\\MyProject.rnrproj'),
  }),
}));
vi.mock('../../src/utils/operationLocks.js', () => ({
  withOperationLock: (_key: string, fn: () => any) => fn(),
}));

import { buildProjectTool } from '../../src/tools/buildProject';

// --- helpers -----------------------------------------------------------------
const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const VS_INSTALL = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise';
const VSDEVCMD = `${VS_INSTALL}\\Common7\\Tools\\VsDevCmd.bat`;
const MSBUILD = `${VS_INSTALL}\\MSBuild\\Current\\Bin\\MSBuild.exe`;

/** Make `access()` succeed only for the listed paths. */
function allowPaths(paths: string[]) {
  accessMock.mockImplementation(async (p: string) => {
    if (paths.includes(p)) return;
    throw new Error(`ENOENT: ${p}`);
  });
}

/** Simulate vswhere returning the given install path. */
function setupVswhere(installPath: string) {
  execFilePromisified.mockImplementation(
    async (file: string, args: string[], _opts: any) => {
      if (file === VSWHERE) {
        return { stdout: `${installPath}\r\n`, stderr: '' };
      }
      // MSBuild invocation — succeed with empty output
      return { stdout: '', stderr: '' };
    },
  );
}

describe('build_d365fo_project', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes windowsVerbatimArguments when invoking cmd.exe with VsDevCmd', async () => {
    allowPaths([VSWHERE, MSBUILD, VSDEVCMD]);
    setupVswhere(VS_INSTALL);

    await buildProjectTool({}, {});

    // The *second* execFile call (first is vswhere) should be cmd.exe with VsDevCmd
    const cmdCall = execFilePromisified.mock.calls.find(
      (c: any[]) => c[0] === 'cmd.exe',
    );
    expect(cmdCall).toBeDefined();

    const [file, args, opts] = cmdCall!;
    expect(file).toBe('cmd.exe');
    expect(args[0]).toBe('/C');
    // The command must contain the correctly quoted VsDevCmd path
    expect(args[1]).toContain(`"${VSDEVCMD}"`);
    // Critical: windowsVerbatimArguments must be true to prevent Node
    // from double-quoting the /C payload (fixes #400)
    expect(opts.windowsVerbatimArguments).toBe(true);
  });

  it('does not use windowsVerbatimArguments when running MSBuild directly (no VsDevCmd)', async () => {
    // vswhere returns an install path where VsDevCmd does NOT exist
    allowPaths([VSWHERE, MSBUILD]);
    setupVswhere(VS_INSTALL);

    await buildProjectTool({}, {});

    const msbuildCall = execFilePromisified.mock.calls.find(
      (c: any[]) => c[0] === MSBUILD,
    );
    expect(msbuildCall).toBeDefined();

    const [, , opts] = msbuildCall!;
    // No windowsVerbatimArguments needed — execFile quotes each arg correctly
    expect(opts?.windowsVerbatimArguments).toBeFalsy();
  });

  it('builds correct cmd.exe /C command with spaces in VS path', async () => {
    const spaceInstall = 'C:\\Program Files\\Microsoft Visual Studio\\2026\\Preview';
    const spaceDevCmd = `${spaceInstall}\\Common7\\Tools\\VsDevCmd.bat`;
    const spaceMsbuild = `${spaceInstall}\\MSBuild\\Current\\Bin\\MSBuild.exe`;

    allowPaths([VSWHERE, spaceMsbuild, spaceDevCmd]);
    setupVswhere(spaceInstall);

    await buildProjectTool({}, {});

    const cmdCall = execFilePromisified.mock.calls.find(
      (c: any[]) => c[0] === 'cmd.exe',
    );
    expect(cmdCall).toBeDefined();
    const fullCmd: string = cmdCall![1][1];

    // Verify the full command has properly quoted paths
    expect(fullCmd).toMatch(/^call ".*VsDevCmd\.bat" && ".*MSBuild\.exe"/);
    // The path with spaces should be intact inside quotes
    expect(fullCmd).toContain(`"${spaceDevCmd}"`);
    expect(fullCmd).toContain(`"${spaceMsbuild}"`);
  });

  it('falls back to hardcoded candidates when vswhere is unavailable', async () => {
    const hardcodedMsbuild =
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe';
    const hardcodedDevCmd =
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\Tools\\VsDevCmd.bat';

    // vswhere NOT available; hardcoded paths exist
    allowPaths([hardcodedMsbuild, hardcodedDevCmd]);
    execFilePromisified.mockResolvedValue({ stdout: '', stderr: '' });

    await buildProjectTool({}, {});

    const cmdCall = execFilePromisified.mock.calls.find(
      (c: any[]) => c[0] === 'cmd.exe',
    );
    expect(cmdCall).toBeDefined();
    expect(cmdCall![2].windowsVerbatimArguments).toBe(true);
    expect(cmdCall![1][1]).toContain(`"${hardcodedDevCmd}"`);
  });
});
