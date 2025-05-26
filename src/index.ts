/**
 * Main entry point for the package
 */

// Export all types
export type { PackageOptions } from './types.js';

// Export core package functionality
export { createPackage } from './lib/package.js';

// Export all version-related functionality
export * from './version.js';

// Default export for convenience
export { createPackage as default } from './lib/package.js';
