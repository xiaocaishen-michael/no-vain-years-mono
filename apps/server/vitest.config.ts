import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      // 不读项目 .swcrc（项目 .swcrc exclude *.spec.ts，vitest 需要编译 spec）
      swcrc: false,
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2021',
        keepClassNames: true,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts', 'test/**/*.{spec,test}.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/main.ts', 'src/generated/**'],
    },
  },
});
