/**
 * X++ Knowledge Base Tool Tests
 */

import { describe, it, expect } from 'vitest';
import { xppKnowledgeTool } from '../../src/tools/xppKnowledge';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';

const req = (args: Record<string, unknown> = {}): CallToolRequest => ({
  method: 'tools/call',
  params: { name: 'get_xpp_knowledge', arguments: args },
});

const getText = (result: any): string =>
  result.content?.[0]?.text ?? '';

describe('get_xpp_knowledge', () => {
  it('returns results for "batch job" topic', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'batch job' }));
    const text = getText(result);
    expect(text).toContain('SysOperation');
    expect(text).not.toContain('❌ No matching');
  });

  it('returns results for "ttsbegin" topic', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'ttsbegin' }));
    const text = getText(result);
    expect(text).toContain('ttsbegin');
    expect(text).toContain('ttscommit');
  });

  it('returns results for "CoC" topic', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'CoC' }));
    const text = getText(result);
    expect(text).toContain('Chain of Command');
    expect(text).toContain('ExtensionOf');
  });

  it('returns results by entry ID', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'set-based' }));
    const text = getText(result);
    expect(text).toContain('Set-Based Operations');
  });

  it('returns detailed format with code examples', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'transactions', format: 'detailed' }));
    const text = getText(result);
    expect(text).toContain('```xpp');
    expect(text).toContain('Code Examples');
  });

  it('returns concise format by default', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'transactions' }));
    const text = getText(result);
    expect(text).toContain('Rules:');
    // Concise does not include code blocks
    expect(text).not.toContain('```xpp');
  });

  it('returns migration info for AX2012 topics', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'RunBase', format: 'detailed' }));
    const text = getText(result);
    expect(text).toContain('AX2012');
    expect(text).toContain('D365FO');
  });

  it('returns deprecated API info', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'today() deprecated' }));
    const text = getText(result);
    expect(text).toContain('DateTimeUtil');
  });

  it('returns all topics for empty-like query', async () => {
    const result = await xppKnowledgeTool(req({ topic: '' }));
    const text = getText(result);
    // Should list all entries alphabetically
    expect(text).toContain('Chain of Command');
    expect(text).toContain('Transaction');
  });

  it('returns no-match message for unknown topic', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'zzzyyyxxx_nonexistent' }));
    const text = getText(result);
    expect(text).toContain('❌ No matching');
    expect(text).toContain('Available topics');
  });

  it('handles temp tables query', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'temp tables TempDB' }));
    const text = getText(result);
    expect(text).toContain('TempDB');
    expect(text).toContain('InMemory');
  });

  it('handles SSRS report query', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'ssrs report' }));
    const text = getText(result);
    expect(text).toContain('SSRS');
    expect(text).toContain('SRSReportDataProviderBase');
  });

  it('handles security query', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'security roles duties' }));
    const text = getText(result);
    expect(text).toContain('Role');
    expect(text).toContain('Duty');
    expect(text).toContain('Privilege');
  });

  it('handles number sequence query', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'number sequence' }));
    const text = getText(result);
    expect(text).toContain('NumberSeq');
  });

  it('returns error for missing topic parameter', async () => {
    const result = await xppKnowledgeTool(req({}));
    expect(result.isError).toBe(true);
  });

  it('handles data entity / OData query', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'data entity odata integration' }));
    const text = getText(result);
    expect(text).toContain('Data Entit');
    expect(text).toContain('OData');
  });

  it('handles overlayering migration query', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'overlayering overlay' }));
    const text = getText(result);
    expect(text).toContain('CoC');
  });

  it('surfaces related topics', async () => {
    const result = await xppKnowledgeTool(req({ topic: 'transactions', format: 'detailed' }));
    const text = getText(result);
    expect(text).toContain('Related topics');
  });
});
