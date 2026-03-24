using System;
using System.Collections.Generic;
using System.Linq;
using D365MetadataBridge.Models;
using Microsoft.Dynamics.AX.Metadata.MetaModel;
using Microsoft.Dynamics.AX.Metadata.Providers;
using Microsoft.Dynamics.AX.Metadata.Storage;

namespace D365MetadataBridge.Services
{
    /// <summary>
    /// Reads D365FO metadata using Microsoft's official IMetadataProvider API.
    /// Uses CreateDiskProvider (standalone mode, no VS/instrumentation dependency).
    /// </summary>
    public class MetadataReadService
    {
        private IMetadataProvider _provider;
        private readonly string _packagesPath;

        /// <summary>
        /// Exposes the current provider for MetadataWriteService initialization.
        /// </summary>
        public IMetadataProvider Provider => _provider;

        /// <summary>
        /// Optional callback invoked after RefreshProvider() so the write service can stay in sync.
        /// </summary>
        public Action<IMetadataProvider>? OnProviderRefreshed { get; set; }

        public MetadataReadService(string packagesPath)
        {
            _packagesPath = packagesPath;
            // Use DiskProvider (standalone mode) — avoids .NET Framework EventDescriptor dependency
            var factory = new MetadataProviderFactory();
            _provider = factory.CreateDiskProvider(packagesPath);
            Console.Error.WriteLine($"[MetadataService] Initialized via DiskProvider: {packagesPath}");
        }

        // ========================
        // WRITE-SUPPORT: Validate / Resolve / Refresh
        // ========================

        /// <summary>
        /// Re-creates the DiskProvider so newly written files are picked up.
        /// Notifies the write service via OnProviderRefreshed callback.
        /// </summary>
        public object RefreshProvider()
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var factory = new MetadataProviderFactory();
            _provider = factory.CreateDiskProvider(_packagesPath);
            OnProviderRefreshed?.Invoke(_provider);
            sw.Stop();
            Console.Error.WriteLine($"[MetadataService] Provider refreshed in {sw.ElapsedMilliseconds}ms");
            return new { refreshed = true, elapsedMs = sw.ElapsedMilliseconds };
        }

        /// <summary>
        /// Asks IMetadataProvider to read back an object that was just written to disk.
        /// Returns field/method counts and a success flag — proves the XML is well-formed
        /// and the metadata API can consume it.
        /// </summary>
        public object? ValidateObject(string objectType, string objectName)
        {
            try
            {
                switch (objectType.ToLowerInvariant())
                {
                    case "table":
                    case "table-extension":
                        if (!_provider.Tables.Exists(objectName)) return new { valid = false, reason = $"Table '{objectName}' not found by IMetadataProvider after refresh" };
                        var t = _provider.Tables.Read(objectName);
                        return new { valid = true, objectType, objectName, fieldCount = t?.Fields?.Count ?? 0, methodCount = t?.Methods?.Count ?? 0, indexCount = t?.Indexes?.Count ?? 0 };

                    case "class":
                    case "class-extension":
                        if (!_provider.Classes.Exists(objectName)) return new { valid = false, reason = $"Class '{objectName}' not found by IMetadataProvider after refresh" };
                        var c = _provider.Classes.Read(objectName);
                        return new { valid = true, objectType, objectName, fieldCount = 0, methodCount = c?.Methods?.Count ?? 0, indexCount = 0 };

                    case "enum":
                        if (!_provider.Enums.Exists(objectName)) return new { valid = false, reason = $"Enum '{objectName}' not found by IMetadataProvider after refresh" };
                        var en = _provider.Enums.Read(objectName);
                        int valueCount = 0;
                        try { dynamic den = en; if (den?.Values != null) foreach (var _ in den.Values) valueCount++; } catch { }
                        return new { valid = true, objectType, objectName, fieldCount = 0, methodCount = 0, valueCount, indexCount = 0 };

                    case "edt":
                        if (!_provider.Edts.Exists(objectName)) return new { valid = false, reason = $"EDT '{objectName}' not found by IMetadataProvider after refresh" };
                        return new { valid = true, objectType, objectName };

                    case "form":
                    case "form-extension":
                        if (!_provider.Forms.Exists(objectName)) return new { valid = false, reason = $"Form '{objectName}' not found by IMetadataProvider after refresh" };
                        return new { valid = true, objectType, objectName };

                    case "query":
                        if (!_provider.Queries.Exists(objectName)) return new { valid = false, reason = $"Query '{objectName}' not found by IMetadataProvider after refresh" };
                        return new { valid = true, objectType, objectName };

                    case "report":
                        if (!_provider.Reports.Exists(objectName)) return new { valid = false, reason = $"Report '{objectName}' not found by IMetadataProvider after refresh" };
                        return new { valid = true, objectType, objectName };

                    default:
                        return new { valid = false, reason = $"Unsupported objectType for validation: {objectType}" };
                }
            }
            catch (Exception ex)
            {
                return new { valid = false, reason = $"IMetadataProvider threw an exception reading {objectType}/{objectName}: {ex.Message}" };
            }
        }

        /// <summary>
        /// Uses IMetadataProvider to check if a given object name exists, and returns
        /// the model name it belongs to. Useful for modify_d365fo_file to locate objects
        /// without depending on the SQLite index.
        /// </summary>
        public object? ResolveObjectInfo(string objectType, string objectName)
        {
            try
            {
                switch (objectType.ToLowerInvariant())
                {
                    case "table":
                    case "table-extension":
                    {
                        if (!_provider.Tables.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Tables.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    case "class":
                    case "class-extension":
                    {
                        if (!_provider.Classes.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Classes.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    case "enum":
                    {
                        if (!_provider.Enums.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Enums.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    case "edt":
                    {
                        if (!_provider.Edts.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Edts.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    case "form":
                    case "form-extension":
                    {
                        if (!_provider.Forms.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Forms.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    case "query":
                    {
                        if (!_provider.Queries.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Queries.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    case "view":
                    {
                        if (!_provider.Views.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Views.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    case "report":
                    {
                        if (!_provider.Reports.Exists(objectName)) return null;
                        string? model = null;
                        try { var mi = _provider.Reports.GetModelInfo(objectName); if (mi?.Count > 0) model = mi.First().Name; } catch { }
                        return new { exists = true, objectType, objectName, model };
                    }
                    default:
                        return null;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WARN] ResolveObjectInfo({objectType}, {objectName}): {ex.Message}");
                return null;
            }
        }

        // ========================
        // TABLE
        // ========================
        public TableInfoModel? ReadTable(string tableName)
        {
            if (!_provider.Tables.Exists(tableName)) return null;
            var table = _provider.Tables.Read(tableName);
            if (table == null) return null;

            var result = new TableInfoModel
            {
                Name = table.Name,
                Label = Safe(() => table.Label),
                DeveloperDocumentation = Safe(() => table.DeveloperDocumentation),
                TableGroup = Safe(() => table.TableGroup.ToString()),
                TableType = Safe(() => table.TableType.ToString()),
                CacheLookup = Safe(() => table.CacheLookup.ToString()),
                ClusteredIndex = Safe(() => table.ClusteredIndex),
                PrimaryIndex = Safe(() => table.PrimaryIndex),
                Extends = Safe(() => table.Extends),
                SaveDataPerCompany = Safe(() => table.SaveDataPerCompany.ToString()),
                SupportInheritance = Safe(() => table.SupportInheritance.ToString()),
            };

            try { var mi = _provider.Tables.GetModelInfo(tableName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }

            try { foreach (var f in table.Fields) result.Fields.Add(MapField(f)); } catch (Exception ex) { Warn("fields", tableName, ex); }
            try { foreach (var g in table.FieldGroups) { var gm = new FieldGroupModel { Name = g.Name, Label = Safe(() => g.Label) }; try { foreach (var f in g.Fields) gm.Fields.Add(Safe(() => f.DataField) ?? f.Name); } catch { } result.FieldGroups.Add(gm); } } catch (Exception ex) { Warn("fieldGroups", tableName, ex); }
            try { foreach (var i in table.Indexes) { var im = new IndexInfoModel { Name = i.Name, AllowDuplicates = IsYes(() => i.AllowDuplicates), AlternateKey = IsYes(() => i.AlternateKey) }; try { foreach (var f in i.Fields) im.Fields.Add(new IndexFieldModel { DataField = Safe(() => f.DataField) ?? f.Name, IncludedColumn = IsYes(() => f.IncludedColumn) }); } catch { } result.Indexes.Add(im); } } catch (Exception ex) { Warn("indexes", tableName, ex); }

            try
            {
                foreach (var r in table.Relations)
                {
                    var rm = new RelationInfoModel
                    {
                        Name = r.Name,
                        RelatedTable = Safe(() => r.RelatedTable) ?? "",
                        Cardinality = Safe(() => r.Cardinality.ToString()),
                        RelatedTableCardinality = Safe(() => r.RelatedTableCardinality.ToString()),
                    };
                    try
                    {
                        foreach (var c in r.Constraints)
                        {
                            var cm = new RelationConstraintModel();
                            if (c is AxTableRelationConstraintField fc) { cm.Field = fc.Field; cm.RelatedField = fc.RelatedField; }
                            else if (c is AxTableRelationConstraintFixed xc) { cm.Field = xc.Field; cm.Value = xc.Value.ToString(); }
                            rm.Constraints.Add(cm);
                        }
                    }
                    catch { }
                    result.Relations.Add(rm);
                }
            }
            catch (Exception ex) { Warn("relations", tableName, ex); }

            try { if (table.Methods != null) foreach (var m in table.Methods) result.Methods.Add(new MethodInfoModel { Name = m.Name, Source = Safe(() => m.Source) }); } catch (Exception ex) { Warn("methods", tableName, ex); }

            return result;
        }

        // ========================
        // CLASS
        // ========================
        public ClassInfoModel? ReadClass(string className)
        {
            if (!_provider.Classes.Exists(className)) return null;
            var cls = _provider.Classes.Read(className);
            if (cls == null) return null;

            var result = new ClassInfoModel
            {
                Name = cls.Name,
                IsAbstract = cls.IsAbstract,
                IsFinal = cls.IsFinal,
                IsStatic = cls.IsStatic,
                Extends = Safe(() => cls.Extends),
                Declaration = Safe(() => cls.Declaration),
            };

            try { var mi = _provider.Classes.GetModelInfo(className); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }

            // Methods from cls.Methods (KeyedObjectCollection<AxMethod>) — the actual methods with source
            // Note: cls.SourceCode.Methods is AxMethodPropertyCollection (empty for disk reads) — DON'T use it
            try
            {
                if (cls.Methods != null)
                {
                    foreach (var method in cls.Methods)
                    {
                        result.Methods.Add(new MethodInfoModel
                        {
                            Name = method.Name,
                            Source = Safe(() => method.Source),
                        });
                    }
                }
            }
            catch (Exception ex) { Warn("methods", className, ex); }

            return result;
        }

        // ========================
        // METHOD SOURCE
        // ========================
        public MethodSourceModel GetMethodSource(string className, string methodName)
        {
            var result = new MethodSourceModel { ClassName = className, MethodName = methodName };

            // Try class first
            if (_provider.Classes.Exists(className))
            {
                var cls = _provider.Classes.Read(className);
                if (cls != null)
                {
                    if (string.Equals(methodName, "classDeclaration", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Source = cls.Declaration;
                        result.Found = result.Source != null;
                        return result;
                    }

                    try
                    {
                        if (cls.Methods != null)
                        {
                            foreach (var method in cls.Methods)
                            {
                                if (string.Equals(method.Name, methodName, StringComparison.OrdinalIgnoreCase))
                                {
                                    result.MethodName = method.Name;
                                    result.Source = method.Source;
                                    result.Found = true;
                                    return result;
                                }
                            }
                        }
                    }
                    catch { }
                }
            }

            // Try table
            if (_provider.Tables.Exists(className))
            {
                var table = _provider.Tables.Read(className);
                if (table?.Methods != null)
                {
                    try
                    {
                        foreach (var method in table.Methods)
                        {
                            if (string.Equals(method.Name, methodName, StringComparison.OrdinalIgnoreCase))
                            {
                                result.MethodName = method.Name;
                                result.Source = method.Source;
                                result.Found = true;
                                return result;
                            }
                        }
                    }
                    catch { }
                }
            }

            return result;
        }

        // ========================
        // ENUM
        // ========================
        public EnumInfoModel? ReadEnum(string enumName)
        {
            if (!_provider.Enums.Exists(enumName)) return null;
            var e = _provider.Enums.Read(enumName);
            if (e == null) return null;

            var result = new EnumInfoModel { Name = e.Name, Label = Safe(() => e.Label), HelpText = Safe(() => e.HelpText) };
            try { result.IsExtensible = e.IsExtensible; } catch { }
            try { var mi = _provider.Enums.GetModelInfo(enumName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }

            try
            {
                int idx = 0;
                foreach (var v in e.EnumValues)
                {
                    result.Values.Add(new EnumValueModel { Name = v.Name, Value = SafeInt(() => v.Value, idx), Label = Safe(() => v.Label) });
                    idx++;
                }
            }
            catch (Exception ex) { Warn("values", enumName, ex); }

            return result;
        }

        // ========================
        // EDT
        // ========================
        public EdtInfoModel? ReadEdt(string edtName)
        {
            if (!_provider.Edts.Exists(edtName)) return null;
            var edt = _provider.Edts.Read(edtName);
            if (edt == null) return null;

            var result = new EdtInfoModel
            {
                Name = edt.Name,
                BaseType = edt.GetType().Name.Replace("AxEdt", ""),
                Extends = Safe(() => edt.Extends),
                Label = Safe(() => edt.Label),
                HelpText = Safe(() => edt.HelpText),
            };

            try { var mi = _provider.Edts.GetModelInfo(edtName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }
            if (edt is AxEdtString s) result.StringSize = SafeInt(() => s.StringSize, 0);
            if (edt is AxEdtEnum en) result.EnumType = Safe(() => en.EnumType);
            try { result.ReferenceTable = Safe(() => ((dynamic)edt).ReferenceTable?.Table); } catch { }

            return result;
        }

        // ========================
        // FORM
        // ========================
        public FormInfoModel? ReadForm(string formName)
        {
            if (!_provider.Forms.Exists(formName)) return null;
            var form = _provider.Forms.Read(formName);
            if (form == null) return null;

            var result = new FormInfoModel { Name = form.Name };
            try { var mi = _provider.Forms.GetModelInfo(formName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }

            try { if (form.DataSources != null) foreach (var ds in form.DataSources) result.DataSources.Add(new FormDataSourceModel { Name = ds.Name, Table = Safe(() => ds.Table) ?? "", JoinSource = Safe(() => ds.JoinSource) }); } catch (Exception ex) { Warn("datasources", formName, ex); }
            try { if (form.Design?.Controls != null) MapControls(form.Design.Controls, result.Controls, 0); } catch (Exception ex) { Warn("controls", formName, ex); }

            return result;
        }

        private void MapControls(dynamic? controls, List<FormControlModel> target, int depth)
        {
            if (controls == null || depth > 15) return;
            try
            {
                foreach (dynamic c in controls!)
                {
                    try
                    {
                        var cm = new FormControlModel { Name = Safe(() => (string)c.Name) ?? "", ControlType = ((object)c).GetType().Name.Replace("AxFormControl", "") };
                        try { cm.DataSource = Safe(() => (string)c.DataSource); cm.DataField = Safe(() => (string)c.DataField); } catch { }
                        try { if (c.Controls != null) { cm.Children = new List<FormControlModel>(); MapControls(c.Controls, cm.Children, depth + 1); if (cm.Children.Count == 0) cm.Children = null; } } catch { }
                        target.Add(cm);
                    }
                    catch { }
                }
            }
            catch { }
        }

        // ========================
        // QUERY / VIEW / DATA ENTITY / REPORT
        // ========================
        public QueryInfoModel? ReadQuery(string queryName)
        {
            if (!_provider.Queries.Exists(queryName)) return null;
            var q = _provider.Queries.Read(queryName);
            if (q == null) return null;
            var result = new QueryInfoModel { Name = q.Name };
            try { var mi = _provider.Queries.GetModelInfo(queryName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }
            try { dynamic dq = q; if (dq.DataSources != null) foreach (dynamic ds in dq.DataSources) result.DataSources.Add(MapQueryDataSource(ds)); } catch (Exception ex) { Warn("dataSources", queryName, ex); }
            return result;
        }

        public ViewInfoModel? ReadView(string viewName)
        {
            if (!_provider.Views.Exists(viewName)) return null;
            var v = _provider.Views.Read(viewName);
            if (v == null) return null;
            var result = new ViewInfoModel { Name = v.Name, Label = Safe(() => v.Label), Query = Safe(() => v.Query) };
            try { var mi = _provider.Views.GetModelInfo(viewName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }
            try { if (v.Fields != null) foreach (var f in v.Fields) result.Fields.Add(new FieldInfoModel { Name = f.Name, FieldType = f.GetType().Name.Replace("AxViewField", "") }); } catch { }
            return result;
        }

        public DataEntityInfoModel? ReadDataEntity(string entityName)
        {
            if (!_provider.DataEntityViews.Exists(entityName)) return null;
            var e = _provider.DataEntityViews.Read(entityName);
            if (e == null) return null;
            var result = new DataEntityInfoModel { Name = e.Name, Label = Safe(() => e.Label), PublicEntityName = Safe(() => e.PublicEntityName), PublicCollectionName = Safe(() => e.PublicCollectionName), IsPublic = IsYes(() => e.IsPublic) };
            try { var mi = _provider.DataEntityViews.GetModelInfo(entityName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }
            try { if (e.Fields != null) foreach (var f in e.Fields) result.Fields.Add(new FieldInfoModel { Name = f.Name, FieldType = f.GetType().Name }); } catch { }
            try { dynamic de = e; if (de.DataSources != null) foreach (dynamic ds in de.DataSources) result.DataSources.Add(new FormDataSourceModel { Name = Safe(() => (string)ds.Name) ?? "", Table = Safe(() => (string)ds.Table) ?? "" }); } catch (Exception ex) { Warn("dataSources", entityName, ex); }
            return result;
        }

        public ReportInfoModel? ReadReport(string reportName)
        {
            try
            {
                if (!_provider.Reports.Exists(reportName)) return null;
                var r = _provider.Reports.Read(reportName);
                if (r == null) return null;
                var result = new ReportInfoModel { Name = r.Name };
                try { var mi = _provider.Reports.GetModelInfo(reportName); if (mi?.Count > 0) result.Model = mi.First().Name; } catch { }
                try { if (r.DataSets != null) foreach (dynamic ds in r.DataSets) result.DataSets.Add(Safe(() => (string)ds.Name) ?? "Unknown"); } catch { }
                return result;
            }
            catch { return null; }
        }

        private QueryDataSourceModel MapQueryDataSource(dynamic ds)
        {
            var model = new QueryDataSourceModel { Name = Safe(() => (string)ds.Name) ?? "", Table = Safe(() => (string)ds.Table) ?? "" };
            try { model.JoinMode = Safe(() => ds.JoinMode?.ToString()); } catch { }
            try
            {
                if (ds.DataSources != null)
                {
                    model.ChildDataSources = new List<QueryDataSourceModel>();
                    foreach (dynamic child in ds.DataSources) model.ChildDataSources.Add(MapQueryDataSource(child));
                    if (model.ChildDataSources.Count == 0) model.ChildDataSources = null;
                }
            }
            catch { }
            return model;
        }

        // ========================
        // SEARCH / LIST
        // ========================
        public SearchResultModel SearchObjects(string type, string query, int maxResults)
        {
            var result = new SearchResultModel();
            void Search(string objType, IList<string> keys)
            {
                foreach (var n in keys)
                {
                    if (result.Results.Count >= maxResults) return;
                    if (n.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0)
                        result.Results.Add(new SearchItemModel { Name = n, Type = objType });
                }
            }

            try
            {
                switch (type.ToLowerInvariant())
                {
                    case "table": Search("table", _provider.Tables.GetPrimaryKeys()); break;
                    case "class": Search("class", _provider.Classes.GetPrimaryKeys()); break;
                    case "enum": Search("enum", _provider.Enums.GetPrimaryKeys()); break;
                    case "edt": Search("edt", _provider.Edts.GetPrimaryKeys()); break;
                    case "form": Search("form", _provider.Forms.GetPrimaryKeys()); break;
                    default:
                        Search("table", _provider.Tables.GetPrimaryKeys());
                        Search("class", _provider.Classes.GetPrimaryKeys());
                        Search("enum", _provider.Enums.GetPrimaryKeys());
                        Search("edt", _provider.Edts.GetPrimaryKeys());
                        Search("form", _provider.Forms.GetPrimaryKeys());
                        break;
                }
            }
            catch (Exception ex) { Console.Error.WriteLine($"[WARN] Search error: {ex.Message}"); }

            result.TotalCount = result.Results.Count;
            return result;
        }

        public object ListObjects(string type)
        {
            IList<string> keys = type.ToLowerInvariant() switch
            {
                "table" => _provider.Tables.GetPrimaryKeys(),
                "class" => _provider.Classes.GetPrimaryKeys(),
                "enum" => _provider.Enums.GetPrimaryKeys(),
                "edt" => _provider.Edts.GetPrimaryKeys(),
                "form" => _provider.Forms.GetPrimaryKeys(),
                "view" => _provider.Views.GetPrimaryKeys(),
                "query" => _provider.Queries.GetPrimaryKeys(),
                "dataentity" => _provider.DataEntityViews.GetPrimaryKeys(),
                _ => new List<string>()
            };
            return new { type, count = keys.Count, names = keys };
        }

        // ========================
        // HELPERS
        // ========================
        private static string? Safe(Func<string?> f) { try { return f(); } catch { return null; } }
        private static bool IsYes(Func<object> f) { try { return f()?.ToString() == "Yes"; } catch { return false; } }
        private static int SafeInt(Func<int> f, int d) { try { return f(); } catch { return d; } }
        private static void Warn(string section, string obj, Exception ex) => Console.Error.WriteLine($"[WARN] Error reading {section} for {obj}: {ex.Message}");

        // ========================
        // DIAGNOSTIC: Probe IMetadataProvider write capability
        // ========================

        private FieldInfoModel MapField(AxTableField field)
        {
            var m = new FieldInfoModel
            {
                Name = field.Name,
                FieldType = field.GetType().Name.Replace("AxTableField", ""),
                ExtendedDataType = Safe(() => field.ExtendedDataType),
                Label = Safe(() => field.Label),
                HelpText = Safe(() => field.HelpText),
                Mandatory = IsYes(() => field.Mandatory),
                AllowEdit = Safe(() => field.AllowEdit.ToString()),
            };
            if (field is AxTableFieldString s) m.StringSize = SafeInt(() => s.StringSize, 0);
            if (field is AxTableFieldEnum en) m.EnumType = Safe(() => en.EnumType);
            return m;
        }
    }
}
