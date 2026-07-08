import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const input = 'src/index.ts';

// Build config:
// - index.mjs: ESM entry for bundlers.
// - index.cjs: CommonJS entry for Node/CommonJS tooling.
// - index.d.ts: TypeScript declarations.
// - tonder-web-sdk(.min).js: browser global bundle for CDN/script-tag usage.
//
// The CDN files intentionally use a product name instead of `index.global.*` so
// uploaded assets are self-describing in a bucket or CDN console.
// Runtime payment-field/acquirer browser libraries are loaded on demand; they
// are not bundled here.
export default [
  {
    input,
    output: [
      {
        file: 'dist/index.mjs',
        format: 'es',
        sourcemap: 'hidden',
      },
      {
        file: 'dist/index.cjs',
        format: 'cjs',
        sourcemap: 'hidden',
        exports: 'named',
      },
      {
        // Unminified browser global — readable, for debugging.
        file: 'dist/tonder-web-sdk.js',
        format: 'iife',
        name: 'Tonder',
        sourcemap: 'hidden',
        exports: 'named',
      },
      {
        // Minified browser global — production CDN/script-tag artifact.
        file: 'dist/tonder-web-sdk.min.js',
        format: 'iife',
        name: 'Tonder',
        sourcemap: 'hidden',
        exports: 'named',
        plugins: [terser()],
      },
    ],
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        // Declarations are emitted by the dedicated dts pass below.
        declaration: false,
        declarationMap: false,
        outDir: undefined,
      }),
    ],
  },
  {
    input,
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    plugins: [dts()],
  },
];
