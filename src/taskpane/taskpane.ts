/**
 * CVX Excel Task Pane Logic
 */

import {
  variable,
  constant,
  Problem,
  quadForm,
  dot,
  loadWasm,
  scalarVar,
} from "cvxjs";
import { problemBuilder } from "./problem-builder/index.js";

declare const Office: {
  onReady: (callback: () => void) => void;
  context: {
    document: {
      getSelectedDataAsync: (
        coercionType: string,
        callback: (result: { status: string; value: unknown }) => void
      ) => void;
    };
  };
};

declare const Excel: {
  run: <T>(
    callback: (context: ExcelContext) => Promise<T>
  ) => Promise<T>;
};

interface ExcelContext {
  workbook: {
    getSelectedRange: () => ExcelRange;
    worksheets: {
      getActiveWorksheet: () => ExcelWorksheet;
    };
  };
  sync: () => Promise<void>;
}

interface ExcelWorksheet {
  getRange: (address: string) => ExcelRange;
}

interface ExcelRange {
  address: string;
  values: (number | string)[][];
  load: (props: string) => void;
}

// Status display helper
function setStatus(message: string, type: "info" | "success" | "error" = "info"): void {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
  }
}

// Tab switching
function setupTabs(): void {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.getAttribute("data-tab");
      if (!tabId) return;

      // Update tab buttons
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // Update tab content
      document.querySelectorAll(".tab-content").forEach((content) => {
        content.classList.remove("active");
      });
      const content = document.getElementById(`${tabId}-tab`);
      if (content) {
        content.classList.add("active");
      }
    });
  });
}

// Range selection from Excel
async function selectRange(inputId: string): Promise<void> {
  try {
    await Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.load("address");
      await context.sync();

      const input = document.getElementById(inputId) as HTMLInputElement;
      if (input) {
        // Extract just the range part (e.g., "Sheet1!A1:B2" -> "A1:B2")
        const address = range.address.includes("!")
          ? range.address.split("!")[1]
          : range.address;
        input.value = address;
      }
    });
  } catch (error) {
    setStatus(`Error selecting range: ${error}`, "error");
  }
}

// Read range values from Excel
async function readRange(address: string): Promise<number[][]> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const range = sheet.getRange(address);
    range.load("values");
    await context.sync();
    return range.values as number[][];
  });
}

// Write values to Excel - auto-resize to fit output array
async function writeRange(address: string, values: (number | string)[][]): Promise<void> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    // Get just the starting cell (first cell if range provided)
    const startCell = sheet.getRange(address).getCell(0, 0);
    // Resize to match output dimensions
    const rows = values.length;
    const cols = values[0]?.length || 1;
    const outputRange = startCell.getResizedRange(rows - 1, cols - 1);
    outputRange.values = values;
    await context.sync();
  });
}

// WASM initialization
let wasmReady = false;

async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    setStatus("Loading solver...", "info");
    await loadWasm();
    wasmReady = true;
  }
}

// Solve Linear Program
async function solveLP(): Promise<void> {
  try {
    setStatus("Solving LP...", "info");
    await ensureWasm();

    const cAddr = (document.getElementById("lp-c") as HTMLInputElement).value;
    const AAddr = (document.getElementById("lp-A") as HTMLInputElement).value;
    const bAddr = (document.getElementById("lp-b") as HTMLInputElement).value;
    const sense = (document.getElementById("lp-sense") as HTMLSelectElement).value;
    const outputAddr = (document.getElementById("lp-output") as HTMLInputElement).value;

    if (!cAddr || !AAddr || !bAddr || !outputAddr) {
      setStatus("Please fill in all range fields", "error");
      return;
    }

    const cData = await readRange(cAddr);
    const AData = await readRange(AAddr);
    const bData = await readRange(bAddr);

    // Flatten vectors
    const c = cData.flat();
    const b = bData.flat();
    const n = c.length;

    const x = variable(n);
    const cConst = constant(c);
    let objective = dot(cConst, x);

    if (sense === "max") {
      objective = objective.neg();
    }

    const constraints = [];
    for (let i = 0; i < AData.length; i++) {
      const row = constant(AData[i]);
      constraints.push(dot(row, x).le(b[i]));
    }
    constraints.push(x.ge(0));

    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    let optVal = result.value ?? 0;
    if (sense === "max") {
      optVal = -optVal;
    }

    const solution = result.valueOf(x);
    // Fully flatten nested arrays and convert to numbers
    const solutionFlat: number[] = (Array.isArray(solution) ? solution.flat(Infinity) : [solution]) as number[];

    console.log("Solution raw:", solution);
    console.log("Solution flat:", solutionFlat);

    // Write results
    const output: (number | string)[][] = [
      ["Optimal", optVal],
      ...solutionFlat.map((v, i) => [`x[${i}]`, v ?? 0]),
    ];
    await writeRange(outputAddr, output);

    setStatus(`Solved! Optimal value: ${optVal.toFixed(6)}`, "success");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${msg}`, "error");
  }
}

// Solve Quadratic Program
async function solveQP(): Promise<void> {
  try {
    setStatus("Solving QP...", "info");
    await ensureWasm();

    const QAddr = (document.getElementById("qp-Q") as HTMLInputElement).value;
    const cAddr = (document.getElementById("qp-c") as HTMLInputElement).value;
    const AAddr = (document.getElementById("qp-A") as HTMLInputElement).value;
    const bAddr = (document.getElementById("qp-b") as HTMLInputElement).value;
    const outputAddr = (document.getElementById("qp-output") as HTMLInputElement).value;

    if (!QAddr || !cAddr || !AAddr || !bAddr || !outputAddr) {
      setStatus("Please fill in all range fields", "error");
      return;
    }

    const QData = await readRange(QAddr);
    const cData = await readRange(cAddr);
    const AData = await readRange(AAddr);
    const bData = await readRange(bAddr);

    const c = cData.flat();
    const b = bData.flat();
    const n = c.length;

    const x = variable(n);
    const QConst = constant(QData);
    const cConst = constant(c);

    const objective = quadForm(x, QConst).mul(0.5).add(dot(cConst, x));

    const constraints = [];
    for (let i = 0; i < AData.length; i++) {
      const row = constant(AData[i]);
      constraints.push(dot(row, x).le(b[i]));
    }
    constraints.push(x.ge(0));

    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    const solution = result.valueOf(x);
    const solutionFlat = Array.isArray(solution) ? solution.flat() : [solution];
    const optVal = result.value ?? 0;

    const output: (number | string)[][] = [
      ["Optimal", optVal],
      ...solutionFlat.map((v, i) => [`x[${i}]`, v]),
    ];
    await writeRange(outputAddr, output);

    setStatus(`Solved! Optimal value: ${optVal.toFixed(6)}`, "success");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${msg}`, "error");
  }
}

// Solve Portfolio Optimization
async function solvePortfolio(): Promise<void> {
  try {
    setStatus("Optimizing portfolio...", "info");
    await ensureWasm();

    const returnsAddr = (document.getElementById("port-returns") as HTMLInputElement).value;
    const covAddr = (document.getElementById("port-cov") as HTMLInputElement).value;
    const gammaStr = (document.getElementById("port-gamma") as HTMLInputElement).value;
    const outputAddr = (document.getElementById("port-output") as HTMLInputElement).value;

    if (!returnsAddr || !covAddr || !outputAddr) {
      setStatus("Please fill in all range fields", "error");
      return;
    }

    const returnsData = await readRange(returnsAddr);
    const covData = await readRange(covAddr);
    const gamma = parseFloat(gammaStr) || 1;

    const mu = returnsData.flat();
    const n = mu.length;

    const w = variable(n);
    const muConst = constant(mu);
    const SigmaConst = constant(covData);

    const expectedReturn = dot(muConst, w);
    const variance = quadForm(w, SigmaConst);
    const objective = expectedReturn.neg().add(variance.mul(gamma));

    const constraints = [
      w.sum().eq(1),
      w.ge(0),
    ];

    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    const weights = result.valueOf(w);
    const weightsFlat = Array.isArray(weights) ? weights.flat() : [weights];

    // Compute expected return
    let optReturn = 0;
    for (let i = 0; i < weightsFlat.length; i++) {
      optReturn += mu[i] * weightsFlat[i];
    }

    const output: (number | string)[][] = [
      ["Exp Return", optReturn],
      ...weightsFlat.map((v, i) => [`w[${i}]`, v]),
    ];
    await writeRange(outputAddr, output);

    setStatus(`Optimized! Expected return: ${(optReturn * 100).toFixed(2)}%`, "success");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${msg}`, "error");
  }
}

// Solve Mixed-Integer Linear Program
async function solveMILP(): Promise<void> {
  try {
    setStatus("Solving MILP...", "info");
    await ensureWasm();

    const cAddr = (document.getElementById("milp-c") as HTMLInputElement).value;
    const AAddr = (document.getElementById("milp-A") as HTMLInputElement).value;
    const bAddr = (document.getElementById("milp-b") as HTMLInputElement).value;
    const typesAddr = (document.getElementById("milp-types") as HTMLInputElement).value;
    const sense = (document.getElementById("milp-sense") as HTMLSelectElement).value;
    const outputAddr = (document.getElementById("milp-output") as HTMLInputElement).value;

    if (!cAddr || !AAddr || !bAddr || !typesAddr || !outputAddr) {
      setStatus("Please fill in all range fields", "error");
      return;
    }

    const cData = await readRange(cAddr);
    const AData = await readRange(AAddr);
    const bData = await readRange(bAddr);
    const typesData = await readRange(typesAddr);

    const c = cData.flat();
    const b = bData.flat();
    const types = typesData.flat().map((t) => String(t).toUpperCase());
    const n = c.length;

    if (types.length !== n) {
      setStatus(`Variable types (${types.length}) must match objective (${n})`, "error");
      return;
    }

    // Create individual variables with appropriate options
    const vars: ReturnType<typeof scalarVar>[] = [];
    for (let i = 0; i < n; i++) {
      const type = types[i];
      if (type === "B") {
        vars.push(scalarVar({ binary: true }));
      } else if (type === "I") {
        vars.push(scalarVar({ integer: true, nonneg: true }));
      } else {
        vars.push(scalarVar({ nonneg: true }));
      }
    }

    // Build objective: sum of c[i] * x[i]
    let objective = vars[0].mul(c[0]);
    for (let i = 1; i < n; i++) {
      objective = objective.add(vars[i].mul(c[i]));
    }

    if (sense === "max") {
      objective = objective.neg();
    }

    // Constraints: Ax <= b (sum of A[i][j] * x[j] <= b[i])
    const constraints = [];
    for (let i = 0; i < AData.length; i++) {
      let rowExpr = vars[0].mul(AData[i][0]);
      for (let j = 1; j < n; j++) {
        rowExpr = rowExpr.add(vars[j].mul(AData[i][j]));
      }
      constraints.push(rowExpr.le(b[i]));
    }

    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    let optVal = result.value ?? 0;
    if (sense === "max") {
      optVal = -optVal;
    }

    // Extract solution from individual variables
    const solutionFlat: number[] = [];
    for (const v of vars) {
      const val = result.valueOf(v);
      const num = Array.isArray(val) ? val[0] : (typeof val === 'object' ? Object.values(val)[0] : val);
      solutionFlat.push(num as number);
    }

    const output: (number | string)[][] = [
      ["Optimal", optVal],
      ...solutionFlat.map((v, i) => [`x[${i}] (${types[i]})`, v ?? 0]),
    ];
    await writeRange(outputAddr, output);

    setStatus(`Solved! Optimal value: ${optVal.toFixed(6)}`, "success");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setStatus(`Error: ${msg}`, "error");
  }
}

// Expose functions globally for HTML onclick handlers
declare global {
  interface Window {
    selectRange: typeof selectRange;
    solveLP: typeof solveLP;
    solveQP: typeof solveQP;
    solvePortfolio: typeof solvePortfolio;
    solveMILP: typeof solveMILP;
  }
}

window.selectRange = selectRange;
window.solveLP = solveLP;
window.solveQP = solveQP;
window.solvePortfolio = solvePortfolio;
window.solveMILP = solveMILP;

// Initialize when Office is ready
Office.onReady(() => {
  setupTabs();
  problemBuilder.init();
  setStatus("Ready. Select ranges and click Solve.", "info");
});
