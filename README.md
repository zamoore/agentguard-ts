# @zamoore/agentguard-node

A modern Node.js package built with TypeScript, ESM, and bleeding-edge tooling.

## Features

- 🚀 **Modern ESM** - Full ESM support with CJS compatibility
- 📦 **TypeScript** - Full type safety with the latest TS features
- ⚡ **Fast builds** - Lightning fast builds with `tsup`
- 🧪 **Vitest** - Fast and modern testing framework
- 🔧 **ESLint 9** - Latest flat config with TypeScript support
- 🎨 **Prettier 3** - Consistent code formatting
- 📊 **Coverage** - Built-in test coverage reporting
- 🔄 **Changesets** - Automated versioning and changelogs
- 🎯 **Dual package** - Works in both ESM and CommonJS environments

## Installation

```bash
# npm
npm install @your-scope/package-name

# pnpm (recommended)
pnpm add @your-scope/package-name

# yarn
yarn add @your-scope/package-name
```

## Usage

```typescript
import { createPackage, version, getVersionString } from '@your-scope/package-name';

const result = createPackage({
  name: 'my-awesome-package',
  version: '1.0.0',
  description: 'An awesome package',
});

console.log(result);
console.log(`Using ${getVersionString()}`);
```

### `version` and Metadata

The package includes comprehensive version and build information:

```typescript
import {
  version,
  buildInfo,
  gitInfo,
  getVersionString,
  getFullVersionString,
  compareVersion,
} from '@your-scope/package-name';

console.log(getVersionString());
// "@your-scope/package-name v1.2.3 (production)"

console.log(getFullVersionString());
// "@your-scope/package-name v1.2.3 (production) [a1b2c3d]"

console.log('Build info:', buildInfo);
// { buildTime, buildUser, nodeVersion, platform, arch, ... }

console.log('Git info:', gitInfo);
// { hash, branch, tag, remote, isDirty }

// Version comparison
if (compareVersion('1.0.0') > 0) {
  console.log('This is a newer version than 1.0.0');
}
```

## API

### `createPackage(options)`

Creates a new package with the given options.

#### Parameters

- `options` (`PackageOptions`) - Configuration options for the package
  - `name` (`string`) - **Required.** The package name
  - `version` (`string`) - Package version (default: '1.0.0')
  - `description` (`string`) - Package description (optional)
  - `debug` (`boolean`) - Enable debug logging (default: false)

#### Returns

Returns a `PackageResult` object:

```typescript
type PackageResult = {
  readonly success: boolean;
  readonly message: string;
  readonly data?: unknown;
};
```

## Development

This project uses modern tooling and follows best practices:

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build the package
pnpm build

# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Check test coverage
pnpm test:coverage

# Lint code
pnpm lint

# Format code
pnpm format

# Type check
pnpm typecheck
```

### Scripts

| Script                  | Description                        |
| ----------------------- | ---------------------------------- |
| `pnpm generate:version` | Generate version.ts with metadata  |
| `pnpm build`            | Build the package for production   |
| `pnpm dev`              | Run in development mode with watch |
| `pnpm test`             | Run tests                          |
| `pnpm test:ui`          | Run tests with Vitest UI           |
| `pnpm test:coverage`    | Run tests with coverage            |
| `pnpm lint`             | Lint and fix code                  |
| `pnpm format`           | Format code with Prettier          |
| `pnpm typecheck`        | Run TypeScript type checking       |
| `pnpm clean`            | Clean build artifacts              |

### Project Structure

```
├── src/
│   ├── index.ts          # Main entry point
│   ├── types.ts          # Type definitions
│   ├── version.ts        # Version info
│   └── lib/
│       └── package.ts    # Core package logic
├── tests/
│   └── package.test.ts   # Test files
├── dist/                 # Build output (auto-generated)
└── coverage/            # Test coverage (auto-generated)
```

## Technology Stack

- **TypeScript 5.6+** - Type safety and modern JavaScript features
- **ESM** - Native ES modules with CommonJS compatibility
- **tsup** - Fast TypeScript bundler powered by esbuild
- **Vitest** - Fast unit testing framework
- **ESLint 9** - Code linting with flat config
- **Prettier 3** - Code formatting
- **Changesets** - Version management and changelog generation
- **pnpm** - Fast, disk space efficient package manager

## Publishing

This package uses [Changesets](https://github.com/changesets/changesets) for version management:

```bash
# Create a changeset
pnpm changeset

# Version packages and update changelog
pnpm changeset version

# Publish to npm
pnpm release
```

## License

MIT © [Your Name](https://github.com/your-username)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

Please make sure to update tests as appropriate and follow the existing code style.
