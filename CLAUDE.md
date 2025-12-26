# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start Vite dev server at https://localhost:3000
npm run build        # Production build to dist/
npm run lint         # Run ESLint on src/
npm run typecheck    # TypeScript type checking
npm run validate     # Validate manifest.xml for Office compliance
npm start            # Start Office Add-in debugging session
npm run stop         # Stop Office Add-in debugging
```

## Architecture

CVX Excel is a Microsoft Excel Add-in for convex optimization, powered by cvxjs and WebAssembly solvers (Clarabel for QP/SOCP, HiGHS for LP/MIP). Everything runs client-side in the browser.

### Source Structure

- **src/functions/functions.ts** - Custom Excel functions (`=CVX.LP()`, `=CVX.QP()`, `=CVX.PORTFOLIO()`) that Office.js exposes to cells
- **src/taskpane/taskpane.ts** - Interactive task pane UI with tab-based interface for complex problems
- **src/shared/excel-bridge.ts** - Bidirectional conversion between Excel 2D arrays and cvxjs vectors/matrices
- **src/shared/solver.ts** - WASM solver initialization with singleton pattern

### Data Flow

1. Excel passes data as 2D number arrays to custom functions
2. `excel-bridge.ts` converts to cvxjs formats (Float64Array vectors, matrix objects)
3. cvxjs constructs the optimization problem using DCP (Disciplined Convex Programming)
4. WASM solvers (Clarabel/HiGHS) execute the solve
5. Solution returned as 2D array that spills into Excel cells

### Key Configuration Files

- **manifest.xml** - Office Add-in manifest defining task pane, custom functions namespace (`CVX`), and permissions
- **functions.json** - Custom function metadata for Office.js registration
- **vite.config.ts** - Build config with WASM plugin, HTTPS certs from `~/.office-addin-dev-certs/`

## Development Patterns

### WASM Initialization
Uses lazy loading singleton pattern in `solver.ts`. Call `ensureSolverReady()` before solver operations - it's idempotent and safe for concurrent calls.

### Excel Range Handling
All Excel ranges arrive as `number[][]`. The `excel-bridge.ts` utilities validate numeric types and dimensions before converting to cvxjs formats.

### cvxjs Quirks
- `result.valueOf(variable)` returns an object like `{"0": val, "1": val}` instead of an array. Use `Object.values(result.valueOf(x))` to convert to a proper array.
- Objective functions must be scalar expressions. Use `dot(c, x)` for linear objectives rather than element-wise operations on vectors.

### Platform Support

| Platform | Task Pane | Custom Functions |
|----------|-----------|------------------|
| **Desktop Excel (Mac/Windows)** | ✅ | ✅ |
| **Excel Online** | ✅ | ❌ (sideloaded add-ins only support task pane) |

### Sideloading for Development

**Mac (Desktop Excel):**
1. Run `npm run dev`
2. Copy manifest to Excel's wef folder:
   ```bash
   mkdir -p ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef
   cp manifest.xml ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
   ```
3. Restart Excel - add-in auto-loads from wef folder
4. Find it in Insert > My Add-ins

**Windows (Desktop Excel):**
1. Run `npm run dev`
2. In Excel: Insert > Add-ins > Upload My Add-in > select `manifest.xml`

**Excel Online (task pane only):**
1. Run `npm run dev`
2. In Excel Online: Insert > Add-ins > Upload My Add-in > select `manifest.xml`
3. Note: Custom functions (`=CVX.LP()`) won't work - use the task pane instead

Use browser DevTools (F12) for debugging.
