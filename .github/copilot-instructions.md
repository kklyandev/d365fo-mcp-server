# D365 Finance & Operations X++ Development

This workspace contains D365FO code. **Always use the specialized MCP tools**  pre-indexed symbol database with 584,799+ D365FO objects.

---

> ##  MANDATORY RULE  EDITING D365FO FILES
>
> **After analysis, you MUST use `modify_d365fo_file()` to apply any changes.**
>
>  **NEVER** edit D365FO objects with built-in tools:
> - `replace_string_in_file` / `multi_replace_string_in_file` / `edit_file` / `apply_patch`
> - PowerShell scripts (`Set-Content`, `Add-Content`, any shell-based file write)
> - `create_file` on an existing object
>
>  **ALWAYS** use:
> - `modify_d365fo_file()`  edit existing classes, tables, EDTs, forms, enums (add-method, add-field, modify-field, modify-property, remove-method, remove-field)
> - `create_d365fo_file()`  create new objects
>
> **modify-property covers ALL table/EDT/class-level properties — NEVER use PowerShell for these:**
> ```
> TableGroup     → modify-property  propertyPath="TableGroup"    propertyValue="Group"
> TitleField1/2  → modify-property  propertyPath="TitleField1"   propertyValue="ItemId"
> TableType      → modify-property  propertyPath="TableType"     propertyValue="TempDB"
> CacheLookup    → modify-property  propertyPath="CacheLookup"   propertyValue="Found"
> SaveDataPerCo  → modify-property  propertyPath="SaveDataPerCompany" propertyValue="No"
> EDT Extends    → modify-property  objectType="edt"  propertyPath="Extends" propertyValue="WHSZoneId"
> Class Extends  → modify-property  objectType="class" propertyPath="Extends" propertyValue="BaseClass"
> Label/HelpText → modify-property  propertyPath="Label" propertyValue="@MyModel:MyLabel"
> ```
>
> **Field rename / bulk field rewrite — NEVER use PowerShell for these:**
> ```
> Rename one field   → rename-field        fieldName="OldName"  fieldNewName="NewName"
>                      (also fixes index DataField refs and TitleField1/2 automatically)
>                      repair-only mode: if field was already renamed (e.g. by replace-all-fields),
>                      pass the OLD corrupted name → only index refs are fixed, Fields block untouched
>
> Rewrite ALL fields → replace-all-fields  fields=[{name,edt?,type?,mandatory?,label?}, ...]
>                      (use when field names contain spaces or are otherwise corrupted)
>
> Overwrite whole    → create_d365fo_file  xmlContent="<full XML>"  overwrite=true
> object XML           (use when the entire XML needs replacing)
> ```
>
> **Pattern:**
> ```
> 1. get_class_info("MyClass")                       analyze (compact=true by default)
> 2. get_method_signature(class, method)             only if you need a body
> 3. modify_d365fo_file()                            apply
>    NOT: replace_string_in_file                       FORBIDDEN
>    NOT: PowerShell script                            FORBIDDEN
> ```

> ## ⚡ TOKEN BUDGET — READ BEFORE EVERY CALL
>
> - `get_class_info` returns **signatures only** by default (`compact=true`) — do NOT pass `compact=false` unless you need to read a body
> - **NEVER call `get_class_info` more than 2× per turn** — use `get_method_signature(class, method)` for individual method bodies
> - `search_extensions` can return large results — use at most once per turn

---

## START HERE

For any D365FO request, **start with MCP tools  never** `code_search`, `grep_search`, `semantic_search`, `get_file`, `read_file` on .xml/.xpp.

| Request | MCP Tools |
|---------|-----------|
| Fix bug / review | `get_class_info`  `suggest_method_implementation`  `find_references` |
| Refactor / improve | `get_class_info`  `analyze_class_completeness`  `analyze_code_patterns` |
| Find best practice | `analyze_code_patterns`  `get_api_usage_patterns` |
| Optimize query | `get_table_info`  `analyze_code_patterns` |
| Where is X used? | `find_references(targetName)` |
| How does X work? | `get_class_info` / `get_table_info` / `get_form_info` / `get_report_info` |
| Create SSRS report | See **SSRS Report Workflow** section below |

## Critical Rules

### Forbidden built-in tools on D365FO files

|  Built-in |  MCP Tool |
|-------------|------------|
| `code_search`, `file_search`, `grep_search` | `search()`, `batch_search()` |
| `get_file`, `read_file` on .xml/.xpp | `get_class_info()`, `get_table_info()`, `get_form_info()`, `get_report_info()` |
| `edit_file`, `apply_patch`, `replace_string_in_file` | `modify_d365fo_file()` |
| `create_file` for D365FO objects | `create_d365fo_file()` |

### Non-Negotiable Rules

1. **NEVER** use built-in file/edit tools on D365FO .xml or .xpp files
2. **NEVER** guess method signatures  call `get_method_signature(className, methodName)` before CoC extensions
3. **NEVER** use `create_file` for D365FO objects  use `create_d365fo_file()`
4. **NEVER** call `create_d365fo_file` without `projectPath` or `solutionPath`  model auto-detected from `.rnrproj`; without it file may land in Microsoft standard model!
5. **NEVER** edit `.label.txt` files directly  use `create_label()`; always run `search_labels()` first
6. **ALWAYS** pass `fieldsHint` when user describes table fields  without it table will be INCOMPLETE
7. **ALWAYS** pass `primaryKeyFields` for composite PKs (2+ fields)
8. **ALWAYS** pass `methods=["find","exist"]` to `generate_smart_table()` when user requests those methods  never add them via `modify_d365fo_file` afterwards
9. **NEVER** include model prefix in `name` param of `generate_smart_table`/`generate_smart_form`  prefix is applied automatically (causes double-prefix)
10. **NEVER** use `get_enum_info()` for EDTs  use `get_edt_info()` instead
11. **NEVER** infer the target model from search results or object names — the `model` field in search/get_table_info results is the SOURCE model of that existing object, NOT where you should create new objects. The target model for ALL create/modify operations is ALWAYS from `.mcp.json` (projectPath/modelName). Example of WRONG reasoning: task involves a report → search returns objects from "AslReports" → ❌ DO NOT use "AslReports". Use the configured model.
12. **NEVER** create AxReport XML with `create_file` or PowerShell — ALWAYS use `create_d365fo_file(objectType="report", xmlContent=<full XML>, addToProject=true)`. SSRS reports require UTF-8 BOM and correct AOT path which only `create_d365fo_file` guarantees.
13. **ALWAYS** put class member variable declarations **inside** the class `{ }` body in `sourceCode` — they become `<Declaration>` in the AxClass XML. Variables placed **outside** the `{}` are NOT part of the declaration and will be lost.

### AxClass sourceCode Format — Member Variables in Declaration

D365FO AxClass XML separates a class into two blocks:
- **`<Declaration>`** — class header + ALL member variable declarations (inside the outer `{ }`)
- **`<Methods>`** — one `<Method>` entry per method defined **after** the class `{ }` closing brace

When passing `sourceCode` to `create_d365fo_file` or `generate_d365fo_xml` for a class, use this exact layout:

```xpp
// ✅ CORRECT — variables inside class {}
[DataContractAttribute]
public class MyClass extends MyBase
{
    int globalPackageNumber;
    Qty totalExportedOrderUnitQty, totalExportedInventUnitQty;
}

public int globalPackageNumber(int _v = globalPackageNumber)
{
    globalPackageNumber = _v;
    return globalPackageNumber;
}
```

Common mistakes that break the resulting AxClass XML:
```xpp
// ❌ WRONG — variables after class {}, will be lost from <Declaration>
public class MyClass
{
}
int globalPackageNumber;          // ← gets dropped!
public void myMethod() { ... }
```

```xpp
// ❌ WRONG — no class {} at all, everything treated as one method
public class MyClass
public void myMethod() { ... }
```

### generate_smart_table / generate_smart_form  TWO success cases

**Case A  Azure/Linux** (response contains `ℹ MCP server is running on Azure/Linux`):
- Tool returned XML  call `create_d365fo_file(xmlContent="<XML>", addToProject=true)` immediately  STOP
-  NEVER use `create_file`, PowerShell, or `modify_d365fo_file` instead

**Case B  Windows direct-write** (response contains ` DO NOT call create_d365fo_file`):
- File already written to disk  STOP, tell user to reload VS project
-  NEVER call `create_d365fo_file` again

### ⚠️ NEVER bypass create_d365fo_file to "work around" prefix handling

The `create_d365fo_file` tool derives the object name prefix from the `modelName` parameter — it is NOT hardcoded to any value (not "Asl", not anything else). If modelName is "MyModel", the prefix is "MyModel".
- Pass the base name WITHOUT prefix: `objectName="InventoryByZones"`, `modelName="MyModel"` → tool creates `MyModelInventoryByZones`
- Double-prefix is prevented automatically: `objectName="MyModelInventoryByZones"` + `modelName="MyModel"` → tool detects prefix already present → uses name as-is
- ❌ NEVER write XML files directly with `create_file` or PowerShell because you think the prefix logic is wrong
- ❌ NEVER edit .rnrproj manually — `create_d365fo_file` with `addToProject=true` handles it

### SSRS Report Workflow (report / sestava / výkaz)

An SSRS report in D365FO consists of **5 objects** — create them in this order:

```
1. TmpTable     objectType="table"   TableType=TempDB   (holds report rows)
2. Contract     objectType="class"   data contract with parms (dialog fields)
3. DP class     objectType="class"   extends SrsReportDataProviderBase, fills TmpTable
4. Controller   objectType="class"   extends SrsReportRunController (optional, for menu item)
5. Report       objectType="report"  AxReport XML with DataSet + Design (RDL)
```

**Step-by-step for the AxReport file:**
```
a) Study existing similar report:    get_report_info("InventValue")   ← ALWAYS use this, NEVER PowerShell Get-Content
b) Generate skeleton:                generate_d365fo_xml(objectType="report", objectName="MyReport",
                                       properties={ dpClassName, tmpTableName, datasetName,
                                                    caption, style, fields[], rdlContent })
c) Save to disk:                     create_d365fo_file(objectType="report", objectName="MyReport",
                                       xmlContent=<full XML>, addToProject=true)
```

**Key rules for reports:**
- `DataSourceType` must be `ReportDataProvider`
- `Query` field format: `SELECT * FROM {DPClassName}.{TmpTableName}`
- RDL design goes inside `<Designs><AxReportDesign><Text>…</Text></AxReportDesign></Designs>`
- ❌ NEVER use `create_file` for the .xml — it breaks AOT (wrong encoding, no project entry)
- ❌ NEVER use PowerShell `Get-Content` to read report XML — use `get_report_info()` instead
- ✅ Pass full assembled XML via `xmlContent` parameter of `create_d365fo_file`

## Available MCP Tools

### Search & Discovery
| Tool | Use for |
|------|---------|
| `search(query, type?)` | Find any D365FO symbol (class, table, method, field, enum, edt, form, query, **report**) |
| `batch_search(queries[])` | Multiple searches in parallel |
| `search_extensions(query)` | Custom/ISV code only |
| `get_class_info(className, compact?, methodOffset?)` | Class signatures (`compact=true` default, 15/page). Set `compact=false` + `methodOffset` only to read bodies |
| `get_table_info(tableName)` | Fields, indexes, relations, methods |
| `get_enum_info(enumName)` | Enum values (NOT for EDTs) |
| `get_edt_info(edtName)` | EDT definition, base type, constraints |
| `code_completion(symbolName)` | IntelliSense-like method/field listing |

### Object Info
| Tool | Use for |
|------|----------|
| `get_form_info(formName)` | Datasources, controls, methods |
| `get_query_info(queryName)` | Datasources, joins, ranges |
| `get_view_info(viewName)` | View / data entity structure |
| `get_report_info(reportName)` | **Read AxReport structure** — datasets, fields, designs, RDL summary. Use INSTEAD of PowerShell Get-Content. Reports are indexed (type=`report`) — also searchable via `search()` |
| `get_method_signature(className, methodName, includeCocTemplate?)` | **Preferred way to get a full method body** — required before CoC. Pass `includeCocTemplate: true` only when writing a CoC extension |
| `find_references(targetName, targetType?)` | Where-used analysis |

### Code Generation & Analysis
| Tool | Use for |
|------|---------|
| `analyze_code_patterns(scenario)` | Find patterns before generating code |
| `suggest_method_implementation(className, methodName)` | Real implementation examples |
| `analyze_class_completeness(className)` | Missing standard methods |
| `get_api_usage_patterns(apiName)` | Typical initialization & usage |
| `generate_code(pattern, name)` | Boilerplate: `class`, `runnable`, `form-handler`, `data-entity`, `batch-job`, `table-extension` |

### Smart Object Generation
| Tool | Use for |
|------|---------|
| `get_table_patterns(tableGroup?, similarTo?)` | Analyze patterns before creating table |
| `get_form_patterns(formPattern?, tableName?)` | Analyze patterns before creating form |
| `suggest_edt(fieldName, context?)` | Suggest correct EDT for field |
| `generate_smart_table(name, fieldsHint?, primaryKeyFields?, methods?, ...)` | AI table generation |
| `generate_smart_form(name, dataSource?, formPattern?, ...)` | AI form generation |

### File Operations
| Tool | Use for |
|------|---------|
| `generate_d365fo_xml(objectType, objectName)` | Preview XML before creating (supports: class, table, enum, form, query, view, data-entity, **report**) |
| `create_d365fo_file(objectType, objectName, modelName, projectPath?, xmlContent?, addToProject?, overwrite?)` | Create new D365FO file — or overwrite existing with `overwrite=true` + `xmlContent` (supports: class, table, enum, form, query, view, data-entity, **report**) |
| `modify_d365fo_file(objectType, objectName, operation, ...)` | Edit existing (add-method, add-field, **modify-field**, **rename-field**, **replace-all-fields**, modify-property, remove-method, remove-field) |

### Labels
| Tool | Use for |
|------|---------|
| `search_labels(query)` | **Always call first** before creating labels |
| `get_label_info(labelId?, model?)` | Get translations, list label files |
| `create_label(labelId, labelFileId, model, translations[])` | Create new label |

## File Paths & Model Name

AOT path: `C:\AOSService\PackagesLocalDirectory\{Model}\{Model}\Ax{Type}\{Name}.xml`

- Always provide `projectPath` in `create_d365fo_file`  auto-extracts `ModelName` from `.rnrproj`
- Without `projectPath`: `modelName` used AS-IS  risk of landing in Microsoft standard model!

`.mcp.json` in **MCP server directory** (next to `package.json`):
```json
{
  "servers": {
    "context": {
      "modelName": "MyModel",
      "packagePath": "C:\\AOSService\\PackagesLocalDirectory",
      "projectPath": "C:\\repos\\MySolution\\MyProject\\MyProject.rnrproj"
    }
  }
}
```

XML formatting: TABs for indentation (never spaces); CDATA for X++ source: `<![CDATA[ ... ]]>`
