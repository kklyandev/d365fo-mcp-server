/**
 * AxLabelFile Parser
 * Parses D365FO .label.txt files from PackagesLocalDirectory
 * and indexes them into the SQLite labels table.
 *
 * Label file format (one per line):
 *   LabelId=Label text
 *    ;Optional comment line (leading space + semicolon)
 *
 * File locations on K: drive:
 *   {pkg}\{Model}\{Model}\AxLabelFile\LabelResources\{locale}\{LabelFileId}.{locale}.label.txt
 *   {pkg}\{Model}\{Model}\AxLabelFile\{LabelFileId}_{locale}.xml  (metadata descriptor)
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { XppSymbolIndex } from './symbolIndex.js';

export interface ParsedLabel {
  labelId: string;
  text: string;
  comment?: string;
  labelFileId: string;
  model: string;
  language: string;
  filePath: string;
}

/**
 * Parse a single .label.txt file into ParsedLabel records.
 */
export function parseLabelFile(
  content: string,
  labelFileId: string,
  model: string,
  language: string,
  filePath: string,
): ParsedLabel[] {
  const labels: ParsedLabel[] = [];
  // Normalise line endings
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let current: ParsedLabel | null = null;

  for (const line of lines) {
    if (line === '') continue;

    if (line.startsWith(' ;') || line.startsWith('\t;')) {
      // Comment line for the previous label
      if (current) {
        const commentText = line.replace(/^[ \t];/, '').trim();
        current.comment = current.comment ? `${current.comment} ${commentText}` : commentText;
      }
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      // Flush previous label
      if (current) labels.push(current);

      const labelId = line.substring(0, eqIdx).trim();
      const text = line.substring(eqIdx + 1);

      // Skip empty or obviously malformed ids
      if (!labelId || /\s/.test(labelId)) {
        current = null;
        continue;
      }

      current = { labelId, text, comment: undefined, labelFileId, model, language, filePath };
    }
    // Any other line (continuation) — ignore; D365FO labels are single-line
  }

  if (current) labels.push(current);
  return labels;
}

/**
 * Discover all AxLabelFile resources for a model.
 * Returns an array of { labelFileId, language, filePath }.
 */
export async function discoverLabelFiles(
  modelDir: string,  // e.g. K:\AosService\PackagesLocalDirectory\AslCore\AslCore
  verbose: boolean = false,
): Promise<Array<{ labelFileId: string; language: string; filePath: string }>> {
  const results: Array<{ labelFileId: string; language: string; filePath: string }> = [];
  
  // 🔧 CASE-INSENSITIVE: On Linux, unzip may convert directory names to lowercase.
  // Try both cases: AxLabelFile (Windows) and axlabelfile (Linux unzip)
  let axLabelDir = path.join(modelDir, 'AxLabelFile', 'LabelResources');
  if (!fsSync.existsSync(axLabelDir)) {
    axLabelDir = path.join(modelDir, 'axlabelfile', 'LabelResources');
    if (!fsSync.existsSync(axLabelDir)) {
      // Also try lowercase labelresources
      axLabelDir = path.join(modelDir, 'axlabelfile', 'labelresources');
    }
  }
  
  // 🎯 OPTIMIZATION: Only index languages you actually use!
  // Reduces database from 20M rows to ~1M (20x smaller, 20x faster)
  // Configure via LABEL_LANGUAGES env var (default: en-US,cs,sk,de)
  const langConfig = process.env.LABEL_LANGUAGES || 'en-US,cs,sk,de';
  const SUPPORTED_LANGUAGES = langConfig.toLowerCase() === 'all'
    ? null  // null = index all languages
    : new Set(langConfig.split(',').map(l => l.trim()));

  let locales: string[];
  try {
    locales = await fs.readdir(axLabelDir);
  } catch (err) {
    if (verbose) {
      // Check if parent AxLabelFile directory exists (try both cases)
      const axLabelFileDirOriginal = path.join(modelDir, 'AxLabelFile');
      const axLabelFileDirLower = path.join(modelDir, 'axlabelfile');
      const axLabelExists = fsSync.existsSync(axLabelFileDirOriginal) || fsSync.existsSync(axLabelFileDirLower);
      
      if (!axLabelExists) {
        console.log(`      ℹ️  No AxLabelFile/axlabelfile directory in ${modelDir}`);
        
        // Debug: show what directories actually exist
        try {
          const actualDirs = fsSync.readdirSync(modelDir).filter(n => {
            const stat = fsSync.statSync(path.join(modelDir, n));
            return stat.isDirectory();
          }).slice(0, 5);
          if (actualDirs.length > 0) {
            console.log(`         Available dirs: ${actualDirs.join(', ')}`);
          }
        } catch { /* ignore */ }
      } else {
        const whichCase = fsSync.existsSync(axLabelFileDirOriginal) ? 'AxLabelFile' : 'axlabelfile';
        console.log(`      ℹ️  Found ${whichCase} but no LabelResources subdirectory in ${modelDir}`);
      }
    }
    return results; // No AxLabelFile folder
  }

  for (const locale of locales) {
    // 🔧 CASE-INSENSITIVE locale matching: Linux unzip may convert en-US to en-us
    // Skip unsupported languages early (unless SUPPORTED_LANGUAGES is null = all languages)
    if (SUPPORTED_LANGUAGES) {
      // Case-insensitive check
      const normalizedLocale = locale.toLowerCase();
      const isSupported = Array.from(SUPPORTED_LANGUAGES).some(
        supported => supported.toLowerCase() === normalizedLocale
      );
      if (!isSupported) {
        continue;
      }
    }
    
    const localeDir = path.join(axLabelDir, locale);
    let files: string[];
    try {
      files = await fs.readdir(localeDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.label.txt')) continue;
      // Filename pattern: {LabelFileId}.{locale}.label.txt
      // e.g. AslCore.en-US.label.txt or aslcore.en-us.label.txt (Linux)
      const withoutSuffix = file.replace(/\.label\.txt$/, '');
      const dotIdx = withoutSuffix.lastIndexOf('.');
      if (dotIdx < 0) continue;
      const labelFileId = withoutSuffix.substring(0, dotIdx);
      const fileLang = withoutSuffix.substring(dotIdx + 1);

      // Sanity-check: locale from directory should match lang in filename (case-insensitive)
      if (fileLang.toLowerCase() !== locale.toLowerCase()) continue;

      results.push({
        labelFileId,
        language: locale,  // Use actual locale from filesystem (may be en-us or en-US)
        filePath: path.join(localeDir, file),
      });
    }
  }

  return results;
}

/**
 * Index all label files for a single model into the symbol index.
 * Returns the number of label entries inserted.
 *
 * Pass `{ skipFtsRebuild: true }` when calling in a loop over many models;
 * the caller is responsible for calling `symbolIndex.rebuildLabelsFts()` once
 * after all models have been indexed.
 */
export async function indexModelLabels(
  symbolIndex: XppSymbolIndex,
  modelDir: string,
  model: string,
  opts?: { skipFtsRebuild?: boolean; verbose?: boolean },
): Promise<number> {
  const labelFiles = await discoverLabelFiles(modelDir, opts?.verbose);
  if (labelFiles.length === 0) return 0;

  const allEntries: Parameters<XppSymbolIndex['bulkAddLabels']>[0] = [];

  for (const { labelFileId, language, filePath } of labelFiles) {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const labels = parseLabelFile(content, labelFileId, model, language, filePath);
    for (const lbl of labels) {
      allEntries.push({
        labelId: lbl.labelId,
        labelFileId: lbl.labelFileId,
        model: lbl.model,
        language: lbl.language,
        text: lbl.text,
        comment: lbl.comment,
        filePath: lbl.filePath,
      });
    }
  }

  if (allEntries.length > 0) {
    symbolIndex.bulkAddLabels(allEntries, opts);
  }

  return allEntries.length;
}

/**
 * Index ALL labels from PackagesLocalDirectory into the symbol index.
 * Scans all model folders.
 */
export async function indexAllLabels(
  symbolIndex: XppSymbolIndex,
  packagesPath: string,
  modelFilter?: (modelName: string) => boolean,
): Promise<{ totalLabels: number; modelsIndexed: number }> {
  let totalLabels = 0;
  let modelsIndexed = 0;

  let models: string[];
  try {
    const entries = fsSync.readdirSync(packagesPath, { withFileTypes: true });
    // Include both real directories AND symbolic links / junction points.
    // On Windows, D365FO PackagesLocalDirectory model folders are often NTFS
    // junction points, which readdirSync reports as isSymbolicLink()=true
    // rather than isDirectory()=true.
    models = entries.filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name);
    console.log(`   🔍 Found ${models.length} potential model folders in ${packagesPath}`);
  } catch {
    console.error(`[LabelParser] Cannot read packages path: ${packagesPath}`);
    return { totalLabels, modelsIndexed };
  }

  let skippedByFilter = 0;
  let skippedMissingDir = 0;
  let skippedNoLabels = 0;
  const verboseDebug = process.env.DEBUG_LABELS === 'true';
  let processedModels = 0;

  for (const model of models) {
    if (modelFilter && !modelFilter(model)) {
      skippedByFilter++;
      continue;
    }

    // Try multiple possible structures:
    // 1. AOT nested structure: {packagesPath}/{lowercase-package}/{ProperCase-Model}/AxLabelFile
    //    Example: PackagesLocalDirectory/accountspayablemobile/AccountsPayableMobile/AxLabelFile
    // 2. Legacy nested structure: {packagesPath}/{Model}/{Model}/AxLabelFile
    // 3. Git source structure: {packagesPath}/{Model}/AxLabelFile
    
    let modelDir: string | null = null;
    let usedNestedStructure = false;
    
    // First try: Look for ProperCase model folder inside lowercase package folder
    const packageDir = path.join(packagesPath, model);
    try {
      const subDirs = fsSync.readdirSync(packageDir, { withFileTypes: true })
        .filter(e => e.isDirectory() || e.isSymbolicLink())
        .map(e => e.name);
      
      // Find subdirectory that matches model name (case-insensitive)
      const properCaseModel = subDirs.find(d => d.toLowerCase() === model.toLowerCase());
      if (properCaseModel) {
        const candidateDir = path.join(packageDir, properCaseModel);
        // Verify AxLabelFile exists (case-insensitive)
        const axLabelDirOriginal = path.join(candidateDir, 'AxLabelFile');
        const axLabelDirLower = path.join(candidateDir, 'axlabelfile');
        if (fsSync.existsSync(axLabelDirOriginal) || fsSync.existsSync(axLabelDirLower)) {
          modelDir = candidateDir;
          usedNestedStructure = true;
        }
      }
    } catch {
      // Directory not readable, try other structures
    }
    
    // Second try: Legacy structure {Model}/{Model}
    if (!modelDir) {
      const legacyDir = path.join(packagesPath, model, model);
      if (fsSync.existsSync(legacyDir)) {
        modelDir = legacyDir;
        usedNestedStructure = true;
      }
    }
    
    // Third try: Flat structure (Git source)
    if (!modelDir) {
      const flatDir = path.join(packagesPath, model);
      if (fsSync.existsSync(flatDir)) {
        modelDir = flatDir;
        usedNestedStructure = false;
      }
    }
    
    if (!modelDir) {
      skippedMissingDir++;
      continue;
    }

    processedModels++;
    // Enable verbose for first 3 models or when DEBUG_LABELS=true
    const enableVerbose = verboseDebug || processedModels <= 3;
    
    if (enableVerbose && processedModels === 1) {
      console.log(`   📁 Using ${usedNestedStructure ? 'nested' : 'flat'} structure`);
      // Show which case was detected
      const axLabelOriginal = path.join(modelDir, 'AxLabelFile');
      const axLabelLower = path.join(modelDir, 'axlabelfile');
      if (fsSync.existsSync(axLabelOriginal)) {
        console.log(`   📁 Case: Windows (AxLabelFile with capital letters)`);
      } else if (fsSync.existsSync(axLabelLower)) {
        console.log(`   📁 Case: Linux (axlabelfile lowercase) - using case-insensitive matching`);
      }
    }

    // Skip per-model FTS rebuild; do a single rebuild after all models are indexed
    const count = await indexModelLabels(symbolIndex, modelDir, model, { skipFtsRebuild: true, verbose: enableVerbose });
    if (count > 0) {
      totalLabels += count;
      modelsIndexed++;
      if (enableVerbose) {
        console.log(`      ✓ ${model}: ${count} labels`);
      }
    } else {
      skippedNoLabels++;
      if (enableVerbose) {
        console.log(`      ✗ ${model}: no labels found`);
      }
    }
  }

  // Single FTS rebuild after all models — avoids O(N²) cost of rebuilding per model
  if (totalLabels > 0) {
    symbolIndex.rebuildLabelsFts();
  }

  // Debug statistics
  if (modelsIndexed === 0) {
    console.log(`   ℹ️  No labels indexed:`);
    console.log(`      - Models skipped by filter: ${skippedByFilter}`);
    console.log(`      - Models with missing directory: ${skippedMissingDir}`);
    console.log(`      - Models with no labels: ${skippedNoLabels}`);
    console.log(`      - Total models found: ${models.length}`);
  }

  return { totalLabels, modelsIndexed };
}
