import type { PackageOptions, PackageResult } from '../types.js';

export function createPackage(options: PackageOptions): PackageResult {
  const { name, version = '1.0.0', description = '', debug = false } = options;

  if (debug) {
    console.log(`Creating package: ${name} v${version}`);
  }

  if (!name || name.trim().length === 0) {
    return {
      success: false,
      message: 'Package name is required',
    };
  }

  return {
    success: true,
    message: `Package "${name}" created successfully`,
    data: {
      name: name.trim(),
      version,
      description: description.trim(),
      createdAt: new Date().toISOString(),
    },
  };
}

export function validatePackageOptions(options: unknown): options is PackageOptions {
  if (!options || typeof options !== 'object') {
    return false;
  }

  const opts = options as Record<string, unknown>;

  return typeof opts.name === 'string' && opts.name.length > 0;
}
