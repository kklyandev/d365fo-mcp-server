/**
 * Tests for get_edt_info tool
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getEdtInfoTool } from '../../src/tools/edtInfo.js';
import type { XppServerContext } from '../../src/types/context.js';
import { XppSymbolIndex } from '../../src/metadata/symbolIndex.js';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import Database from 'better-sqlite3';

describe('get_edt_info tool', () => {
  let context: XppServerContext;
  let tempDbPath: string;
  let tempEdtFile: string;

  beforeAll(async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edt-info-test-'));
    tempDbPath = path.join(tempDir, 'test.db');
    tempEdtFile = path.join(tempDir, 'TestEdt.xml');

    const edtXml = `<?xml version="1.0" encoding="utf-8"?>
<AxEdt xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="" i:type="AxEdtString">
\t<Name>TestEdt</Name>
\t<ConfigurationKey>WHSandTMS</ConfigurationKey>
\t<Extends>WHSEWShipmentOrderUpdateIdentifier</Extends>
\t<Label>@WarehouseOrdersIntegration:EWInboundShipmentOrderUpdate</Label>
\t<ReferenceTable>WHSEWInboundShipmentOrderUpdate</ReferenceTable>
\t<ArrayElements />
\t<Relations />
\t<TableReferences />
</AxEdt>`;

    await fs.writeFile(tempEdtFile, edtXml, 'utf-8');

    const db = new Database(tempDbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_name TEXT,
        signature TEXT,
        file_path TEXT NOT NULL,
        model TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        source_snippet TEXT,
        complexity INTEGER,
        used_types TEXT,
        method_calls TEXT,
        inline_comments TEXT,
        extends_class TEXT,
        implements_interfaces TEXT,
        usage_example TEXT,
        usage_frequency INTEGER DEFAULT 0,
        pattern_type TEXT,
        typical_usages TEXT,
        called_by_count INTEGER DEFAULT 0,
        related_methods TEXT,
        api_patterns TEXT
      );

      CREATE INDEX idx_symbols_name ON symbols(name);
      CREATE INDEX idx_symbols_type ON symbols(type);

      CREATE TABLE IF NOT EXISTS edt_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        edt_name TEXT NOT NULL,
        extends TEXT,
        enum_type TEXT,
        reference_table TEXT,
        relation_type TEXT,
        string_size TEXT,
        display_length TEXT,
        label TEXT,
        model TEXT NOT NULL
      );
    `);

    const insertSym = db.prepare(`
      INSERT INTO symbols (name, type, parent_name, file_path, model)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertSym.run('TestEdt', 'edt', null, tempEdtFile, 'TestModel');

    // DbOnlyEdt — no XML file, only edt_metadata row (simulates build-agent path)
    insertSym.run('AccountNum', 'edt', null, '/home/vsts/work/1/PackagesLocalDirectory/ApplicationPlatform/AxEdt/AccountNum.xml', 'ApplicationPlatform');

    const insertEdt = db.prepare(`
      INSERT INTO edt_metadata (edt_name, model, extends, enum_type, reference_table, relation_type, string_size, display_length, label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertEdt.run('TestEdt', 'TestModel', 'WHSEWShipmentOrderUpdateIdentifier', null, 'WHSEWInboundShipmentOrderUpdate', null, '60', null, '@WarehouseOrdersIntegration:EWInboundShipmentOrderUpdate');
    insertEdt.run('AccountNum', 'ApplicationPlatform', 'AccountNumBase', null, 'CustTable', 'ZeroOrMore', '30', '30', '@SYS1234');

    const symbolIndex = new XppSymbolIndex(tempDbPath);

    context = {
      symbolIndex,
      parser: {} as any,
      cache: undefined as any,
      workspaceScanner: {} as any,
      hybridSearch: {} as any,
      termRelationshipGraph: {} as any,
    };
  });

  it('should extract core EDT properties', async () => {
    const request = {
      method: 'tools/call',
      params: {
        name: 'get_edt_info',
        arguments: {
          edtName: 'TestEdt',
          modelName: 'TestModel',
        },
      },
    };

    const result = await getEdtInfoTool(request as any, context);

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    const text = result.content[0].text;

    expect(text).toContain('Extended Data Type: `TestEdt`');
    expect(text).toContain('**Model:** TestModel');
    expect(text).toContain('Base Type (Extends)');
    expect(text).toContain('WHSEWShipmentOrderUpdateIdentifier');
    expect(text).toContain('Reference Table');
    expect(text).toContain('WHSEWInboundShipmentOrderUpdate');
    expect(text).toContain('Configuration Key');
    expect(text).toContain('WHSandTMS');
  });

  it('should handle non-existent EDT', async () => {
    const request = {
      method: 'tools/call',
      params: {
        name: 'get_edt_info',
        arguments: {
          edtName: 'NonExistentEdt',
        },
      },
    };

    const result = await getEdtInfoTool(request as any, context);

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should fall back to edt_metadata DB data when XML file is inaccessible (build-agent path)', async () => {
    // AccountNum has a /home/vsts/... path that is NOT accessible — but edt_metadata has data
    const request = {
      method: 'tools/call',
      params: {
        name: 'get_edt_info',
        arguments: {
          edtName: 'AccountNum',
        },
      },
    };

    const result = await getEdtInfoTool(request as any, context);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text as string;

    // Core identity
    expect(text).toContain('Extended Data Type: `AccountNum`');
    expect(text).toContain('ApplicationPlatform');

    // Properties from edt_metadata DB row
    expect(text).toContain('AccountNumBase');      // extends
    expect(text).toContain('CustTable');            // reference_table
    expect(text).toContain('ZeroOrMore');           // relation_type
    expect(text).toContain('30');                   // string_size / display_length

    // Should include warning that data is from DB
    expect(text).toContain('⚠️');
  });
});
