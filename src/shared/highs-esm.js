/**
 * ESM wrapper for the highs CommonJS module.
 * cvxjs expects `import('highs')` to return { default: loaderFn }
 * but CommonJS interop doesn't always set this up correctly.
 */

// We need to directly re-export from the actual module path
// This file will be aliased as 'highs' so cvxjs's dynamic import resolves here
export { default } from "highs-original";
export * from "highs-original";
