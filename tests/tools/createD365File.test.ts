/**
 * Tests for XmlTemplateGenerator — specifically:
 *  - splitXppClassSource: Declaration / Methods separation
 *  - generateAxClassXml: full AxClass XML output
 *
 * Key scenario covered: member variable declarations that appear OUTSIDE the
 * class {} body (e.g. emitted by some AI generators) must be automatically
 * rescued and injected into the <Declaration> block, not silently dropped.
 */

import { describe, it, expect } from 'vitest';
import { XmlTemplateGenerator } from '../../src/tools/createD365File';

describe('XmlTemplateGenerator.splitXppClassSource()', () => {

  // ─────────────────────────────────────────────────────────────
  // Happy path — variables correctly inside class {}
  // ─────────────────────────────────────────────────────────────

  it('should split class header + member vars (inside {}) from methods', () => {
    const source = `public class MyClass
{
    int globalPackageNumber;
    Qty totalExportedQty;
}

public int globalPackageNumber(int _v = globalPackageNumber)
{
    globalPackageNumber = _v;
    return globalPackageNumber;
}`;

    const { declaration, methods } = XmlTemplateGenerator.splitXppClassSource(source);

    expect(declaration).toContain('int globalPackageNumber;');
    expect(declaration).toContain('Qty totalExportedQty;');
    expect(declaration).toMatch(/\}$/); // must end with closing brace
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('globalPackageNumber');
  });

  it('should handle a class with no methods and no member vars', () => {
    const source = `public class Simple\n{\n}`;
    const { declaration, methods } = XmlTemplateGenerator.splitXppClassSource(source);
    expect(declaration).toBe('public class Simple\n{\n}');
    expect(methods).toHaveLength(0);
  });

  it('should handle multiple methods correctly', () => {
    const source = `public class MyDP extends SrsReportDataProviderBase
{
    MyTmp tmpTable;
}
public void processReport()
{
    // fill tmp
}
protected void postProcessReport()
{
    super();
}`;
    const { declaration, methods } = XmlTemplateGenerator.splitXppClassSource(source);
    expect(declaration).toContain('MyTmp tmpTable;');
    expect(methods).toHaveLength(2);
    expect(methods[0].name).toBe('processReport');
    expect(methods[1].name).toBe('postProcessReport');
  });

  // ─────────────────────────────────────────────────────────────
  // Rescue scenario — variables OUTSIDE the class {} (AI mistake)
  // ─────────────────────────────────────────────────────────────

  it('should rescue member variable declarations placed OUTSIDE the class {}', () => {
    // This is the bug pattern: AI emits member vars after the class closing brace
    const source = `public class CustPackingSlipJournal
{
}

int globalPackageNumber;
Qty totalExportedOrderUnitQty, totalExportedInventUnitQty;

public void newCustPackingSlipJournal()
{
    super();
}`;

    const { declaration, methods } = XmlTemplateGenerator.splitXppClassSource(source);

    // Variables must be injected into the declaration block
    expect(declaration).toContain('int globalPackageNumber;');
    expect(declaration).toContain('Qty totalExportedOrderUnitQty, totalExportedInventUnitQty;');

    // Declaration must still close with }
    expect(declaration.trimEnd()).toMatch(/\}$/);

    // Method should still be parsed correctly
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('newCustPackingSlipJournal');
  });

  it('should not rescue lines that look like method calls (contain parentheses)', () => {
    const source = `public class MyClass
{
}

SomeHelper::construct();   // ← this is a stray call, not a var declaration

public void run()
{
    // body
}`;
    const { declaration, methods } = XmlTemplateGenerator.splitXppClassSource(source);

    // The stray call line (contains '(') must NOT be injected
    expect(declaration).not.toContain('SomeHelper::construct()');
    expect(methods).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────

  it('should return fullSource as declaration when there is no opening brace', () => {
    const source = 'public class Broken';
    const { declaration, methods } = XmlTemplateGenerator.splitXppClassSource(source);
    expect(declaration).toBe(source);
    expect(methods).toHaveLength(0);
  });

  it('should handle attribute annotations before the class header', () => {
    const source = `[DataContractAttribute]
public class MyContract
{
    str myField;
}
public str myField(str _v = myField)
{
    myField = _v;
    return myField;
}`;
    const { declaration, methods } = XmlTemplateGenerator.splitXppClassSource(source);
    expect(declaration).toContain('[DataContractAttribute]');
    expect(declaration).toContain('str myField;');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('myField');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateAxClassXml — XML output shape
// ─────────────────────────────────────────────────────────────────────────────

describe('XmlTemplateGenerator.generateAxClassXml()', () => {

  it('should produce Declaration block containing member variables inside class {}', () => {
    const source = `public class MyClass
{
    int counter;
    str description;
}
public void increment()
{
    counter++;
}`;

    const xml = XmlTemplateGenerator.generateAxClassXml('MyClass', source);

    // <Declaration> CDATA must include the member variables
    expect(xml).toContain('int counter;');
    expect(xml).toContain('str description;');

    // <Methods> section must contain the method
    expect(xml).toContain('<Name>increment</Name>');
    expect(xml).toContain('<Source><![CDATA[');

    // D365FO convention: method source always starts with 4-space indent
    const sourceStart = xml.indexOf('<Source><![CDATA[\n') + '<Source><![CDATA[\n'.length;
    const firstMethodLine = xml.substring(sourceStart, xml.indexOf('\n', sourceStart));
    expect(firstMethodLine).toMatch(/^    /); // must start with 4 spaces
  });

  it('should indent ALL lines of multi-line method bodies with 4 spaces', () => {
    const source = `public class MyDP
{
}
public void processReport()
{
    // line 1
    // line 2
}`;
    const xml = XmlTemplateGenerator.generateAxClassXml('MyDP', source);
    const sourceMatch = xml.match(/<Source><!\[CDATA\[\n([\s\S]*?)\n\]\]><\/Source>/);
    expect(sourceMatch).toBeTruthy();
    const methodLines = sourceMatch![1].split('\n').filter(l => l.trim());
    // Every non-empty line must be indented by at least 4 spaces
    for (const line of methodLines) {
      expect(line).toMatch(/^    /);
    }
  });

  it('should separate multiple methods with a single blank line', () => {
    const source = `public class MyClass
{
}
public void first()
{
    // a
}
public void second()
{
    // b
}
public void third()
{
    // c
}`;
    const xml = XmlTemplateGenerator.generateAxClassXml('MyClass', source);

    // Between </Method> and the next <Method> there must be exactly one blank line
    const between = xml.match(/<\/Method>\n(\n?)\t\t\t<Method>/g);
    expect(between).toBeTruthy();
    // Every gap must contain exactly one \n (making it \n\n total = blank line)
    for (const gap of between!) {
      expect(gap).toBe('</Method>\n\n\t\t\t<Method>');
    }
  });

  it('should rescue variables from outside {} into <Declaration> in generated XML', () => {
    // Simulate the common AI mistake: vars emitted after class body
    const source = `public class MyClass
{
}
int globalPackageNumber;
Qty totalQty;

public void run()
{
    // body
}`;

    const xml = XmlTemplateGenerator.generateAxClassXml('MyClass', source);

    // Even though vars were outside {}, they must appear in <Declaration>
    const declStart = xml.indexOf('<Declaration><![CDATA[');
    const declEnd = xml.indexOf(']]></Declaration>');
    expect(declStart).toBeGreaterThan(-1);
    expect(declEnd).toBeGreaterThan(declStart);
    const declContent = xml.substring(declStart, declEnd);

    expect(declContent).toContain('int globalPackageNumber;');
    expect(declContent).toContain('Qty totalQty;');
  });

  it('should produce a default empty class when no sourceCode provided', () => {
    const xml = XmlTemplateGenerator.generateAxClassXml('EmptyClass');
    expect(xml).toContain('<Name>EmptyClass</Name>');
    expect(xml).toContain('<Declaration><![CDATA[');
    expect(xml).toContain('<Methods />');
  });

  it('should include Extends property when supplied', () => {
    const xml = XmlTemplateGenerator.generateAxClassXml('MyBatch', undefined, { extends: 'RunBaseBatch' });
    expect(xml).toContain('<Extends>RunBaseBatch</Extends>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// encodeReportTextElement — CDATA → entity encoding for <Text>
// ─────────────────────────────────────────────────────────────────────────────

describe('XmlTemplateGenerator.encodeReportTextElement()', () => {

  it('should convert <Text><![CDATA[...]]></Text> to entity-encoded form', () => {
    const rdl = '<Report><Body /></Report>';
    const input = `<AxReport><Designs><AxReportDesign><Text><![CDATA[${rdl}]]></Text></AxReportDesign></Designs></AxReport>`;
    const result = XmlTemplateGenerator.encodeReportTextElement(input);

    expect(result).toContain('<Text>&lt;Report&gt;&lt;Body /&gt;&lt;/Report&gt;</Text>');
    expect(result).not.toContain('<![CDATA[');
  });

  it('should be idempotent — entity-encoded input is not double-encoded', () => {
    const rdl = '<Report><Body /></Report>';
    const input = `<AxReport><Designs><AxReportDesign><Text><![CDATA[${rdl}]]></Text></AxReportDesign></Designs></AxReport>`;
    const once = XmlTemplateGenerator.encodeReportTextElement(input);
    const twice = XmlTemplateGenerator.encodeReportTextElement(once);
    expect(twice).toBe(once); // second pass: no CDATA found → unchanged
  });

  it('should encode & before < and > to avoid double-encoding', () => {
    const rdl = '<Report>&amp; test <Body /></Report>';
    const input = `<AxReport><Text><![CDATA[${rdl}]]></Text></AxReport>`;
    const result = XmlTemplateGenerator.encodeReportTextElement(input);
    // & → &amp; first, then < → &lt; and > → &gt;
    expect(result).toContain('&amp;amp;');
    expect(result).toContain('&lt;Report&gt;');
  });

  it('should leave non-CDATA <Text> elements unchanged', () => {
    const input = '<AxReport><Name>R</Name><Text>already encoded</Text></AxReport>';
    const result = XmlTemplateGenerator.encodeReportTextElement(input);
    expect(result).toBe(input);
  });
});
