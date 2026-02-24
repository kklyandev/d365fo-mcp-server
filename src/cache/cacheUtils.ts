/**
 * Cache Utilities
 * Helper functions for smart caching with fuzzy matching
 */

export { levenshteinDistance, similarityScore } from '../utils/fuzzyMatching.js';

/**
 * Normalize a query string for consistent caching
 * - Convert to lowercase
 * - Trim whitespace
 * - Remove special characters
 * - Collapse multiple spaces
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' '); // Collapse spaces
}

/**
 * Extract query component from cache key
 * Example: "xpp:search:dimension:class:20" → "dimension"
 */
export function extractQueryFromKey(key: string): string {
  const parts = key.split(':');
  if (parts.length >= 3) {
    return parts[2]; // Query is typically 3rd component
  }
  return '';
}

/**
 * Extract all components from cache key
 */
export interface CacheKeyComponents {
  prefix: string;
  type: string;
  query: string;
  filter?: string;
  limit?: number;
}

export function parseCacheKey(key: string): CacheKeyComponents | null {
  const parts = key.split(':');
  
  // xpp:search:query:type:limit
  if (parts[0] === 'xpp' && parts[1] === 'search' && parts.length >= 5) {
    return {
      prefix: 'xpp',
      type: 'search',
      query: parts[2],
      filter: parts[3],
      limit: parseInt(parts[4], 10)
    };
  }
  
  // xpp:class:className or xpp:table:tableName
  if (parts[0] === 'xpp' && (parts[1] === 'class' || parts[1] === 'table') && parts.length >= 3) {
    return {
      prefix: 'xpp',
      type: parts[1],
      query: parts[2]
    };
  }
  
  return null;
}

/**
 * Check if two cache keys are compatible for fuzzy matching
 * Keys are compatible if they have the same type and similar parameters
 */
export function areKeysCompatible(key1: string, key2: string): boolean {
  const parsed1 = parseCacheKey(key1);
  const parsed2 = parseCacheKey(key2);
  
  if (!parsed1 || !parsed2) return false;
  
  // Must be same type
  if (parsed1.type !== parsed2.type) return false;
  
  // For searches, check filter and limit are reasonably close
  if (parsed1.type === 'search') {
    if (parsed1.filter !== parsed2.filter) return false;
    if (parsed1.limit && parsed2.limit) {
      const limitDiff = Math.abs(parsed1.limit - parsed2.limit);
      if (limitDiff > 10) return false; // Limits must be within 10
    }
  }
  
  return true;
}
