/**
 * Tests for codeGen tool — MS D365FO naming guidelines compliance
 * https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/extensibility/naming-guidelines-extensions
 *
 * Rules:
 *  - New objects       : {Prefix}{Name}               e.g. WHSMyTable
 *  - table-extension   : {BaseTable}{Prefix}_Extension e.g. CustTableWHS_Extension
 *  - form-handler      : {BaseForm}{Prefix}Form_Extension e.g. SalesTableWHSForm_Extension
 *  - Bare _Extension   : FORBIDDEN (MS guideline violation)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { codeGenTool } from '../../src/tools/codeGen';

const makeRequest = (args: Record<string, unknown>): CallToolRequest =>
  ({
    method: 'tools/call',
    params: { name: 'generate_code', arguments: args },
  }) as CallToolRequest;

describe('codeGen tool', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EXTENSION_PREFIX;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ─────────────────────────────────────────────────────────────
  // NEW element patterns (class, runnable, data-entity, batch-job)
  // ─────────────────────────────────────────────────────────────

  describe('pattern: class', () => {
    it('should prefix the class name with EXTENSION_PREFIX', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'MyHelper' }));
      const text = result.content[0].text as string;
      expect(text).toContain('WHSMyHelper');
      expect(text).not.toContain('public class MyHelper');
    });

    it('should prefix from modelName when EXTENSION_PREFIX not set', async () => {
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'MyHelper', modelName: 'AslCore' }));
      const text = result.content[0].text as string;
      expect(text).toContain('AslCoreMyHelper');
    });

    it('should NOT double-prefix when name already starts with prefix', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'WHSMyHelper' }));
      const text = result.content[0].text as string;
      expect(text).toContain('WHSMyHelper');
      expect(text).not.toContain('WHSWHSMyHelper');
    });

    it('should warn when no prefix is available', async () => {
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'MyHelper' }));
      const text = result.content[0].text as string;
      expect(text).toContain('No prefix');
    });

    it('should generate valid X++ class template', async () => {
      process.env.EXTENSION_PREFIX = 'ASL';
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'OrderHelper' }));
      const text = result.content[0].text as string;
      expect(text).toContain('public class ASLOrderHelper');
      expect(text).toContain('```xpp');
    });
  });

  describe('pattern: runnable', () => {
    it('should prefix the runnable class with EXTENSION_PREFIX', async () => {
      process.env.EXTENSION_PREFIX = 'ASL';
      const result = await codeGenTool(makeRequest({ pattern: 'runnable', name: 'FixCustomers' }));
      const text = result.content[0].text as string;
      expect(text).toContain('ASLFixCustomers');
    });

    it('should fall back to modelName for prefix', async () => {
      const result = await codeGenTool(makeRequest({ pattern: 'runnable', name: 'FixCustomers', modelName: 'Con' }));
      const text = result.content[0].text as string;
      expect(text).toContain('ConFixCustomers');
    });
  });

  describe('pattern: batch-job', () => {
    it('should prefix the batch-job class with EXTENSION_PREFIX', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'batch-job', name: 'ProcessOrders' }));
      const text = result.content[0].text as string;
      expect(text).toContain('WHSProcessOrders');
    });

    it('should generate Controller and Service classes', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'batch-job', name: 'ProcessOrders' }));
      const text = result.content[0].text as string;
      expect(text).toContain('WHSProcessOrdersController');
      expect(text).toContain('WHSProcessOrdersService');
    });
  });

  describe('pattern: data-entity', () => {
    it('should prefix data entity class', async () => {
      process.env.EXTENSION_PREFIX = 'Con';
      const result = await codeGenTool(makeRequest({ pattern: 'data-entity', name: 'SalesOrder' }));
      const text = result.content[0].text as string;
      expect(text).toContain('ConSalesOrder');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // EXTENSION patterns — MS naming: {Base}{Prefix}_Extension / Form_Extension
  // ─────────────────────────────────────────────────────────────

  describe('pattern: table-extension', () => {
    it('should generate {Base}{Prefix}_Extension class name (MS guideline)', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'table-extension', name: 'CustTable' }));
      const text = result.content[0].text as string;
      // MS rule: CustTableWHS_Extension
      expect(text).toContain('CustTableWHS_Extension');
    });

    it('should NOT generate bare CustTable_Extension (MS guideline violation)', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'table-extension', name: 'CustTable' }));
      const text = result.content[0].text as string;
      // Bare _Extension without prefix is forbidden
      expect(text).not.toMatch(/\bCustTable_Extension\b/);
    });

    it('should use [ExtensionOf(tableStr(...))] with the BASE table name', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'table-extension', name: 'CustTable' }));
      const text = result.content[0].text as string;
      expect(text).toContain('[ExtensionOf(tableStr(CustTable))]');
    });

    it('should use modelName as prefix when EXTENSION_PREFIX not set', async () => {
      const result = await codeGenTool(makeRequest({ pattern: 'table-extension', name: 'CustTable', modelName: 'Contoso' }));
      const text = result.content[0].text as string;
      expect(text).toContain('CustTableContoso_Extension');
    });

    it('should include validateWrite, insert, update methods', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'table-extension', name: 'CustTable' }));
      const text = result.content[0].text as string;
      expect(text).toContain('validateWrite');
      expect(text).toContain('insert');
      expect(text).toContain('update');
    });

    it('should warn when no prefix available', async () => {
      const result = await codeGenTool(makeRequest({ pattern: 'table-extension', name: 'CustTable' }));
      const text = result.content[0].text as string;
      expect(text).toContain('No prefix');
    });
  });

  describe('pattern: form-handler', () => {
    it('should generate {Base}{Prefix}Form_Extension class name (MS guideline)', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'form-handler', name: 'SalesTable' }));
      const text = result.content[0].text as string;
      // MS rule: SalesTableWHSForm_Extension
      expect(text).toContain('SalesTableWHSForm_Extension');
    });

    it('should NOT generate bare SalesTableForm_Extension (MS guideline violation)', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'form-handler', name: 'SalesTable' }));
      const text = result.content[0].text as string;
      // SalesTableForm_Extension without prefix infix is forbidden — ensure it's the full name
      expect(text).not.toMatch(/\bSalesTableForm_Extension\b/);
    });

    it('should use [ExtensionOf(formStr(...))] with the BASE form name', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'form-handler', name: 'SalesTable' }));
      const text = result.content[0].text as string;
      expect(text).toContain('[ExtensionOf(formStr(SalesTable))]');
    });

    it('should use modelName as prefix when EXTENSION_PREFIX not set', async () => {
      const result = await codeGenTool(makeRequest({ pattern: 'form-handler', name: 'SalesTable', modelName: 'Contoso' }));
      const text = result.content[0].text as string;
      expect(text).toContain('SalesTableContosoForm_Extension');
    });

    it('should include init, close, and event handler methods', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'form-handler', name: 'SalesTable' }));
      const text = result.content[0].text as string;
      expect(text).toContain('init');
      expect(text).toContain('close');
      expect(text).toContain('FormDataSourceEventHandler');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error handling
  // ─────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should return error for unknown pattern', async () => {
      const result = await codeGenTool(makeRequest({ pattern: 'unknown-pattern', name: 'Test' }));
      expect(result.isError).toBe(true);
    });

    it('should return error when required arguments are missing', async () => {
      const result = await codeGenTool(makeRequest({}));
      expect(result.isError).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Output format
  // ─────────────────────────────────────────────────────────────

  describe('output format', () => {
    it('should include xpp code block in output', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'Test' }));
      const text = result.content[0].text as string;
      expect(text).toContain('```xpp');
    });

    it('should include naming note about prefix', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'Test' }));
      const text = result.content[0].text as string;
      expect(text).toContain('WHSTest');
    });

    it('should include Next Steps section with tool suggestions', async () => {
      process.env.EXTENSION_PREFIX = 'WHS';
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'Test' }));
      const text = result.content[0].text as string;
      expect(text).toContain('Next Steps');
      expect(text).toContain('analyze_code_patterns');
    });

    it('should strip trailing underscore from EXTENSION_PREFIX in named output', async () => {
      process.env.EXTENSION_PREFIX = 'WHS_';
      const result = await codeGenTool(makeRequest({ pattern: 'class', name: 'MyClass' }));
      const text = result.content[0].text as string;
      expect(text).toContain('WHSMyClass');
      expect(text).not.toContain('WHS_MyClass');
    });
  });
});
