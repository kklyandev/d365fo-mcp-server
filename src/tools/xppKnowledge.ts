/**
 * X++ Knowledge Base Tool
 * Queryable knowledge base of D365FO / X++ patterns, best practices,
 * and AX2012 → D365FO migration guidance.
 *
 * Data is embedded — no DB or disk access needed. Available in all server modes.
 */

import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// ─── Schema ─────────────────────────────────────────────────────────────────

const XppKnowledgeArgsSchema = z.object({
  topic: z.string().describe(
    'Topic to query — e.g. "batch job", "ttsbegin", "RunBase vs SysOperation", ' +
    '"set-based operations", "CoC", "data entities", "number sequences", "security", ' +
    '"temp tables", "today() deprecated", "query patterns", "form patterns"'
  ),
  format: z.enum(['concise', 'detailed']).optional().default('concise').describe(
    'concise = quick reference (default), detailed = full explanation with code examples'
  ),
});

export const xppKnowledgeToolDefinition = {
  name: 'get_xpp_knowledge',
  description:
    'Queryable knowledge base of D365FO X++ patterns, best practices, and AX2012→D365FO migration guidance. ' +
    'Returns distilled, verified patterns with code examples. Use BEFORE generating code to avoid deprecated ' +
    'APIs and AX2012 anti-patterns. Topics: batch jobs, transactions, queries, CoC/extensions, security, ' +
    'data entities, temp tables, number sequences, form patterns, set-based operations, error handling, ' +
    'SysOperation framework, and more.',
  inputSchema: XppKnowledgeArgsSchema,
};

// ─── Knowledge Entry Type ───────────────────────────────────────────────────

interface KnowledgeEntry {
  id: string;
  title: string;
  /** Search keywords (lowercase) for matching */
  keywords: string[];
  /** One-paragraph summary */
  summary: string;
  /** AX2012 anti-pattern → D365FO correct pattern */
  migration?: { ax2012: string; d365fo: string };
  /** Concise bullet-point rules */
  rules: string[];
  /** Code examples (shown in detailed mode) */
  examples?: { label: string; code: string }[];
  /** Related entry IDs */
  related?: string[];
}

// ─── Knowledge Base ─────────────────────────────────────────────────────────

const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  // ── Batch / SysOperation ────────────────────────────────────────────────
  {
    id: 'sysoperation',
    title: 'SysOperation Framework (replaces RunBase)',
    keywords: ['batch', 'sysoperation', 'runbase', 'batch job', 'dialog', 'contract', 'controller', 'service', 'srsreportruncontroller'],
    summary:
      'D365FO uses the SysOperation framework for batch-capable operations. ' +
      'RunBase still works but is legacy — new code should always use SysOperation. ' +
      'The framework separates concerns: DataContract (parameters), Service (logic), Controller (execution).',
    migration: {
      ax2012: 'class MyBatch extends RunBaseBatch { dialog(), run(), pack/unpack }',
      d365fo: 'DataContract + Service class + Controller (or just [SysEntryPointAttribute] service)',
    },
    rules: [
      'New batch jobs: ALWAYS use SysOperation (DataContract + Service + Controller)',
      'RunBase is legacy — only extend existing RunBase classes, never create new ones',
      'DataContract: decorate with [DataContractAttribute], parm methods with [DataMemberAttribute]',
      'Service: business logic class, no UI references',
      'Controller: extends SysOperationServiceController, sets caption, calls service',
      'For simple batch: controller.parmClassName / parmMethodName can point directly to a static method',
      'Menu items: type = Action, point to Controller class',
    ],
    examples: [
      {
        label: 'DataContract',
        code: `[DataContractAttribute]
class MyProcessContract
{
    TransDate   fromDate;
    TransDate   toDate;

    [DataMemberAttribute,
     SysOperationLabelAttribute(literalStr("@MyModel:FromDate")),
     SysOperationDisplayOrderAttribute('1')]
    public TransDate parmFromDate(TransDate _fromDate = fromDate)
    {
        fromDate = _fromDate;
        return fromDate;
    }

    [DataMemberAttribute,
     SysOperationLabelAttribute(literalStr("@MyModel:ToDate")),
     SysOperationDisplayOrderAttribute('2')]
    public TransDate parmToDate(TransDate _toDate = toDate)
    {
        toDate = _toDate;
        return toDate;
    }
}`,
      },
      {
        label: 'Service',
        code: `class MyProcessService
{
    /// <summary>
    /// Processes records within the specified date range.
    /// </summary>
    public void processRecords(MyProcessContract _contract)
    {
        TransDate fromDate = _contract.parmFromDate();
        TransDate toDate   = _contract.parmToDate();

        // Business logic here
    }
}`,
      },
      {
        label: 'Controller',
        code: `class MyProcessController extends SysOperationServiceController
{
    /// <summary>
    /// Constructs the controller for the batch operation.
    /// </summary>
    public static MyProcessController construct()
    {
        MyProcessController controller = new MyProcessController();
        controller.parmClassName(classStr(MyProcessService));
        controller.parmMethodName(methodStr(MyProcessService, processRecords));
        return controller;
    }

    public static void main(Args _args)
    {
        MyProcessController controller = MyProcessController::construct();
        controller.parmDialogCaption("@MyModel:ProcessRecords");
        controller.startOperation();
    }
}`,
      },
    ],
    related: ['transactions', 'error-handling'],
  },

  // ── Transactions ────────────────────────────────────────────────────────
  {
    id: 'transactions',
    title: 'Transaction Handling (ttsbegin / ttscommit)',
    keywords: ['tts', 'ttsbegin', 'ttscommit', 'ttsabort', 'transaction', 'concurrency', 'occ', 'optimistic concurrency', 'update conflict'],
    summary:
      'X++ uses ttsbegin/ttscommit for transaction scoping. Transactions are nestable (reference-counted). ' +
      'OCC (Optimistic Concurrency Control) is the default — always handle UpdateConflict exceptions.',
    rules: [
      'ALWAYS pair ttsbegin with ttscommit — unbalanced calls cause runtime crash',
      'NEVER put try/catch INSIDE ttsbegin..ttscommit — transaction is already rolled back when exception is caught',
      'Put try/catch OUTSIDE the tts block, catch UpdateConflict, then retry',
      'Use forupdate keyword on select when modifying records',
      'Use pessimisticlock for high-concurrency scenarios (e.g. number sequences)',
      'NEVER call ttsabort() as normal flow — it\'s for unrecoverable situations only',
      'Set-based operations (update_recordset, insert_recordset) run inside implicit tts if not explicitly scoped',
      'Maximum retry count for OCC: typically 5 (use a counter variable)',
    ],
    examples: [
      {
        label: 'Correct OCC retry pattern',
        code: `int retryCount = 0;
const int maxRetries = 5;
boolean success = false;

while (!success && retryCount < maxRetries)
{
    try
    {
        ttsbegin;
        CustTable custTable;
        select forupdate custTable
            where custTable.AccountNum == '1001';
        custTable.CreditMax = 10000;
        custTable.update();
        ttscommit;
        success = true;
    }
    catch (Exception::UpdateConflict)
    {
        retryCount++;
        if (retryCount >= maxRetries)
        {
            throw Exception::UpdateConflictNotRecovered;
        }
        // retry — loop continues
    }
}`,
      },
      {
        label: 'WRONG — try/catch inside tts',
        code: `// ❌ NEVER DO THIS — transaction is already rolled back
ttsbegin;
try
{
    custTable.update();
}
catch
{
    // tts is already broken — this does NOT help
}
ttscommit; // ← will crash: tts level mismatch`,
      },
    ],
    related: ['set-based', 'error-handling'],
  },

  // ── Set-Based Operations ────────────────────────────────────────────────
  {
    id: 'set-based',
    title: 'Set-Based Operations (insert_recordset, update_recordset, delete_from)',
    keywords: ['set-based', 'insert_recordset', 'update_recordset', 'delete_from', 'recordinsertlist', 'bulk', 'performance', 'record by record'],
    summary:
      'Set-based operations execute in a single SQL statement instead of row-by-row. ' +
      'They are 10-100x faster for bulk operations. D365FO adds RecordInsertList for batch inserts.',
    migration: {
      ax2012: 'while select + insert/update/delete in a loop (record-by-record)',
      d365fo: 'insert_recordset / update_recordset / delete_from / RecordInsertList',
    },
    rules: [
      'ALWAYS prefer set-based operations over while-select + DML loops',
      'insert_recordset: bulk insert from one table to another with field mapping',
      'update_recordset: bulk update with WHERE clause, no row-by-row fetch needed',
      'delete_from: bulk delete with WHERE clause',
      'RecordInsertList: use when constructing records in code (not from another table)',
      'RecordInsertList.add() → insertDatabase() at the end — single round-trip',
      'Set-based operations skip insert/update/delete overrides — call skipDatabaseLog, skipDataMethods, etc. only when safe',
      'If table has overridden insert()/update()/delete(), set-based falls back to row-by-row unless you call skipDataMethods(true)',
      'BP rule: BPCheckNestedLoopinCode — NEVER nest while-select inside another while-select; use joins instead',
    ],
    examples: [
      {
        label: 'update_recordset',
        code: `update_recordset custTable
    setting CreditMax = 0
    where custTable.Blocked == CustVendorBlocked::All;`,
      },
      {
        label: 'insert_recordset',
        code: `insert_recordset tmpTable (AccountNum, Name)
    select AccountNum, Name
    from custTable
    where custTable.CustGroup == 'DOM';`,
      },
      {
        label: 'RecordInsertList',
        code: `RecordInsertList insertList = new RecordInsertList(tableNum(MyTmpTable));
MyTmpTable tmp;

while select custTable
    where custTable.CustGroup == 'DOM'
{
    tmp.clear();
    tmp.AccountNum = custTable.AccountNum;
    tmp.Name       = custTable.Name;
    insertList.add(tmp);
}

insertList.insertDatabase();`,
      },
    ],
    related: ['transactions', 'query-patterns'],
  },

  // ── Query Patterns ──────────────────────────────────────────────────────
  {
    id: 'query-patterns',
    title: 'Query Patterns & Select Statements',
    keywords: ['query', 'select', 'while select', 'join', 'exists join', 'notexists join', 'outer join', 'firstonly', 'firstfast', 'forceplaceholders', 'forceselectorder', 'index hint', 'crosscompany'],
    summary:
      'X++ select statements support joins, aggregates, and query hints. ' +
      'Use exists join for filtering, outer join for optional data, firstonly for single records.',
    rules: [
      'Use firstonly when you need exactly one record — avoids full table scan',
      'Use exists join (not inner join) when you only need to check existence from the joined table',
      'Use notexists join for "does not exist" conditions',
      'Avoid nested while-select loops — use joins in a single select instead',
      'crosscompany keyword: use for cross-company queries, pass container of companies',
      'forceplaceholders: use in batch operations to get parameterized SQL plans',
      'forceselectorder: use only when you know the optimizer picks a wrong plan',
      'index hint: last resort — prefer letting the optimizer choose',
      'SysQuery class: use for building dynamic query objects (QueryBuildRange, QueryBuildDataSource)',
      'QueryRun: use for executing query objects, supports prompt() for user dialog',
    ],
    examples: [
      {
        label: 'exists join',
        code: `CustTable custTable;
CustTrans custTrans;

while select AccountNum, Name from custTable
    exists join custTrans
        where custTrans.AccountNum == custTable.AccountNum
           && custTrans.TransDate  >= today() - 30
{
    info(strFmt('%1 - %2', custTable.AccountNum, custTable.Name));
}`,
      },
      {
        label: 'SysQuery dynamic range',
        code: `Query query = new Query(queryStr(CustTableListPage));
QueryBuildDataSource qbds = query.dataSourceTable(tableNum(CustTable));
SysQuery::findOrCreateRange(qbds, fieldNum(CustTable, CustGroup)).value('DOM');
QueryRun qr = new QueryRun(query);

while (qr.next())
{
    CustTable custTable = qr.get(tableNum(CustTable));
    // process record
}`,
      },
    ],
    related: ['set-based', 'performance'],
  },

  // ── Chain of Command ────────────────────────────────────────────────────
  {
    id: 'coc',
    title: 'Chain of Command (CoC) Extensions',
    keywords: ['coc', 'chain of command', 'extension', 'extensionof', 'next', 'wrapping', 'overlay', 'overlayer', 'overlayering'],
    summary:
      'CoC replaces overlayering (which is completely blocked in D365FO). ' +
      'Extension classes wrap methods by calling next to invoke the original + other extensions.',
    migration: {
      ax2012: 'Overlayering: modify the original class/method directly in the same layer',
      d365fo: 'CoC: [ExtensionOf(classStr(Original))] final class Original_Extension { method() { next method(); } }',
    },
    rules: [
      'Extension class MUST be [ExtensionOf(classStr/tableStr/formStr(Target))]',
      'Extension class MUST be final',
      'Method signature MUST match the original exactly (use get_method_signature tool)',
      'ALWAYS call next <methodName>() — skipping it breaks the chain for other extensions',
      'Cannot access private members of the original class',
      'Can wrap: public, protected methods; cannot wrap: private, static',
      'For static methods: use [PostHandlerFor] / [PreHandlerFor] event handlers instead',
      'Naming: <TargetClass>_<YourModel>_Extension (e.g. SalesTable_ContosoExt_Extension)',
      'Form CoC: [ExtensionOf(formStr(CustTable))] — wraps form methods like init(), run()',
      'Form datasource CoC: wrap datasource methods like init(), validateWrite()',
    ],
    examples: [
      {
        label: 'Table method CoC',
        code: `[ExtensionOf(tableStr(CustTable))]
final class CustTable_MyModel_Extension
{
    /// <summary>
    /// Adds custom validation for credit limit.
    /// </summary>
    public boolean validateWrite()
    {
        boolean ret = next validateWrite();

        if (ret && this.CreditMax > 1000000)
        {
            ret = checkFailed("@MyModel:CreditLimitExceeded");
        }

        return ret;
    }
}`,
      },
      {
        label: 'Class method CoC',
        code: `[ExtensionOf(classStr(SalesFormLetter))]
final class SalesFormLetter_MyModel_Extension
{
    /// <summary>
    /// Extends posting logic with custom dimension validation.
    /// </summary>
    protected void postInvoice()
    {
        // Pre-processing
        this.myValidateDimensions();

        next postInvoice();

        // Post-processing
        this.myUpdateCustomStatus();
    }
}`,
      },
    ],
    related: ['event-handlers', 'form-patterns'],
  },

  // ── Event Handlers ──────────────────────────────────────────────────────
  {
    id: 'event-handlers',
    title: 'Event Handlers & Delegates',
    keywords: ['event', 'handler', 'delegate', 'dataeventhandler', 'subscribesto', 'prehandlerfor', 'posthandlerfor', 'on inserting', 'on inserted', 'on validating', 'on validated'],
    summary:
      'Event handlers subscribe to table data events, class delegates, or pre/post method events. ' +
      'Use when CoC is not possible (static methods, or when you need fire-and-forget).',
    rules: [
      'Table data events: use [DataEventHandler(tableStr(X), DataEventType::Inserted)]',
      'Data event types: Inserting, Inserted, Updating, Updated, Deleting, Deleted, ValidatedWrite, ValidatedDelete, ValidatingWrite, ValidatingDelete, etc.',
      'Custom delegates: use [SubscribesTo(classStr(X), delegateStr(X, myDelegate))]',
      'Pre/Post: use [PreHandlerFor(classStr(X), methodStr(X, myMethod))] or PostHandlerFor',
      'Handler methods MUST be static void',
      'DataEventHandler signature: static void handler(Common _sender, DataEventArgs _e)',
      'Validating events: cast _e to ValidateEventArgs, call _e.parmValidateResult(false) to fail',
      'NEVER use SubscribesTo + delegateStr for standard table data events — use DataEventHandler',
    ],
    examples: [
      {
        label: 'Table data event handler',
        code: `class CustTableEventHandler
{
    [DataEventHandler(tableStr(CustTable), DataEventType::Inserting)]
    public static void onInserting(Common _sender, DataEventArgs _e)
    {
        CustTable custTable = _sender as CustTable;
        // Set default values before insert
        if (!custTable.CreditMax)
        {
            custTable.CreditMax = 5000;
        }
    }

    [DataEventHandler(tableStr(CustTable), DataEventType::ValidatingWrite)]
    public static void onValidatingWrite(Common _sender, DataEventArgs _e)
    {
        ValidateEventArgs validateArgs = _e as ValidateEventArgs;
        CustTable custTable = _sender as CustTable;

        if (custTable.CreditMax > 1000000)
        {
            validateArgs.parmValidateResult(
                checkFailed("@MyModel:CreditLimitExceeded"));
        }
    }
}`,
      },
    ],
    related: ['coc'],
  },

  // ── Data Entities ───────────────────────────────────────────────────────
  {
    id: 'data-entities',
    title: 'Data Entities & OData',
    keywords: ['data entity', 'odata', 'integration', 'import', 'export', 'dmf', 'data management', 'aif', 'composite entity', 'staging'],
    summary:
      'Data entities replace AIF document services. They provide a single contract for import/export/OData. ' +
      'Entity = virtual table backed by one or more real tables with field mappings.',
    migration: {
      ax2012: 'AIF Document Services (AxdSalesOrder), custom services',
      d365fo: 'Data entities + OData endpoints + Data Management Framework (DMF)',
    },
    rules: [
      'Data entity = view + insert/update/delete logic mapped to underlying tables',
      'Primary data source: the "root" table (e.g. CustTable for CustCustomerV3Entity)',
      'IsPublic = Yes: exposes as OData endpoint at /data/EntityNamePlural',
      'Staging table: auto-generated for DMF import/export — name is <Entity>Staging',
      'Entity category: Document (header+lines), Master (single table), Reference, Transaction, Parameter',
      'Use AutoIdentification field group for natural key (maps to AlternateKey)',
      'Mapping: entity fields map to data source fields — handle computed/unmapped columns via virtual fields + postLoad/mapEntityToDataSource',
      'Composite entity: wraps multiple entities for header+lines import (e.g. SalesOrderV2 + SalesOrderLine)',
      'NEVER create AIF document services in D365FO — always use data entities',
    ],
    related: ['query-patterns'],
  },

  // ── Temp Tables ─────────────────────────────────────────────────────────
  {
    id: 'temp-tables',
    title: 'Temporary Tables (TempDB vs InMemory)',
    keywords: ['temp', 'temporary', 'tempdb', 'inmemory', 'tmp', 'report', 'ssrs'],
    summary:
      'D365FO has two types of temp tables: TempDB (SQL Server tempdb) and InMemory (ISAM client-side). ' +
      'TempDB is almost always preferred. InMemory is legacy from AX 2009.',
    migration: {
      ax2012: 'Table property Temporary=Yes → InMemory temp table',
      d365fo: 'TableType=TempDB (preferred) or TableType=InMemory (legacy)',
    },
    rules: [
      'TempDB: stored in SQL Server tempdb — supports efficient joins and set-based operations',
      'InMemory: ISAM file on AOS tier — joins and set-based operations are SLOW',
      'SSRS reports: ALWAYS use TempDB for report temp tables (SRSTmpTable pattern)',
      'TempDB tables: scoped to the session/method — automatically dropped when no longer referenced',
      'TempDB supports insert_recordset, update_recordset, delete_from — InMemory does NOT',
      'To pass TempDB data between tiers: use container or RecordSortedList',
      'TableType is NOT the same as TableGroup — TableType=TempDB, TableGroup=Main/Transaction/etc.',
      'Default TableType is RegularTable (permanent) — omit from XML for regular tables',
    ],
    examples: [
      {
        label: 'TempDB table for SSRS report',
        code: `// Table definition: TableType = TempDB, TableGroup = Main
// Fields: ItemId (EDT: ItemId), ItemName (EDT: ItemName), Qty (EDT: Qty)

// In the DP class:
[SRSReportParameterAttribute(classStr(MyReportContract))]
class MyReportDP extends SRSReportDataProviderBase
{
    MyReportTmp tmpTable;

    [SRSReportDataSetAttribute(tableStr(MyReportTmp))]
    public MyReportTmp getMyReportTmp()
    {
        select tmpTable;
        return tmpTable;
    }

    public void processReport()
    {
        MyReportContract contract = this.parmDataContract() as MyReportContract;
        this.populateTmpTable(contract);
    }
}`,
      },
    ],
    related: ['sysoperation', 'set-based'],
  },

  // ── Error Handling ──────────────────────────────────────────────────────
  {
    id: 'error-handling',
    title: 'Error Handling Patterns',
    keywords: ['error', 'exception', 'try', 'catch', 'throw', 'info', 'warning', 'checkfailed', 'infolog', 'global', 'clrcreatedexception'],
    summary:
      'X++ uses a structured exception model with mandatory labels for all user-facing messages.',
    rules: [
      'ALWAYS use label references in info(), warning(), error() — never hardcoded strings (BPErrorLabelIsText)',
      'checkFailed(): posts error to infolog AND returns false — use in validateWrite/validateField',
      'Return pattern: ret = ret && checkFailed("@Label:Message") — accumulates all errors before returning',
      'Exception types: Error, Warning, Info, Deadlock, UpdateConflict, DuplicateKeyConflict, CLRError',
      'Catch specific exceptions — avoid bare catch without type',
      'CLR interop: catch(Exception::CLRError) then use CLRInterop::getLastException() for details',
      'Global::error() = same as error() — both post to infolog',
      'NEVER swallow exceptions silently — at minimum log them',
      'After catching UpdateConflict: retry or throw UpdateConflictNotRecovered',
    ],
    examples: [
      {
        label: 'validateWrite pattern',
        code: `public boolean validateWrite()
{
    boolean ret = super();

    ret = ret && this.AccountNum
        ? true
        : checkFailed("@MyModel:AccountNumRequired");

    ret = ret && this.CreditMax >= 0
        ? true
        : checkFailed("@MyModel:CreditMaxNegative");

    return ret;
}`,
      },
    ],
    related: ['transactions', 'labels'],
  },

  // ── Labels ──────────────────────────────────────────────────────────────
  {
    id: 'labels',
    title: 'Labels & Localization',
    keywords: ['label', 'localization', 'translation', 'literalstr', 'strfmt', 'bperrorlabelistext', 'hardcoded'],
    summary:
      'Every user-visible string MUST be a label. D365FO enforces this via BP rule BPErrorLabelIsText.',
    rules: [
      'ALL user-facing text must use labels: @ModelName:LabelId',
      'BP check BPErrorLabelIsText fires on any hardcoded string in info/warning/error/dialog',
      'Label ID naming: describe the MEANING, no model prefix (e.g. CustomerName, not ContosoExtCustomerName)',
      'Label file: the prefix comes from the file name (e.g. @ContosoExt:CustomerName)',
      'Use strFmt() for parameterized messages: strFmt("@MyModel:ItemNotFound", itemId)',
      'Use literalStr() when BP complains about strFmt argument not being a label — wraps non-label string safely',
      'search_labels() before create_label() — avoid duplicates',
      'Provide translations for all required languages in create_label()',
    ],
    related: ['error-handling'],
  },

  // ── Deprecated APIs ─────────────────────────────────────────────────────
  {
    id: 'deprecated',
    title: 'Deprecated APIs & Replacements',
    keywords: ['deprecated', 'obsolete', 'sysobsolete', 'today', 'curext', 'infolog', 'fieldnum', 'aif'],
    summary:
      'D365FO deprecates many AX2012 APIs. Using deprecated APIs triggers BP warnings/errors.',
    rules: [
      'today() → DateTimeUtil::getToday(DateTimeUtil::getUserPreferredTimeZone()) — BPUpgradeCodeToday',
      'curext() → use Ledger::primaryForLegalEntity(CompanyInfo::findDataArea(curext()).RecId)',
      'AIF services → Data entities + OData',
      'RunBase → SysOperation framework',
      'display/edit methods on forms → computed columns or data entity virtual fields',
      'infolog.add() → info()/warning()/error() global functions',
      'fieldnum(tableName, fieldName) → still valid but use fieldNum() macro for compile-time safety',
      '[SysObsolete] attribute: ALWAYS read the message — it names the replacement',
      'When get_method_source returns a method with [SysObsolete], do NOT call it — use the stated replacement',
    ],
    related: ['labels', 'data-entities', 'sysoperation'],
  },

  // ── Number Sequences ────────────────────────────────────────────────────
  {
    id: 'number-sequences',
    title: 'Number Sequences',
    keywords: ['number sequence', 'numberseq', 'numseq', 'voucher', 'continuous', 'scope', 'numbersequencereference'],
    summary:
      'Number sequences generate unique, configurable identifiers for master data and transactions. ' +
      'They support scope (shared, company, legal entity) and format segments.',
    rules: [
      'Define in NumberSequenceModuleXxx class (e.g. NumberSequenceModuleCustPaym)',
      'loadModule() method: register each number sequence reference with its EDT, label, and scope',
      'Use NumberSeqFormHandler on forms for auto-number behavior',
      'Continuous sequences: no gaps allowed — performance impact, use only when legally required',
      'Non-continuous (default): allows gaps — faster, use for internal IDs',
      'Call NumberSeq::newGetNum() to fetch next number at runtime',
      'Scope: DataArea (per-company), Global (cross-company), OperatingUnit',
      'Format: {Company}-{NumberSequence:#######} — configurable in Number sequences form',
    ],
    examples: [
      {
        label: 'Fetching next number',
        code: `NumberSequenceReference numSeqRef =
    NumberSeqReference::findReference(
        extendedTypeNum(MyDocumentId));

NumberSeq numSeq = NumberSeq::newGetNum(numSeqRef);
MyDocumentId newId = numSeq.num();

// If insert fails, release the number:
// numSeq.abort();`,
      },
    ],
    related: ['transactions'],
  },

  // ── Form Patterns ───────────────────────────────────────────────────────
  {
    id: 'form-patterns',
    title: 'Form Patterns & Form Extensions',
    keywords: ['form', 'pattern', 'simplelist', 'simplelistdetails', 'detailsmaster', 'detailstransaction', 'listpage', 'dialog', 'lookup', 'formrun', 'formextension'],
    summary:
      'D365FO forms follow standard patterns enforced by the form pattern dialog. ' +
      'Extensions add controls/overrides without modifying the original form.',
    rules: [
      'Standard patterns: SimpleList, SimpleListDetails, DetailsMaster, DetailsTransaction, Dialog, ListPage, TableOfContents, Lookup',
      'ALWAYS use form extensions — never modify standard forms (overlayering is blocked)',
      'Form extension file: AxFormExtension XML — holds new controls, data sources, property overrides',
      'Form extension class: [ExtensionOf(formStr(Target))] — holds CoC logic for form methods',
      'Use get_form_info(formName, searchControl="...") to find exact control names before extending',
      'New controls: add via modify_d365fo_file(operation="add-control", parentControl="TabGeneral")',
      'Data sources: add via modify_d365fo_file(operation="add-data-source")',
      'NEVER use PowerShell or read_file to inspect form XML — use get_form_info',
    ],
    related: ['coc', 'event-handlers'],
  },

  // ── Security ────────────────────────────────────────────────────────────
  {
    id: 'security',
    title: 'Security Model (Roles, Duties, Privileges)',
    keywords: ['security', 'role', 'duty', 'privilege', 'entry point', 'permission', 'policy', 'xds', 'extensible data security'],
    summary:
      'D365FO uses Role → Duty → Privilege → Entry Point security model. ' +
      'Privileges grant access to specific menu items (entry points).',
    rules: [
      'Hierarchy: Role contains Duties, Duty contains Privileges, Privilege contains Entry Points',
      'Entry Point = menu item (Display, Output, Action) at a specific access level (Read, Update, Create, Delete)',
      'Create separate privilege for each access level: MyFormView (Read), MyFormMaintain (Update)',
      'Duty = business function: "Maintain customer records" → groups related privileges',
      'Role = job function: "Accounts receivable clerk" → groups duties',
      'Table permissions: set on the privilege entry point, cascading to related tables',
      'XDS (Extensible Data Security): row-level security policies',
      'Use get_security_coverage_for_object() to check what covers a form/table/menu item',
      'Use get_security_artifact_info() to inspect a role/duty/privilege hierarchy',
    ],
    related: ['form-patterns'],
  },

  // ── Performance ─────────────────────────────────────────────────────────
  {
    id: 'performance',
    title: 'Performance Best Practices',
    keywords: ['performance', 'cache', 'index', 'trace', 'sql trace', 'batch', 'async', 'recordinsertlist'],
    summary:
      'D365FO performance: use set-based operations, proper indexes, caching, and batch processing.',
    rules: [
      'Set-based > row-by-row: ALWAYS use insert_recordset/update_recordset/delete_from when possible',
      'RecordInsertList: for batch insert of constructed records',
      'CacheLookup: Found (most common), FoundAndEmpty, EntireTable (small reference tables only)',
      'Index: every WHERE clause field should be covered by an index; check with SQL trace',
      'firstonly/firstfast: use on single-record lookups — avoid scanning entire table',
      'exists join over inner join: when you don\'t need columns from the joined table',
      'Avoid nested while-select loops — flatten to a single select with joins',
      'Batch parallelism: use SysOperationServiceController.parmExecutionMode(SysOperationExecutionMode::ScheduledBatch)',
      'Use container or SysGlobalObjectCache for cross-call caching',
    ],
    related: ['set-based', 'query-patterns'],
  },

  // ── Testing ─────────────────────────────────────────────────────────────
  {
    id: 'testing',
    title: 'Unit Testing (SysTest Framework)',
    keywords: ['test', 'unit test', 'systest', 'systestcase', 'assert', 'atl', 'acceptance test library', 'mock'],
    summary:
      'D365FO uses SysTestCase for unit tests and ATL (Acceptance Test Library) for integration tests.',
    rules: [
      'Test class: extends SysTestCase — must have methods starting with "test"',
      'SysTestMethodAttribute: [SysTestMethod] on each test method',
      'Assert methods: this.assertEquals(), this.assertTrue(), this.assertFalse(), this.assertNotNull()',
      'setUp() / tearDown(): run before/after each test method',
      'ATL classes: AtlScenario, AtlCommand — for high-level business process tests',
      'Test data: use AtlDataHelper or setUp() to create transient test records',
      'Run with: run_systest_class MCP tool or Visual Studio Test Explorer',
      'Naming: <TestedClass>Test (e.g. CustTableTest)',
    ],
    examples: [
      {
        label: 'Basic unit test',
        code: `[SysTestTarget(classStr(MyHelper), MethodStr(MyHelper, calculateDiscount))]
class MyHelperTest extends SysTestCase
{
    [SysTestMethod]
    public void testCalculateDiscount_ZeroQty()
    {
        MyHelper helper = new MyHelper();
        Amount result = helper.calculateDiscount(0, 100);
        this.assertEquals(0, result, 'Discount should be 0 for zero quantity');
    }

    [SysTestMethod]
    public void testCalculateDiscount_LargeQty()
    {
        MyHelper helper = new MyHelper();
        Amount result = helper.calculateDiscount(100, 50);
        this.assertTrue(result > 0, 'Discount should be positive for large qty');
    }
}`,
      },
    ],
    related: ['sysoperation'],
  },

  // ── SSRS Reports ────────────────────────────────────────────────────────
  {
    id: 'ssrs-reports',
    title: 'SSRS Reports (DP → TmpTable → RDL)',
    keywords: ['ssrs', 'report', 'rdl', 'dp class', 'data provider', 'srsreportdataproviderbase', 'contract', 'controller', 'design'],
    summary:
      'D365FO SSRS reports use: TmpTable (TempDB) → DataContract → DP class → Controller → AxReport with RDL design.',
    rules: [
      '5 objects: TmpTable (TempDB), Contract (DataContractAttribute), DP (extends SRSReportDataProviderBase), Controller (extends SrsReportRunController), AxReport XML',
      'TmpTable: MUST be TableType=TempDB (NOT InMemory) — required for SSRS data connection',
      'DP class: [SRSReportParameterAttribute(classStr(MyContract))], processReport() fills TmpTable',
      'DP getter: [SRSReportDataSetAttribute(tableStr(MyTmp))] public MyTmp getMyTmp()',
      'Controller: sets report name via ssrsReportStr(), opens dialog, runs report',
      'AxReport XML: DataSet with DataSourceType=ReportDataProvider, Query=SELECT * FROM DPClass.TmpTable',
      'Use generate_smart_report MCP tool to generate all 5 objects at once',
      'For existing reports, use get_report_info() — NEVER read report XML with PowerShell',
    ],
    related: ['temp-tables', 'sysoperation'],
  },
];

// ─── Search Logic ───────────────────────────────────────────────────────────

function scoreEntry(entry: KnowledgeEntry, queryTokens: string[]): number {
  let score = 0;
  const titleLower = entry.title.toLowerCase();
  const summaryLower = entry.summary.toLowerCase();

  for (const token of queryTokens) {
    // Exact keyword match (highest weight)
    if (entry.keywords.some(k => k === token)) score += 10;
    // Partial keyword match
    else if (entry.keywords.some(k => k.includes(token) || token.includes(k))) score += 5;
    // Title match
    if (titleLower.includes(token)) score += 3;
    // Summary match
    if (summaryLower.includes(token)) score += 1;
    // ID match
    if (entry.id === token) score += 15;
  }

  return score;
}

function searchKnowledge(topic: string): KnowledgeEntry[] {
  const tokens = topic
    .toLowerCase()
    .replace(/[^a-z0-9áčďéěíňóřšťúůýž_\-/\s]/g, '')
    .split(/[\s,;/]+/)
    .filter(t => t.length > 1);

  if (tokens.length === 0) {
    // Return all entries sorted alphabetically
    return [...KNOWLEDGE_BASE].sort((a, b) => a.title.localeCompare(b.title));
  }

  const scored = KNOWLEDGE_BASE
    .map(entry => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(s => s.entry);
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatConcise(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) {
    return '❌ No matching knowledge entries found.\n\nAvailable topics:\n' +
      KNOWLEDGE_BASE.map(e => `- \`${e.id}\`: ${e.title}`).join('\n');
  }

  const parts: string[] = [];

  for (const entry of entries.slice(0, 5)) {
    parts.push(`## ${entry.title}\n`);
    parts.push(`${entry.summary}\n`);

    if (entry.migration) {
      parts.push(`**AX2012:** ${entry.migration.ax2012}`);
      parts.push(`**D365FO:** ${entry.migration.d365fo}\n`);
    }

    parts.push('**Rules:**');
    for (const rule of entry.rules) {
      parts.push(`- ${rule}`);
    }

    if (entry.related && entry.related.length > 0) {
      parts.push(`\n_Related: ${entry.related.join(', ')}_`);
    }

    parts.push('');
  }

  if (entries.length > 5) {
    parts.push(`_...and ${entries.length - 5} more entries. Use a more specific query to narrow results._`);
  }

  return parts.join('\n');
}

function formatDetailed(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) {
    return '❌ No matching knowledge entries found.\n\nAvailable topics:\n' +
      KNOWLEDGE_BASE.map(e => `- \`${e.id}\`: ${e.title}`).join('\n');
  }

  const parts: string[] = [];

  for (const entry of entries.slice(0, 3)) {
    parts.push(`# ${entry.title}\n`);
    parts.push(`${entry.summary}\n`);

    if (entry.migration) {
      parts.push('## AX2012 → D365FO Migration\n');
      parts.push(`| AX2012 (legacy) | D365FO (correct) |`);
      parts.push(`|---|---|`);
      parts.push(`| ${entry.migration.ax2012} | ${entry.migration.d365fo} |\n`);
    }

    parts.push('## Rules\n');
    for (const rule of entry.rules) {
      parts.push(`- ${rule}`);
    }
    parts.push('');

    if (entry.examples && entry.examples.length > 0) {
      parts.push('## Code Examples\n');
      for (const ex of entry.examples) {
        parts.push(`### ${ex.label}\n`);
        parts.push('```xpp');
        parts.push(ex.code);
        parts.push('```\n');
      }
    }

    if (entry.related && entry.related.length > 0) {
      const relatedTitles = entry.related
        .map(id => KNOWLEDGE_BASE.find(e => e.id === id))
        .filter(Boolean)
        .map(e => `\`${e!.id}\` (${e!.title})`);
      parts.push(`**Related topics:** ${relatedTitles.join(', ')}\n`);
    }

    parts.push('---\n');
  }

  if (entries.length > 3) {
    parts.push(`_${entries.length - 3} more entries matched. Use a more specific query._`);
  }

  return parts.join('\n');
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

export async function xppKnowledgeTool(request: CallToolRequest) {
  try {
    const args = XppKnowledgeArgsSchema.parse(request.params.arguments);
    const entries = searchKnowledge(args.topic);
    const formatted = args.format === 'detailed'
      ? formatDetailed(entries)
      : formatConcise(entries);

    return {
      content: [{ type: 'text', text: formatted }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error in get_xpp_knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      isError: true,
    };
  }
}
