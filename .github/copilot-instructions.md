# D365 Finance & Operations X++ Development

<!-- Mirrors rules from xpp_system_instructions MCP prompt (src/prompts/systemInstructions.ts). Keep in sync. -->

This workspace contains D365FO code. **Always use the specialized MCP tools** — backed by a pre-indexed symbol database with hundreds of thousands of D365FO objects. Built-in file/search tools do not understand X++ syntax or AOT structure.

---

## 🚨 TERMINAL PROHIBITION

**PowerShell / any terminal command WILL HANG in this workspace.** This applies in VS Code, VS 2022, VS 2026.

- **NEVER** run `run_in_terminal`, Developer PowerShell, or any shell command
- **NEVER** use terminal as fallback when an MCP tool fails — STOP and report the error
- If a tool parameter "seems missing" — re-read the schema; it IS present

## 🔓 WHEN MCP IS OPTIONAL

MCP rules apply **only to D365FO objects** (`.xml`/`.xpp`, AOT objects, labels, `.rnrproj`).

**Use built-in tools freely for:** `*.cs`, `*.json`, `*.yml`, `*.md`, `*.config`, `*.csproj`, `*.sln`, plain text, or when user says "skip MCP" / "manual mode".

- **`.rnrproj`** = D365FO project → managed by MCP (`addToProject=true`). NEVER edit directly.
- **`.csproj`** = C# project → use built-in tools.

## � HOW READS ARE RESOLVED (read-path policy)

Info tools (`get_class_info`, `get_table_info`, `get_form_info`, `get_view_info`, `get_query_info`, `get_report_info`, `get_table_extension_info`, `find_coc_extensions`, `analyze_extension_points`) resolve data in this order:

1. **C# bridge** — live `IMetadataProvider` from the running D365FO instance. Authoritative when available.
2. **SQLite symbol index** — pre-built mirror. Used when the bridge is offline (Azure, write-only mode, build agents).
3. **Filesystem parse** — last resort for objects created in the current session and not yet indexed. Scanner has a 3 s budget, 30 s result cache, and can be disabled in production with `D365FO_DISABLE_FS_FALLBACK=true`.

You never need to pick the source manually — just call the tool. If you see `⚠️ Served from symbol index` or `⚠️ Not yet in bridge metadata`, the bridge was unavailable and the tool already fell back.

## 🛡️ WRITE-PATH SAFETY

All write operations (`modify_d365fo_file`, `create_d365fo_file`) only accept paths that live under a configured `PackagesLocalDirectory/<Package>/<Model>/Ax<Type>/<Name>.xml`. Arbitrary paths are rejected.

---

## �🔌 MANDATORY FIRST CHECK

**Call `get_workspace_info()` before doing anything.**

| Response | Action |
|----------|--------|
| Call fails | STOP. Tell user MCP server is not connected. Offer: start server (A) or continue with built-in tools (B). Wait for answer. |
| "not available in read-only mode" | Azure mode. Ask user for model name explicitly. Do NOT infer from search results. |
| `⛔ CONFIGURATION PROBLEM` | STOP. Relay message. Wait for user. |
| `✅ Configuration looks valid` | Note model name. Use it for all create/modify calls. Proceed. |

If you encounter `MyModel`/`MyPackage` placeholder mid-task — STOP and notify user.

## ✏️ EDITING D365FO FILES

| Action | Tool |
|--------|------|
| Edit existing objects | `modify_d365fo_file()` — methods, fields, indexes, relations, field-groups, controls, properties |
| Create new objects | `create_d365fo_file()` |
| Search | `search()`, `batch_search()` |
| Read objects | `get_class_info()`, `get_table_info()`, `get_form_info()`, `get_report_info()` |
| Verify project | `verify_d365fo_project()` |
| Build/BP/Sync/Test | `build_d365fo_project()`, `run_bp_check()`, `trigger_db_sync()`, `run_systest_class()` |

**NEVER use** `replace_string_in_file`, `edit_file`, `create_file`, `read_file`, `grep_search`, `code_search` on D365FO `.xml`/`.xpp` files.

**`overwrite=true` on `create_d365fo_file`** — ONLY for full XML replacement. NEVER for incremental changes (add-field, add-field-group, etc.) → use `modify_d365fo_file`.

**`dryRun=true` — MANDATORY for every `modify_d365fo_file` call.** Visual Studio 2022 does NOT show Keep/Undo buttons for MCP edits, so the diff must be reviewed in chat before disk is touched.

Required sequence for every modification:
1. Call `modify_d365fo_file` with `dryRun=true` → show the returned diff to the user.
2. Wait for explicit confirmation ("apply", "ok", "yes", etc.).
3. Re-call the SAME operation with `dryRun=false`.

Skip the dry-run only when the user has explicitly said "skip dryRun" / "apply directly" for the current task. Batched operations (multiple `modify_d365fo_file` calls in sequence) require dry-run for EACH call — never apply a chain of edits without per-step confirmation.

## 🌿 VS 2022 Review Workflow (Git checkpointing)

VS 2022 has no inline accept/reject UI for agent edits. Use Git as the review layer:

1. **Before starting a task** — ensure clean tree, then create a checkpoint branch:
   `git switch -c mcp/<short-task-name>` (or at minimum `git commit -am "checkpoint"` on current branch).
2. **During the task** — every `modify_d365fo_file` runs with `dryRun=true` first (see above).
3. **After the task** — review via VS 2022 → *View → Git Changes* (per-file diff, per-hunk Stage/Unstage/Discard).
4. **Accept** = commit + merge into main. **Reject** = `git restore <file>` or `git branch -D mcp/<task>`.

If the user is on `main` (or another protected branch) and asks for a non-trivial change, suggest creating a feature branch first. Do NOT create branches autonomously — propose and wait.

### ⛔ Escalating-workarounds anti-pattern — STOP at step 0

If `modify_d365fo_file` is the correct tool but you feel tempted to try something else, you are wrong. STOP.
```
WRONG SPIRAL (each step is MORE wrong):
 Step 1: "I'll use replace_string_in_file to patch the XML"
 Step 2: "replace failed — I'll try a different approach"
 Step 3: "I'll read the file with PowerShell first, then overwrite"
 Step 4: "Terminal returns no output — I'll add Write-Output"
 Step 5: "I'll use create_d365fo_file with overwrite=true"

CORRECT (always, immediately):
 modify_d365fo_file(operation="add-field-group" | "add-field" | "add-method" | …)
```
If `modify_d365fo_file` itself errors — STOP and report to user. Do NOT try PowerShell.

### `modify_d365fo_file` — full operation inventory

| Category | Operations |
|----------|------------|
| Methods | `add-method`, `remove-method`, `replace-code` |
| Fields | `add-field`, `modify-field`, `rename-field`, `replace-all-fields`, `remove-field` |
| Indexes | `add-index`, `remove-index` |
| Relations | `add-relation`, `remove-relation` |
| Field groups | `add-field-group`, `remove-field-group`, `add-field-to-field-group` |
| Table-ext | `add-field-modification` (override base-table field label/mandatory) |
| Form-ext | `add-control`, `add-data-source` |
| Any object | `modify-property` |

### modify-property examples
```
TableGroup/TableType/CacheLookup/Label/Extends → modify_d365fo_file(operation="modify-property", propertyPath="...", propertyValue="...")
```
Works for tables, table-extensions, EDTs, classes, and all object types.

### Table-extension property paths (via `modify-property`, objectType="table-extension")

`Label`, `HelpText`, `TableGroup`, `CacheLookup`, `TitleField1`, `TitleField2`, `ClusteredIndex`, `PrimaryIndex`, `SaveDataPerCompany`, `TableType`, `SystemTable`, `ModifiedDateTime`, `CreatedDateTime`, `ModifiedBy`, `CreatedBy`, `CountryRegionCodes`

### rename-field / replace-all-fields

```
Rename one field   → rename-field   fieldName="OldName"  fieldNewName="NewName"
                     (auto-fixes index DataField refs and TitleField1/2)
                     Repair-only: pass OLD corrupted name → only index refs fixed

Rewrite ALL fields → replace-all-fields  fields=[{name,edt?,type?,mandatory?,label?}, ...]
                     (use when field names contain spaces or are otherwise corrupted)
```

### TableGroup vs TableType
- **TableGroup** = business role: `Miscellaneous`|`Main`|`Transaction`|`Parameter`|`Group`|`WorksheetHeader`|`WorksheetLine`|`Reference`|`Framework`
- **TableType** = storage: `RegularTable`(default)|`TempDB`|`InMemory`
- ⛔ NEVER pass `tableGroup="TempDB"`. Use `tableType="TempDB"`, `tableGroup="Main"`.

## ⚡ TOKEN BUDGET

- `get_class_info` defaults to `compact=true` (signatures only). Max 2 calls per turn.
- Use `get_method_source(class, method)` for full bodies.
- `search_extensions` — max once per turn.

## 📣 TRANSPARENCY

VS 2022 shows only "ran tool_name" — no output. **Always** write 1 sentence before each tool call and summarize the result in 1–3 lines after.

---

## Quick Reference — Request → Tool

| Request | Tools |
|---------|-------|
| Fix bug / review | `get_class_info` → `get_method_source` → `modify_d365fo_file` |
| Where is X used? | `find_references(targetName)` |
| What can I extend? | `analyze_extension_points(objectName)` |
| Which extension mechanism? | `recommend_extension_strategy(goal)` |
| CoC extensions of X? | `find_coc_extensions(className)` |
| Event handlers for X? | `find_event_handlers(targetName)` |
| Security coverage? | `get_security_coverage_for_object(objectName)` |
| Create SSRS report | `generate_smart_report(name, fieldsHint, ...)` |
| Create CoC extension | See CoC workflow below |
| Diagnose X++ error | `get_d365fo_error_help(errorText)` |
| X++ knowledge/patterns | `get_xpp_knowledge(topic)` → `analyze_code_patterns(scenario)` |
| Create table/form | `generate_smart_table()` / `generate_smart_form()` |
| Best practices / BP check | `run_bp_check()` — NEVER manually review code with `get_method_source` |
| Build project | `build_d365fo_project()` |
| Sync database | `trigger_db_sync()` |
| Run tests | `run_systest_class()` |

---

## Non-Negotiable Rules

1. **NEVER** use built-in file/edit tools (`create_file`, `replace_string_in_file`, `read_file`, `grep_search`…) on `.xml`/`.xpp`/`.label.txt`/`.rnrproj` files — use the matching D365FO MCP tool
2. **NEVER** guess method signatures — call `get_method_signature` before CoC
3. **NEVER** call `create_d365fo_file` without `projectPath` or `solutionPath`
4. **ALWAYS** search labels with `search_labels()` first; create via `create_label()`
5. **ALWAYS** pass `fieldsHint` for tables, `primaryKeyFields` for composite PKs
6. **ALWAYS** pass `methods=["find","exist"]` to `generate_smart_table()` when needed — don't add after
7. **NEVER** include model prefix in `name` of `generate_smart_*` — auto-applied. Pass base name without prefix: `objectName="InventByZones"` + `modelName="ContosoExt"` → `ContosoExtInventByZones`.
8. **NEVER** use `get_enum_info()` for EDTs — use `get_edt_info()`
9. **NEVER** infer target model from search results — always use model from `.mcp.json`
10. Security types: `security-privilege` → `AxSecurityPrivilege`, `security-duty` → `AxSecurityDuty`, `security-role` → `AxSecurityRole` — NEVER mix
11. Class member variables go **inside** class `{ }` in `sourceCode` — outside = lost
12. **NEVER** use `today()` — use `DateTimeUtil::getToday(DateTimeUtil::getUserPreferredTimeZone())`
13. **NEVER** call functions in `WHERE` clauses — assign to variable first
14. **NEVER** use hardcoded strings in `Info()`/`warning()`/`error()` — use `@Model:Label`
15. **NEVER** nest `while select` loops — use `join` or pre-load to `Map`/temp table
16. **ALWAYS** call `create_label()` before referencing new labels in code. **Exception:** when adding a field to a table/table-extension with an EDT that already has a label defined, do **NOT** set a label on the field — the field inherits the label from the EDT automatically. Only set `label` on a field when deliberately overriding the EDT's label.
17. **ALWAYS** write meaningful `/// <summary>` on public/protected classes and methods
18. **NEVER** call `[SysObsolete]` methods — read the attribute for the replacement
19. **NEVER** switch project autonomously via `get_workspace_info(projectName=...)` — ask user
20. **ALWAYS** call `get_d365fo_error_help()` for D365FO errors — don't guess fixes
21. CoC class extension: `create_d365fo_file(objectType="class-extension", objectName="{Target}{Prefix}_Extension")`
22. Standard data events use `[DataEventHandler]` — NOT `[SubscribesTo + delegateStr]`. `delegateStr` is for custom delegates only.
23. SDLC tools (`run_bp_check`, `build_d365fo_project`, `trigger_db_sync`, `run_systest_class`) auto-detect params from `.mcp.json`. If they error about missing binaries, fix `.mcp.json`.
24. `review_workspace_changes` = git diff code review only. NOT for verifying modify/create success.
25. `get_form_info` works for ALL forms (standard + custom). If ⚠️ warning, retry with `filePath=`.
26. **NEVER run `build_d365fo_project()` automatically.** Builds block the user. After completing changes, say *"Changes applied. Run a build when you're ready to validate."* Only build on explicit request ("build", "compile", "check errors"). If the build reports X++ errors, fix them via `modify_d365fo_file` and rebuild until clean.
27. **"Check best practices" / "BP check" → ALWAYS call `run_bp_check()`**. NEVER manually iterate `get_method_source` to review code for BP compliance — the BP checker is authoritative.
28. **X++ syntax authority — Microsoft Learn.** When uncertain about X++ syntax, language constructs, framework APIs, or platform behavior, the **only** authoritative source is the Microsoft Learn `dynamics365/fin-ops-core/dev-itpro` documentation tree. Do NOT guess and do NOT rely on AX 2012 / older training data. Reference (or fetch via `fetch_webpage` if a tool is available):
    - `select` statement, joins, ranges, field lists, `firstOnly`, `forUpdate`, `pessimisticLock`, `crossCompany`: <https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-data/xpp-select-statement>
    - General developer landing page (entry point to all X++ topics): <https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-tools/developer-home-page>
    - X++ language reference root: <https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/dev-ref/xpp-language-reference>
    Combine Learn (syntax authority) with MCP tools (real metadata: table/field/method names from THIS environment). Learn for "how is `while select` written"; MCP for "does field `BalanceMST` exist on `CustTable`".

### X++ Database Query Rules (`select` / `while select`)

Follow the `select` statement contract from Microsoft Learn (link above). Key non-negotiables for generated code:

- **Field list before table** when you don't need the full row: `select FieldA, FieldB from myTable where …` — never `select * from` style.
- **`firstOnly`** when you expect at most one row (after `select`, before `from`): `select firstOnly custTable where …`.
- **`forUpdate`** required before any `.update()` / `.delete()` inside the same transaction; pair with `ttsbegin`/`ttscommit`.
- **`exists join` / `notExists join`** instead of nested `while select` for filter-only joins.
- **`outer join`** is supported but use sparingly — verify field nullability semantics on Learn.
- **Index hints**: only when you have measured a regression — never speculative.
- **Aggregates** (`sum`, `avg`, `count`, `minof`, `maxof`) require `group by` for the non-aggregated fields; verify on Learn before composing.
- **No function calls in `where`** — assign to a local variable first (rule 13).
- **No nested `while select`** — use `join` or pre-load to `Map`/temp table (rule 15).
- **`crossCompany`** must be explicit when querying across DataAreaId; default is current company only.
- **`RecordInsertList` / `insert_recordset` / `update_recordset` / `delete_from`** for set-based operations — prefer over row-by-row loops for performance.

If a query construct is requested that you have not verified against Learn in this session, STOP and either fetch the Learn page or tell the user you need to verify before generating code.

### AxClass sourceCode Format

Class member variables go **inside** the class braces; methods stay at top level of the `sourceCode` string:

```xpp
public class MyClass extends MyBase
{
    int counter;
}

public void myMethod() { ... }
```

### generate_smart_table/form — Two Success Cases

- **Azure/Linux** (response says "Azure/Linux"): tool returns XML → call `create_d365fo_file(xmlContent=..., addToProject=true)`
- **Windows** (response says "DO NOT call create_d365fo_file"): file already written → STOP

---

## Refactoring Workflow

```
1. get_class_info("Class")           → signatures (compact=true default)
2. analyze_class_completeness("Class") → missing standard methods
3. get_method_source("Class","method") → full body of methods to change
4. find_references("method")          → verify no callers break
5. modify_d365fo_file(dryRun=true)    → preview diff
6. modify_d365fo_file(dryRun=false)   → apply after user confirms
```

- NEVER delete a method without `find_references` first
- NEVER guess method bodies from signatures — read source

## CoC Extension Workflow

```
1. analyze_extension_points("Target")
2. get_method_signature("Target", "method", includeCocTemplate: true)
3. create_d365fo_file(objectType="class-extension", objectName="Target_Extension", ...)
4. modify_d365fo_file(operation="add-method", sourceCode="<CoC skeleton>")
```

## Table Extension Workflow

```
1. get_table_extension_info("Table")  → existing extensions
2. create_d365fo_file(objectType="table-extension", objectName="Table.PrefixExt", addToProject=true)
3. modify_d365fo_file(operation="add-field" | "add-index" | "add-field-group" | ...)
```

## Form Extension Workflow

```
1. get_form_info("Form", searchControl="TabName")  → exact control names
2. create_d365fo_file(objectType="form-extension", objectName="Form.MyExt", addToProject=true)
3. modify_d365fo_file(operation="add-control", parentControl="Tab", controlDataField="Field", ...)
```

## Event Handler Workflow

```
1. find_event_handlers("Table")       → existing handlers
2. create_d365fo_file(objectType="class", objectName="TableEventHandler", ...)
3. Standard events:  [DataEventHandler(tableStr(T), DataEventType::Inserted)]
   Custom delegates: [SubscribesTo(tableStr(T), delegateStr(T, myDelegate))]
```

## SSRS Report Workflow

**Preferred:** `generate_smart_report(name, fieldsHint, caption, contractParams)` — generates all 5 objects.

**Manual order:** TmpTable → Contract → DP class → Controller → Report (via `create_d365fo_file(objectType="report", xmlContent=...)`)

---

## Labels

1. `search_labels(query)` — always search first
2. `create_label(labelId, labelFileId, model, translations, createLabelFileIfMissing: true)` — creates label + project entry
3. `rename_label(oldLabelId, newLabelId, ...)` — renames across files

- Label IDs describe meaning, NOT model: ✅ `CustomerName` ❌ `MyModelCustomerName`
- Pass `createLabelFileIfMissing: true` on first use in a model

## Available `generate_code` Patterns

`batch-job`, `sysoperation`, `table-extension`, `class-extension`, `event-handler`, `security-privilege`, `menu-item`, `data-entity`, `ssrs-report-full`, `lookup-form`, `form-handler`, `form-datasource-extension`, `form-control-extension`, `map-extension`, `dialog-box`, `dimension-controller`, `number-seq-handler`, `display-menu-controller`, `data-entity-staging`, `service-class-ais`, `business-event`, `custom-telemetry`, `feature-class`, `composite-entity`, `custom-service`, `er-custom-function`

## Available `generate_smart_form` Patterns

`SimpleList`, `SimpleListDetails`, `DetailsMaster`, `DetailsTransaction`, `Dialog`, `TableOfContents`, `Lookup`, `ListPage`, `Workspace`

## File Paths

AOT: `C:\AOSService\PackagesLocalDirectory\{Model}\{Model}\Ax{Type}\{Name}.xml`

Always provide `projectPath` in `create_d365fo_file` — auto-extracts model from `.rnrproj`.

