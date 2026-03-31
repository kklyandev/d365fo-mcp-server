import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- hoisted mocks -----------------------------------------------------------
const { execFilePromisified, execFileMock, accessMock, writeFileMock, unlinkMock, readFileMock, readdirMock } = vi.hoisted(() => {
  const execFilePromisified = vi.fn();
  const execFileMock: any = vi.fn();
  execFileMock[Symbol.for('nodejs.util.promisify.custom')] = (
    file: string,
    args: string[],
    opts: any,
  ) => execFilePromisified(file, args, opts);
  const accessMock = vi.fn();
  const writeFileMock = vi.fn().mockResolvedValue(undefined);
  const unlinkMock = vi.fn().mockResolvedValue(undefined);
  const readFileMock = vi.fn().mockRejectedValue(new Error('ENOENT'));
  const readdirMock = vi.fn().mockRejectedValue(new Error('ENOENT'));
  return { execFilePromisified, execFileMock, accessMock, writeFileMock, unlinkMock, readFileMock, readdirMock };
});

vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('fs/promises', () => ({
  access: accessMock,
  writeFile: writeFileMock,
  unlink: unlinkMock,
  readFile: readFileMock,
  readdir: readdirMock,
}));
vi.mock('../../src/utils/configManager.js', () => ({
  getConfigManager: () => ({
    ensureLoaded: vi.fn(),
    getProjectPath: vi.fn().mockResolvedValue('C:\\MyProject\\MyProject.rnrproj'),
    getPackagePath: vi.fn().mockReturnValue(null),
  }),
}));
vi.mock('../../src/utils/operationLocks.js', () => ({
  withOperationLock: (_key: string, fn: () => any) => fn(),
}));

import path from 'path';
import { buildProjectTool } from '../../src/tools/buildProject';

// --- helpers -----------------------------------------------------------------
// Use path.join so the separators match what the production code produces
// (backslash on Windows, forward slash on Linux CI).
const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const VS_INSTALL = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise';
const VSDEVCMD = path.join(VS_INSTALL, 'Common7', 'Tools', 'VsDevCmd.bat');
const MSBUILD = path.join(VS_INSTALL, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');

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
    async (file: string, _args: string[], _opts: any) => {
      if (file === VSWHERE) {
        return { stdout: `${installPath}\r\n`, stderr: '' };
      }
      // cmd.exe or MSBuild invocation - succeed with empty output
      return { stdout: '', stderr: '' };
    },
  );
}

describe('build_d365fo_project', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
  });

  it('writes a temp batch file with VsDevCmd and MSBuild on separate lines', async () => {
    allowPaths([VSWHERE, MSBUILD, VSDEVCMD]);
    setupVswhere(VS_INSTALL);

    await buildProjectTool({}, {});

    // A temp .cmd file should have been written
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [tempPath, batContent] = writeFileMock.mock.calls[0];
    expect(tempPath).toMatch(/d365build_[0-9a-f]+\.cmd$/);

    // The batch content must have VsDevCmd and MSBuild on separate lines
    expect(batContent).toContain('@echo off');
    expect(batContent).toContain(`call "${VSDEVCMD}"`);
    expect(batContent).toContain(`"${MSBUILD}"`);
    // VsDevCmd and MSBuild must NOT be on the same line (no && chaining)
    expect(batContent).not.toContain('&&');

    // cmd.exe should be invoked with just the temp file path - no embedded quotes
    const cmdCall = execFilePromisified.mock.calls.find(
      (c: any[]) => c[0] === 'cmd.exe',
    );
    expect(cmdCall).toBeDefined();
    expect(cmdCall![1]).toEqual(['/C', tempPath]);
  });

  it('cleans up the temp batch file after build', async () => {
    allowPaths([VSWHERE, MSBUILD, VSDEVCMD]);
    setupVswhere(VS_INSTALL);

    await buildProjectTool({}, {});

    expect(unlinkMock).toHaveBeenCalledTimes(1);
    const tempPath = writeFileMock.mock.calls[0][0];
    expect(unlinkMock).toHaveBeenCalledWith(tempPath);
  });

  it('cleans up the temp file even when build fails', async () => {
    allowPaths([VSWHERE, MSBUILD, VSDEVCMD]);
    // vswhere succeeds, but cmd.exe fails
    execFilePromisified.mockImplementation(
      async (file: string, _args: string[], _opts: any) => {
        if (file === VSWHERE) {
          return { stdout: `${VS_INSTALL}\r\n`, stderr: '' };
        }
        const err: any = new Error('Build failed');
        err.stdout = 'error CS0001: something broke';
        err.stderr = '';
        throw err;
      },
    );

    await buildProjectTool({}, {});

    // Temp file must still be cleaned up despite the error
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('does not create temp batch file when running MSBuild directly (no VsDevCmd)', async () => {
    // vswhere returns an install path where VsDevCmd does NOT exist
    allowPaths([VSWHERE, MSBUILD]);
    setupVswhere(VS_INSTALL);

    await buildProjectTool({}, {});

    // No temp file should be written
    expect(writeFileMock).not.toHaveBeenCalled();

    const msbuildCall = execFilePromisified.mock.calls.find(
      (c: any[]) => c[0] === MSBUILD,
    );
    expect(msbuildCall).toBeDefined();
  });

  it('handles VS paths with spaces correctly in temp batch file', async () => {
    const spaceInstall = 'C:\\Program Files\\Microsoft Visual Studio\\2026\\Preview';
    const spaceDevCmd = path.join(spaceInstall, 'Common7', 'Tools', 'VsDevCmd.bat');
    const spaceMsbuild = path.join(spaceInstall, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');

    allowPaths([VSWHERE, spaceMsbuild, spaceDevCmd]);
    setupVswhere(spaceInstall);

    await buildProjectTool({}, {});

    const [, batContent] = writeFileMock.mock.calls[0];
    // Paths with spaces must be properly quoted inside the batch file
    expect(batContent).toContain(`call "${spaceDevCmd}"`);
    expect(batContent).toContain(`"${spaceMsbuild}"`);
  });

  it('falls back to hardcoded candidates when vswhere is unavailable', async () => {
    // These must match the hardcoded candidate strings in buildProject.ts exactly
    const hardcodedMsbuild =
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe';
    const hardcodedDevCmd =
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\Tools\\VsDevCmd.bat';

    // vswhere NOT available; hardcoded paths exist
    allowPaths([hardcodedMsbuild, hardcodedDevCmd]);
    execFilePromisified.mockResolvedValue({ stdout: '', stderr: '' });

    await buildProjectTool({}, {});

    // Should still use temp batch file approach
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, batContent] = writeFileMock.mock.calls[0];
    expect(batContent).toContain(`call "${hardcodedDevCmd}"`);
    expect(batContent).toContain(`"${hardcodedMsbuild}"`);
  });

  it('sets PackagesFolder env vars and generates task override targets when packages path exists', async () => {
    const PKG_PATH = 'C:\\AOSService\\PackagesLocalDirectory';
    const BUILD_DLL = path.join(PKG_PATH, 'bin', 'Microsoft.Dynamics.Framework.Tools.BuildTasks.17.0.dll');
    const DYNAMICS_AX_DIR = path.join(PKG_PATH, 'Dynamics', 'AX');

    allowPaths([VSWHERE, MSBUILD, VSDEVCMD, PKG_PATH, BUILD_DLL, DYNAMICS_AX_DIR]);
    setupVswhere(VS_INSTALL);

    // Simulate Dynamics\AX directory with a .targets file that has UsingTask
    readdirMock.mockResolvedValue([
      'Microsoft.Dynamics.Framework.Tools.BuildTasks.17.0.targets',
      'SomeOther.targets',
    ]);
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.includes('BuildTasks.17.0.targets')) {
        return '<Project>\n<UsingTask TaskName="CopyReferencesTask" AssemblyName="Microsoft.Dynamics.Framework.Tools.BuildTasks.17.0" />\n</Project>';
      }
      return '<Project />';
    });

    await buildProjectTool({}, {});

    // Find the .cmd file write (batch file) — should contain D365FO env vars
    const cmdWrite = writeFileMock.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('d365build_'),
    );
    expect(cmdWrite).toBeDefined();
    const batContent = cmdWrite![1] as string;
    expect(batContent).toContain(`set "PackagesFolder=${PKG_PATH}"`);
    expect(batContent).toContain(`set "MetadataDir=${PKG_PATH}"`);
    expect(batContent).toContain(`set "PATH=%PATH%;${PKG_PATH}\\bin"`);

    // Find the .targets file write (task override)
    const targetsWrite = writeFileMock.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('d365tasks_'),
    );
    expect(targetsWrite).toBeDefined();
    const targetsContent = targetsWrite![1] as string;
    expect(targetsContent).toContain('CopyReferencesTask');
    expect(targetsContent).toContain(`AssemblyFile="${BUILD_DLL}"`);

    // MSBuild args should include PackagesFolder and ForceImport
    const cmdCall = execFilePromisified.mock.calls.find(
      (c: any[]) => c[0] === 'cmd.exe',
    );
    expect(cmdCall).toBeDefined();
  });

  it('cleans up both temp files (batch + targets override) after build', async () => {
    const PKG_PATH = 'C:\\AOSService\\PackagesLocalDirectory';
    const BUILD_DLL = path.join(PKG_PATH, 'bin', 'Microsoft.Dynamics.Framework.Tools.BuildTasks.17.0.dll');
    const DYNAMICS_AX_DIR = path.join(PKG_PATH, 'Dynamics', 'AX');

    allowPaths([VSWHERE, MSBUILD, VSDEVCMD, PKG_PATH, BUILD_DLL, DYNAMICS_AX_DIR]);
    setupVswhere(VS_INSTALL);
    readdirMock.mockResolvedValue(['BuildTasks.targets']);
    readFileMock.mockResolvedValue('<Project><UsingTask TaskName="CopyReferencesTask" AssemblyName="BuildTasks" /></Project>');

    await buildProjectTool({}, {});

    // Both temp files should be cleaned up
    expect(unlinkMock).toHaveBeenCalledTimes(2);
    const unlinkPaths = unlinkMock.mock.calls.map((c: any[]) => c[0] as string);
    expect(unlinkPaths.some((p: string) => p.includes('d365build_'))).toBe(true);
    expect(unlinkPaths.some((p: string) => p.includes('d365tasks_'))).toBe(true);
  });
});
