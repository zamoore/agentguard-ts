import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: 'es2022',
  outDir: 'dist',
  external: [],
  noExternal: [],
  banner: {
    js: `/**
 * ${process.env.npm_package_name ?? 'package'} v${process.env.npm_package_version ?? '0.0.0'}
 * ${process.env.npm_package_description ?? ''}
 * 
 * @author ${process.env.npm_package_author ?? 'Author'}
 * @license ${process.env.npm_package_license ?? 'MIT'}
 */`,
  },
  esbuildOptions(options) {
    options.conditions = ['module'];
  },
});
