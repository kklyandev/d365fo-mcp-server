/**
 * Object Info Tools Tests
 * Covers: get_class_info, get_table_info, get_method_signature,
 *         get_form_info, get_query_info, get_view_info,
 *         get_enum_info, get_edt_info, get_report_info
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classInfoTool } from '../../src/tools/classInfo';
import { tableInfoTool } from '../../src/tools/tableInfo';
import { getMethodSignatureTool } from '../../src/tools/methodSignature';
import { getFormInfoTool } from '../../src/tools/formInfo';
import { getQueryInfoTool } from '../../src/tools/queryInfo';
import { getViewInfoTool } from '../../src/tools/viewInfo';
import { getEnumInfoTool } from '../../src/tools/enumInfo';
import { getEdtInfoTool } from '../../src/tools/edtInfo';
import { getReportInfoTool } from '../../src/tools/reportInfo';
import type { XppServerContext } from '../../src/types/context';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';

// Prevent disk access in tools that call findD365FileOnDisk
vi.mock('../../src/tools/modifyD365File', async (orig) => {
  const actual = await orig<typeof import('../../src/tools/modifyD365File')>();
  return { ...actual, findD365FileOnDisk: vi.fn(async () => null) };
});

// Mock metadataResolver so enum/edt/view tools can return data without disk access
vi.mock('../../src/utils/metadataResolver', async (orig) => {
  const actual = await orig<typeof import('../../src/utils/metadataResolver')>();
  return {
    ...actual,
    buildXmlNotAvailableMessage: vi.fn((type: string, name: string) => `XML not available for ${type} "${name}"`),
    buildObjectTypeMismatchMessage: vi.fn(() => ''),
    readEnumRawXml: vi.fn(async () =>
      `<?xml version="1.0"?><AxEnum><Name>SalesStatus</Name><EnumValues><AxEnumValue><Name>None</Name><Value>0</Value><Label>@SYS0</Label></AxEnumValue><AxEnumValue><Name>Invoiced</Name><Value>3</Value><Label>@SYS3</Label></AxEnumValue></EnumValues><Label>Sales status</Label></AxEnum>`,
    ),
    readEdtRawXml: vi.fn(async () =>
      `<?xml version="1.0"?><AxEdt><Name>CustAccount</Name><Label>Customer account</Label><StringSize>20</StringSize><Extends>AccountNum</Extends></AxEdt>`,
    ),
    readViewMetadata: vi.fn(async () => null),
  };
});

// Mock configManager for reportInfo which reads it directly
vi.mock('../../src/utils/configManager', () => ({
  getConfigManager: vi.fn(() => ({
    ensureLoaded: vi.fn(async () => {}),
    getPackagePath: vi.fn(() => 'K:\\PackagesLocalDirectory'),
    getModelName: vi.fn(() => 'MyModel'),
    getPackageNameFromWorkspacePath: vi.fn(() => 'MyPackage'),
    getProjectPath: vi.fn(async () => null),
    getDevEnvironmentType: vi.fn(async () => 'traditional'),
    getCustomPackagesPath: vi.fn(async () => null),
    getMicrosoftPackagesPath: vi.fn(async () => null),
  })),
}));

// Mock fs so tools that read XML don't hit real disk
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(async (p: string) => {
        const ps = String(p);
        if (ps.includes('SalesTable') && ps.includes('Form'))
          return `<?xml version="1.0"?><AxForm><Name>SalesTable</Name><DataSources><AxFormDataSource><Name>SalesTable</Name><Table>SalesTable</Table></AxFormDataSource></DataSources><Methods /></AxForm>`;
        if (ps.includes('SalesTableListPage') || ps.includes('Query'))
          return `<?xml version="1.0"?><AxQuery><Name>SalesTableListPage</Name><DataSources><AxQuerySimpleRootObject><Name>SalesTable</Name><Table>SalesTable</Table></AxQuerySimpleRootObject></DataSources></AxQuery>`;
        if (ps.includes('SalesOrderView') || ps.includes('View'))
          return `<?xml version="1.0"?><AxView><Name>SalesOrderView</Name><Fields /><DataSources /></AxView>`;
        if (ps.includes('SalesInvoice') || ps.includes('rdl') || ps.includes('Report'))
          return `<?xml version="1.0"?><Report><Body><ReportItems /></Body></Report>`;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async () => []),
      access: vi.fn(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
    },
  };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const req = (name: string, args: Record<string, unknown> = {}): CallToolRequest => ({
  method: 'tools/call',
  params: { name, arguments: args },
});

const makeSymbol = (overrides: Partial<any> = {}) => ({
  id: 1, name: 'CustTable', type: 'table' as const,
  parentName: undefined, signature: undefined,
  filePath: '/Tables/CustTable.xml', model: 'ApplicationSuite',
  ...overrides,
});

const makeStmt = (rows: any[] = [], row: any = undefined) => ({
  all: vi.fn(() => rows),
  get: vi.fn(() => row),
  run: vi.fn(() => ({ changes: 0 })),
});

const buildContext = (overrides: Partial<XppServerContext> = {}): XppServerContext => ({
  symbolIndex: {
    searchSymbols: vi.fn(() => []),
    getSymbolByName: vi.fn(() => undefined),
    getClassMethods: vi.fn(() => []),
    getTableFields: vi.fn(() => []),
    searchLabels: vi.fn(() => []),
    getCustomModels: vi.fn(() => []),
    db: { prepare: vi.fn(() => makeStmt()) },
  } as any,
  parser: {
    parseClassFile: vi.fn(async () => ({ success: false })),
    parseTableFile: vi.fn(async () => ({ success: false })),
    parseFormFile: vi.fn(async () => ({ success: false })),
    parseQueryFile: vi.fn(async () => ({ success: false })),
    parseViewFile: vi.fn(async () => ({ success: false })),
    parseEnumFile: vi.fn(async () => ({ success: false })),
    parseEdtFile: vi.fn(async () => ({ success: false })),
    parseReportFile: vi.fn(async () => ({ success: false })),
  } as any,
  cache: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    setClassInfo: vi.fn(async () => {}),
    generateSearchKey: vi.fn((q: string) => `k:${q}`),
    generateClassKey: vi.fn((n: string) => `c:${n}`),
    generateTableKey: vi.fn((n: string) => `t:${n}`),
  } as any,
  workspaceScanner: {} as any,
  hybridSearch: {} as any,
  termRelationshipGraph: {} as any,
  ...overrides,
});

// ─── get_class_info ──────────────────────────────────────────────────────────

describe('get_class_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns class info when symbol exists', async () => {
    (ctx.symbolIndex.getSymbolByName as any).mockReturnValue(
      makeSymbol({ name: 'SalesFormLetter', type: 'class', filePath: '/Classes/SalesFormLetter.xml', model: 'ApplicationSuite' }),
    );
    (ctx.symbolIndex.getClassMethods as any).mockReturnValue([
      makeSymbol({ id: 2, name: 'run', type: 'method', parentName: 'SalesFormLetter', signature: 'public void run()' }),
    ]);

    const result = await classInfoTool(req('get_class_info', { className: 'SalesFormLetter' }), ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('SalesFormLetter');
  });

  it('falls back gracefully when file parse fails', async () => {
    (ctx.symbolIndex.getSymbolByName as any).mockReturnValue(
      makeSymbol({ name: 'MyClass', type: 'class' }),
    );
    (ctx.symbolIndex.getClassMethods as any).mockReturnValue([]);

    const result = await classInfoTool(req('get_class_info', { className: 'MyClass' }), ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('MyClass');
  });

  it('returns not-found message for unknown class', async () => {
    (ctx.symbolIndex.getSymbolByName as any).mockReturnValue(undefined);
    const result = await classInfoTool(req('get_class_info', { className: 'NoSuchClass' }), ctx);
    expect(result.content[0].text).toMatch(/not found|no.*class/i);
  });

  it('returns error when className is missing', async () => {
    const result = await classInfoTool(req('get_class_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_table_info ──────────────────────────────────────────────────────────

describe('get_table_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns table fields and relations on success', async () => {
    (ctx.symbolIndex.getSymbolByName as any).mockReturnValue(
      makeSymbol({ name: 'SalesLine', type: 'table', filePath: '/Tables/SalesLine.xml' }),
    );
    (ctx.symbolIndex.getTableFields as any).mockReturnValue([
      makeSymbol({ id: 2, name: 'ItemId', type: 'field', parentName: 'SalesLine', signature: 'str ItemId' }),
    ]);
    (ctx.parser.parseTableFile as any).mockResolvedValue({
      success: true,
      data: {
        name: 'SalesLine', model: 'ApplicationSuite', sourcePath: '/Tables/SalesLine.xml',
        fields: [{ name: 'ItemId', type: 'String', extendedDataType: 'ItemId', mandatory: false }],
        indexes: [{ name: 'SalesIdx', fields: ['SalesId', 'LineNum'], unique: true }],
        relations: [{ name: 'SalesTable', relatedTable: 'SalesTable', role: 'SalesLine', type: 'inner', constraints: [] }],
        label: 'Sales line', tableGroup: 'Transaction', methods: [],
      },
    });

    const result = await tableInfoTool(req('get_table_info', { tableName: 'SalesLine' }), ctx);

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('SalesLine');
    expect(text).toContain('ItemId');
  });

  it('returns not-found for unknown table', async () => {
    (ctx.symbolIndex.getSymbolByName as any).mockReturnValue(undefined);
    const result = await tableInfoTool(req('get_table_info', { tableName: 'GhostTable' }), ctx);
    expect(result.content[0].text).toMatch(/not found|no.*table/i);
  });

  it('returns error when tableName is missing', async () => {
    const result = await tableInfoTool(req('get_table_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_method_signature ────────────────────────────────────────────────────

describe('get_method_signature', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns exact method signature from index', async () => {
    // methodSignature uses db.prepare().get() to find class, then method
    const classRow = { file_path: '/Classes/CustTable.xml', model: 'ApplicationSuite', name: 'CustTable' };
    const methodRow = { name: 'validateWrite', signature: 'public boolean validateWrite()', parent_name: 'CustTable', file_path: '/Classes/CustTable.xml' };
    const stmt = {
      get: vi.fn()
        .mockReturnValueOnce(classRow)   // class lookup
        .mockReturnValueOnce(methodRow), // method lookup
      all: vi.fn(() => []),
      run: vi.fn(),
    };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getMethodSignatureTool(
      req('get_method_signature', { className: 'CustTable', methodName: 'validateWrite' }),
      ctx,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('validateWrite');
  });

  it('returns not-found for missing method', async () => {
    const stmt = { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getMethodSignatureTool(
      req('get_method_signature', { className: 'CustTable', methodName: 'noSuchMethod' }),
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|no.*class|could not/i);
  });

  it('returns error when required fields are absent', async () => {
    const result = await getMethodSignatureTool(req('get_method_signature', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_form_info ───────────────────────────────────────────────────────────

describe('get_form_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns form info on success', async () => {
    const formRow = { file_path: '/Forms/SalesTable.xml', model: 'ApplicationSuite', name: 'SalesTable' };
    const stmt = { get: vi.fn(() => formRow), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getFormInfoTool(req('get_form_info', { formName: 'SalesTable' }), ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('SalesTable');
  });

  it('returns not-found for unknown form', async () => {
    const stmt = { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getFormInfoTool(req('get_form_info', { formName: 'NoForm' }), ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|no.*form/i);
  });

  it('returns error when formName is missing', async () => {
    const result = await getFormInfoTool(req('get_form_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_query_info ──────────────────────────────────────────────────────────

describe('get_query_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns query info on success', async () => {
    const queryRow = { file_path: '/Queries/SalesTableListPage.xml', model: 'ApplicationSuite', name: 'SalesTableListPage' };
    const stmt = { get: vi.fn(() => queryRow), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getQueryInfoTool(req('get_query_info', { queryName: 'SalesTableListPage' }), ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('SalesTableListPage');
  });

  it('returns not-found for unknown query', async () => {
    const stmt = { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getQueryInfoTool(req('get_query_info', { queryName: 'NoQuery' }), ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|no.*query/i);
  });

  it('returns error when queryName is missing', async () => {
    const result = await getQueryInfoTool(req('get_query_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_view_info ───────────────────────────────────────────────────────────

describe('get_view_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns view info on success', async () => {
    const viewRow = { file_path: '/Views/SalesOrderView.xml', model: 'ApplicationSuite', name: 'SalesOrderView' };
    const stmt = { get: vi.fn(() => viewRow), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getViewInfoTool(req('get_view_info', { viewName: 'SalesOrderView' }), ctx);
    // readViewMetadata returns null (mocked), so falls back to XML read path
    expect(result.content[0].text).toContain('SalesOrderView');
  });

  it('returns not-found for unknown view', async () => {
    const stmt = { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getViewInfoTool(req('get_view_info', { viewName: 'NoView' }), ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|no.*view/i);
  });

  it('returns error when viewName is missing', async () => {
    const result = await getViewInfoTool(req('get_view_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_enum_info ───────────────────────────────────────────────────────────

describe('get_enum_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns enum values on success', async () => {
    const enumRow = { file_path: '/Enums/SalesStatus.xml', model: 'ApplicationSuite', name: 'SalesStatus' };
    const stmt = { get: vi.fn(() => enumRow), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getEnumInfoTool(req('get_enum_info', { enumName: 'SalesStatus' }), ctx);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('SalesStatus');
    expect(text).toContain('Invoiced');
  });

  it('returns not-found for unknown enum', async () => {
    const stmt = { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getEnumInfoTool(req('get_enum_info', { enumName: 'NoEnum' }), ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|no.*enum/i);
  });

  it('returns error when enumName is missing', async () => {
    const result = await getEnumInfoTool(req('get_enum_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_edt_info ────────────────────────────────────────────────────────────

describe('get_edt_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns EDT properties on success', async () => {
    const edtRow = { file_path: '/DataTypes/CustAccount.xml', model: 'ApplicationSuite', name: 'CustAccount' };
    const stmt = { get: vi.fn(() => edtRow), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getEdtInfoTool(req('get_edt_info', { edtName: 'CustAccount' }), ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('CustAccount');
  });

  it('returns not-found for unknown EDT', async () => {
    const stmt = { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    ctx.symbolIndex.db.prepare = vi.fn(() => stmt) as any;

    const result = await getEdtInfoTool(req('get_edt_info', { edtName: 'NoEdt' }), ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|no.*edt|no.*extended/i);
  });

  it('returns error when edtName is missing', async () => {
    const result = await getEdtInfoTool(req('get_edt_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});

// ─── get_report_info ─────────────────────────────────────────────────────────

describe('get_report_info', () => {
  let ctx: XppServerContext;

  beforeEach(() => { ctx = buildContext(); });

  it('returns not-found when report is not on disk', async () => {
    // fs.access throws ENOENT (mocked above), so report won't be found
    const result = await getReportInfoTool(req('get_report_info', { reportName: 'SalesInvoice' }), ctx);
    // Tool returns isError: true when report not found on disk
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|could not/i);
  });

  it('returns not-found for unknown report', async () => {
    const result = await getReportInfoTool(req('get_report_info', { reportName: 'NoReport' }), ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/i);
  });

  it('returns error when reportName is missing', async () => {
    const result = await getReportInfoTool(req('get_report_info', {}), ctx);
    expect(result.isError).toBe(true);
  });
});
