/**
 * Simple logger utility
 * Set DEBUG_LOGGING=true environment variable to enable verbose logging
 */

const DEBUG_LOGGING = process.env.DEBUG_LOGGING === 'true';

export function debugLog(...args: any[]): void {
  if (DEBUG_LOGGING) {
    console.error(...args);
  }
}

export function errorLog(...args: any[]): void {
  console.error(...args);
}
