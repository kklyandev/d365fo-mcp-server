/**
 * D365FO XML Generator Tool
 * Generates D365FO XML content for classes, tables, enums, etc.
 * Returns XML as text - user/Copilot creates the physical file
 * Works remotely through Azure (no file system access needed)
 */

import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getConfigManager } from '../utils/configManager.js';

const GenerateD365XmlArgsSchema = z.object({
  objectType: z
    .enum(['class', 'table', 'enum', 'form', 'query', 'view', 'data-entity', 'report'])
    .describe('Type of D365FO object'),
  objectName: z
    .string()
    .describe('Name of the object (e.g., MyHelperClass, MyCustomTable)'),
  modelName: z
    .string()
    .optional()
    .describe('Model name (e.g., ContosoExtensions). Auto-detected from mcp.json if omitted.'),
  sourceCode: z
    .string()
    .optional()
    .describe('X++ source code for the object (class declaration, methods, etc.)'),
  properties: z
    .record(z.string(), z.any())
    .optional()
    .describe('Additional properties for the object (extends, implements, label, etc.)'),
});

/**
 * XML Template Generator for D365FO Objects
 */
class XmlTemplateGenerator {
  /**
   * Generate AxClass XML structure
   */
  static generateAxClassXml(
    className: string,
    sourceCode?: string,
    properties?: Record<string, any>
  ): string {
    const declaration = sourceCode || `public class ${className}\n{\n}`;
    const extendsAttr = properties?.extends
      ? `\t<Extends>${properties.extends}</Extends>\n`
      : '';
    const implementsAttr = properties?.implements
      ? `\t<Implements>${properties.implements}</Implements>\n`
      : '';
    const isFinalAttr = properties?.isFinal ? `\t<IsFinal>Yes</IsFinal>\n` : '';
    const isAbstractAttr = properties?.isAbstract
      ? `\t<IsAbstract>Yes</IsAbstract>\n`
      : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<AxClass xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${className}</Name>
${extendsAttr}${implementsAttr}${isFinalAttr}${isAbstractAttr}\t<SourceCode>
\t\t<Declaration><![CDATA[
${declaration}
]]></Declaration>
\t\t<Methods />
\t</SourceCode>
</AxClass>
`;
  }

  /**
   * Generate AxTable XML structure
   */
  static generateAxTableXml(
    tableName: string,
    properties?: Record<string, any>
  ): string {
    const label = properties?.label || tableName;
    const tableGroup = properties?.tableGroup || 'Main';
    const titleField1 = properties?.titleField1 || '';
    const titleField2 = properties?.titleField2 || '';

    const titleField1Xml = titleField1
      ? `\t<TitleField1>${titleField1}</TitleField1>\n`
      : '';
    const titleField2Xml = titleField2
      ? `\t<TitleField2>${titleField2}</TitleField2>\n`
      : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<AxTable xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${tableName}</Name>
\t<SourceCode>
\t\t<Declaration><![CDATA[
public class ${tableName} extends common
{
}
]]></Declaration>
\t\t<Methods />
\t</SourceCode>
\t<Label>${label}</Label>
\t<TableGroup>${tableGroup}</TableGroup>
${titleField1Xml}${titleField2Xml}\t<DeleteActions />
\t<FieldGroups>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoReport</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoLookup</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoIdentification</Name>
\t\t\t<AutoPopulate>Yes</AutoPopulate>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoSummary</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t\t<AxTableFieldGroup>
\t\t\t<Name>AutoBrowse</Name>
\t\t\t<Fields />
\t\t</AxTableFieldGroup>
\t</FieldGroups>
\t<Fields />
\t<Indexes />
\t<Relations />
</AxTable>
`;
  }

  /**
   * Generate AxEnum XML structure
   */
  static generateAxEnumXml(
    enumName: string,
    properties?: Record<string, any>
  ): string {
    const label = properties?.label || enumName;
    const isExtensible = properties?.isExtensible ? 'Yes' : 'No';

    return `<?xml version="1.0" encoding="utf-8"?>
<AxEnum xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${enumName}</Name>
\t<Label>${label}</Label>
\t<IsExtensible>${isExtensible}</IsExtensible>
\t<EnumValues />
</AxEnum>
`;
  }

  /**
   * Generate AxForm XML structure
   */
  static generateAxFormXml(
    formName: string,
    _properties?: Record<string, any>
  ): string {
    // D365FO forms require xmlns="Microsoft.Dynamics.AX.Metadata.V6" and SourceCode first
    // NOTE: <Label> is intentionally absent — AxForm files do not carry a top-level <Label>.
    return `<?xml version="1.0" encoding="utf-8"?>
<AxForm xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="Microsoft.Dynamics.AX.Metadata.V6">
\t<Name>${formName}</Name>
\t<SourceCode>
\t\t<Methods xmlns="">
\t\t\t<Method>
\t\t\t\t<Name>classDeclaration</Name>
\t\t\t\t<Source><!\[CDATA[
    [Form]
    public class ${formName} extends FormRun
    {
    }
]]></Source>
\t\t\t</Method>
\t\t</Methods>
\t\t<DataSources xmlns="" />
\t\t<DataControls xmlns="" />
\t\t<Members xmlns="" />
\t</SourceCode>
\t<DataSources />
\t<Design>
\t\t<Controls xmlns="" />
\t</Design>
\t<Parts />
</AxForm>
`;
  }

  /**
   * Generate AxQuery XML structure
   */
  static generateAxQueryXml(
    queryName: string,
    properties?: Record<string, any>
  ): string {
    const label = properties?.label || queryName;

    return `<?xml version="1.0" encoding="utf-8"?>
<AxQuery xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${queryName}</Name>
\t<Label>${label}</Label>
\t<DataSources />
</AxQuery>
`;
  }

  /**
   * Generate AxView XML structure
   */
  static generateAxViewXml(
    viewName: string,
    properties?: Record<string, any>
  ): string {
    const label = properties?.label || viewName;

    return `<?xml version="1.0" encoding="utf-8"?>
<AxView xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${viewName}</Name>
\t<Label>${label}</Label>
\t<ViewMetadata />
\t<Fields />
</AxView>
`;
  }

  /**
   * Generate AxDataEntityView XML structure
   */
  static generateAxDataEntityXml(
    entityName: string,
    properties?: Record<string, any>
  ): string {
    const label = properties?.label || entityName;
    const publicEntityName = properties?.publicEntityName || entityName;

    return `<?xml version="1.0" encoding="utf-8"?>
<AxDataEntityView xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
\t<Name>${entityName}</Name>
\t<Label>${label}</Label>
\t<PublicEntityName>${publicEntityName}</PublicEntityName>
\t<DataSources />
\t<Fields />
\t<Keys />
\t<Mappings />
</AxDataEntityView>
`;
  }

  /**
   * Generate AxReport XML skeleton.
   *
   * properties:
   *   dpClassName   - Data Provider class name          (default: <ReportName>DP)
   *   tmpTableName  - TempDB table name                 (default: <ReportName>Tmp)
   *   datasetName   - AxReportDataSet name              (default: tmpTableName)
   *   designName    - AxReportDesign name               (default: 'Report')
   *   caption       - Design caption label ref           (e.g. '@MyModel:MyLabel')
   *   style         - Design style template             (e.g. 'TableStyleTemplate')
   *   fields        - Array of { name, alias?, dataType?, caption? } → AxReportDataSetField
   *   rdlContent    - Full RDL XML string to embed in <Text><![CDATA[...]]></Text>
   */
  static generateAxReportXml(
    reportName: string,
    properties?: Record<string, any>
  ): string {
    const tmpTableName = properties?.tmpTableName || `${reportName}Tmp`;
    const dpClassName  = properties?.dpClassName  || `${reportName}DP`;
    const datasetName  = properties?.datasetName  || tmpTableName;
    const designName   = properties?.designName   || 'Report';

    // --- Fields block ---
    type FieldDef = { name: string; alias?: string; dataType?: string; caption?: string };
    const fields = properties?.fields as FieldDef[] | undefined;
    let fieldsXml: string;
    if (fields && fields.length > 0) {
      const entries = fields.map(f => {
        const alias   = f.alias    || `${tmpTableName}.1.${f.name}`;
        const capLine = f.caption  ? `\n\t\t\t\t<Caption>${f.caption}</Caption>`   : '';
        const dtLine  = f.dataType ? `\n\t\t\t\t<DataType>${f.dataType}</DataType>` : '';
        return [
          `\t\t\t<AxReportDataSetField>`,
          `\t\t\t\t<Name>${f.name}</Name>`,
          `\t\t\t\t<Alias>${alias}</Alias>${capLine}${dtLine}`,
          `\t\t\t\t<DisplayWidth>Auto</DisplayWidth>`,
          `\t\t\t\t<UserDefined>false</UserDefined>`,
          `\t\t\t</AxReportDataSetField>`,
        ].join('\n');
      });
      fieldsXml = `\t\t\t<Fields>\n${entries.join('\n')}\n\t\t\t</Fields>`;
    } else {
      fieldsXml = `\t\t\t<Fields />`;
    }

    // --- Dataset parameters block (AX system params mapped to dataset query) ---
    const datasetParamsXml = `\t\t\t<Parameters>
\t\t\t\t<AxReportDataSetParameter>
\t\t\t\t\t<Name>AX_PartitionKey</Name>
\t\t\t\t\t<Alias>AX_PartitionKey</Alias>
\t\t\t\t\t<DataType>System.String</DataType>
\t\t\t\t\t<Parameter>AX_PartitionKey</Parameter>
\t\t\t\t</AxReportDataSetParameter>
\t\t\t\t<AxReportDataSetParameter>
\t\t\t\t\t<Name>AX_CompanyName</Name>
\t\t\t\t\t<Alias>AX_CompanyName</Alias>
\t\t\t\t\t<DataType>System.String</DataType>
\t\t\t\t\t<Parameter>AX_CompanyName</Parameter>
\t\t\t\t</AxReportDataSetParameter>
\t\t\t\t<AxReportDataSetParameter>
\t\t\t\t\t<Name>AX_UserContext</Name>
\t\t\t\t\t<Alias>AX_UserContext</Alias>
\t\t\t\t\t<DataType>System.String</DataType>
\t\t\t\t\t<Parameter>AX_UserContext</Parameter>
\t\t\t\t</AxReportDataSetParameter>
\t\t\t\t<AxReportDataSetParameter>
\t\t\t\t\t<Name>AX_RenderingCulture</Name>
\t\t\t\t\t<Alias>AX_RenderingCulture</Alias>
\t\t\t\t\t<DataType>System.String</DataType>
\t\t\t\t\t<Parameter>AX_RenderingCulture</Parameter>
\t\t\t\t</AxReportDataSetParameter>
\t\t\t\t<AxReportDataSetParameter>
\t\t\t\t\t<Name>AX_ReportContext</Name>
\t\t\t\t\t<Alias>AX_ReportContext</Alias>
\t\t\t\t\t<DataType>System.String</DataType>
\t\t\t\t\t<Parameter>AX_ReportContext</Parameter>
\t\t\t\t</AxReportDataSetParameter>
\t\t\t\t<AxReportDataSetParameter>
\t\t\t\t\t<Name>AX_RdpPreProcessedId</Name>
\t\t\t\t\t<Alias>AX_RdpPreProcessedId</Alias>
\t\t\t\t\t<DataType>System.String</DataType>
\t\t\t\t\t<Parameter>AX_RdpPreProcessedId</Parameter>
\t\t\t\t</AxReportDataSetParameter>
\t\t\t</Parameters>`;

    // --- DefaultParameterGroup block (root-level — "Parameters" node in VS Designer) ---
    const defaultParamGroupXml = `\t<DefaultParameterGroup>
\t\t<Name xmlns="">Parameters</Name>
\t\t<ReportParameterBases xmlns="">
\t\t\t<AxReportParameterBase xmlns=""
\t\t\t\t\ti:type="AxReportParameter">
\t\t\t\t<Name>AX_PartitionKey</Name>
\t\t\t\t<AllowBlank>true</AllowBlank>
\t\t\t\t<Nullable>true</Nullable>
\t\t\t\t<UserVisibility>Hidden</UserVisibility>
\t\t\t\t<DefaultValue />
\t\t\t\t<Values />
\t\t\t</AxReportParameterBase>
\t\t\t<AxReportParameterBase xmlns=""
\t\t\t\t\ti:type="AxReportParameter">
\t\t\t\t<Name>AX_CompanyName</Name>
\t\t\t\t<UserVisibility>Hidden</UserVisibility>
\t\t\t\t<DefaultValue />
\t\t\t\t<Values />
\t\t\t</AxReportParameterBase>
\t\t\t<AxReportParameterBase xmlns=""
\t\t\t\t\ti:type="AxReportParameter">
\t\t\t\t<Name>AX_UserContext</Name>
\t\t\t\t<AllowBlank>true</AllowBlank>
\t\t\t\t<Nullable>true</Nullable>
\t\t\t\t<UserVisibility>Hidden</UserVisibility>
\t\t\t\t<DefaultValue />
\t\t\t\t<Values />
\t\t\t</AxReportParameterBase>
\t\t\t<AxReportParameterBase xmlns=""
\t\t\t\t\ti:type="AxReportParameter">
\t\t\t\t<Name>AX_RenderingCulture</Name>
\t\t\t\t<AllowBlank>true</AllowBlank>
\t\t\t\t<Nullable>true</Nullable>
\t\t\t\t<UserVisibility>Hidden</UserVisibility>
\t\t\t\t<DefaultValue />
\t\t\t\t<Values />
\t\t\t</AxReportParameterBase>
\t\t\t<AxReportParameterBase xmlns=""
\t\t\t\t\ti:type="AxReportParameter">
\t\t\t\t<Name>AX_ReportContext</Name>
\t\t\t\t<AllowBlank>true</AllowBlank>
\t\t\t\t<Nullable>true</Nullable>
\t\t\t\t<UserVisibility>Hidden</UserVisibility>
\t\t\t\t<DefaultValue />
\t\t\t\t<Values />
\t\t\t</AxReportParameterBase>
\t\t\t<AxReportParameterBase xmlns=""
\t\t\t\t\ti:type="AxReportParameter">
\t\t\t\t<Name>AX_RdpPreProcessedId</Name>
\t\t\t\t<AllowBlank>true</AllowBlank>
\t\t\t\t<Nullable>true</Nullable>
\t\t\t\t<UserVisibility>Hidden</UserVisibility>
\t\t\t\t<DefaultValue />
\t\t\t\t<Values />
\t\t\t</AxReportParameterBase>
\t\t</ReportParameterBases>
\t</DefaultParameterGroup>`;

    // --- Design block ---
    const captionLine = properties?.caption ? `\n\t\t\t<Caption>${properties.caption}</Caption>` : '';
    const styleLine   = properties?.style   ? `\n\t\t\t<Style>${properties.style}</Style>`       : '';
    const rdlContent  = properties?.rdlContent as string | undefined;
    const textElement = rdlContent ? `\n\t\t\t<Text><![CDATA[${rdlContent}]]></Text>` : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<AxReport xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="Microsoft.Dynamics.AX.Metadata.V2">
\t<Name>${reportName}</Name>
\t<DataMethods />
\t<DataSets>
\t\t<AxReportDataSet xmlns="">
\t\t\t<Name>${datasetName}</Name>
\t\t\t<DataSourceType>ReportDataProvider</DataSourceType>
\t\t\t<Query>SELECT * FROM ${dpClassName}.${tmpTableName}</Query>
\t\t\t<FieldGroups />
${fieldsXml}
${datasetParamsXml}
\t\t</AxReportDataSet>
\t</DataSets>
${defaultParamGroupXml}
\t<Designs>
\t\t<AxReportDesign xmlns=""
\t\t\t\ti:type="AxReportPrecisionDesign">
\t\t\t<Name>${designName}</Name>${captionLine}
\t\t\t<DataSet>${datasetName}</DataSet>${styleLine}
\t\t\t<AutoDesignSpecs />${textElement}
\t\t\t<DisableIndividualTransformation />
\t\t</AxReportDesign>
\t</Designs>
\t<EmbeddedImages />
</AxReport>`;
  }

  /**
   * Main generate method
   */
  static generate(
    objectType: string,
    objectName: string,
    sourceCode?: string,
    properties?: Record<string, any>
  ): string {
    switch (objectType) {
      case 'class':
        return this.generateAxClassXml(objectName, sourceCode, properties);
      case 'table':
        return this.generateAxTableXml(objectName, properties);
      case 'enum':
        return this.generateAxEnumXml(objectName, properties);
      case 'form':
        return this.generateAxFormXml(objectName, properties);
      case 'query':
        return this.generateAxQueryXml(objectName, properties);
      case 'view':
        return this.generateAxViewXml(objectName, properties);
      case 'data-entity':
        return this.generateAxDataEntityXml(objectName, properties);
      case 'report':
        return this.generateAxReportXml(objectName, properties);
      default:
        throw new Error(`Unsupported object type: ${objectType}`);
    }
  }
}

/**
 * Generate D365FO XML handler function
 */
export async function handleGenerateD365Xml(
  request: CallToolRequest
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const args = GenerateD365XmlArgsSchema.parse(request.params.arguments);

  try {
    // Resolve model name: arg → mcp.json modelName → workspacePath segment
    const configManager = getConfigManager();
    const modelName = args.modelName || configManager.getModelName();
    if (!modelName) {
      const errorMsg =
        '❌ ERROR: modelName could not be resolved.\n\n' +
        'Provide it in one of these ways:\n' +
        '  1. Pass modelName explicitly in the tool call arguments\n' +
        '  2. Add modelName to .mcp.json context: { "context": { "modelName": "YourModel" } }\n' +
        '  3. Add workspacePath ending with the package/model name: { "context": { "workspacePath": "K:\\\\...\\\\YourModel" } }';
      return { content: [{ type: 'text', text: errorMsg }] };
    }

    console.error(
      `[generate_d365fo_xml] Generating XML for ${args.objectType}: ${args.objectName}, model: ${modelName}`
    );

    // Determine object folder based on type
    const objectFolderMap: Record<string, string> = {
      class: 'AxClass',
      table: 'AxTable',
      enum: 'AxEnum',
      form: 'AxForm',
      query: 'AxQuery',
      view: 'AxView',
      'data-entity': 'AxDataEntityView',
      report: 'AxReport',
    };

    const objectFolder = objectFolderMap[args.objectType];
    if (!objectFolder) {
      throw new Error(`Unsupported object type: ${args.objectType}`);
    }

    // Generate XML content
    const xmlContent = XmlTemplateGenerator.generate(
      args.objectType,
      args.objectName,
      args.sourceCode,
      args.properties
    );

    console.error(
      `[generate_d365fo_xml] Generated XML content: ${xmlContent.length} bytes`
    );

    // Construct recommended file path
    const recommendedPath = `K:\\AosService\\PackagesLocalDirectory\\${modelName}\\${modelName}\\${objectFolder}\\${args.objectName}.xml`;

    // Return XML content with instructions
    const instructions = `✅ Generated D365FO ${args.objectType} XML for: ${args.objectName}

📋 Model: ${modelName}
📁 Recommended path: ${recommendedPath}

⚠️ CRITICAL NEXT STEPS (GitHub Copilot MUST do this):

1. **Create the file** using create_file tool:
   - Path: ${recommendedPath}
   - Content: Use the XML content below (between xml markers)
   - ⚠️ IMPORTANT: D365FO requires UTF-8 with BOM encoding!
   - VS Code create_file uses UTF-8 without BOM by default, which may cause "unicode substitution character" errors

2. **If you see encoding errors**, manually add UTF-8 BOM:
   - Open file in hex editor
   - Ensure first 3 bytes are: EF BB BF (UTF-8 BOM)
   - Or use create_d365fo_file tool instead (if MCP server runs on local Windows)

3. **Add to Visual Studio project** (.rnrproj):
   <Content Include="${recommendedPath.replace(/\\/g, '\\\\')}" />
   
4. **Build the project** to synchronize with AOT

---

📄 XML Content (copy exactly, do not modify):

\`\`\`xml
${xmlContent}
\`\`\`

---

💡 **Alternative:** If MCP server runs on local Windows, use \`create_d365fo_file\` tool instead - it handles UTF-8 BOM automatically and adds to VS project.`;

    return {
      content: [
        {
          type: 'text',
          text: instructions,
        },
      ],
    };
  } catch (error) {
    console.error(`[generate_d365fo_xml] Error:`, error);
    return {
      content: [
        {
          type: 'text',
          text: `❌ Error generating D365FO XML:\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
    };
  }
}
