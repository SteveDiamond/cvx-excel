/**
 * CVX Excel Custom Functions
 *
 * These functions are exposed to Excel as =CVX.LP(), =CVX.QP(), etc.
 */

import {
  variable,
  constant,
  Problem,
  quadForm,
  dot,
  loadWasm,
  scalarVar,
  InfeasibleError,
  UnboundedError,
  DcpError,
} from "cvxjs";
import {
  rangeToVector,
  rangeToMatrix,
  solutionToColumn,
  getVectorLength,
} from "../shared/excel-bridge.js";

// WASM initialization state
let wasmReady = false;
let wasmInitPromise: Promise<void> | null = null;

async function ensureWasm(): Promise<void> {
  if (wasmReady) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = loadWasm().then(() => {
    wasmReady = true;
  });
  return wasmInitPromise;
}

/**
 * Format errors with business-friendly messages
 */
function formatError(error: unknown): string {
  if (error instanceof InfeasibleError) {
    return "No Solution: Your constraints cannot all be satisfied simultaneously. Try relaxing some constraints.";
  }
  if (error instanceof UnboundedError) {
    return "Unbounded: The objective can be improved indefinitely. Check that you have enough constraints.";
  }
  if (error instanceof DcpError) {
    return `Invalid Problem Structure: ${error.message}. The problem may not be convex.`;
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

/**
 * Solve a Linear Program
 *
 * minimize (or maximize) c'x
 * subject to: Ax <= b, x >= 0
 *
 * @customfunction
 * @param c Objective coefficients (vector)
 * @param A Constraint matrix
 * @param b Constraint RHS (vector)
 * @param sense "min" or "max" (default: "min")
 * @returns Optimal value and solution [opt_val, x0, x1, ...]
 */
export async function LP(
  c: number[][],
  A: number[][],
  b: number[][],
  sense?: string
): Promise<number[][]> {
  try {
    await ensureWasm();

    const n = getVectorLength(c);
    const cVec = rangeToVector(c);
    const AMat = rangeToMatrix(A);
    const bVec = rangeToVector(b);

    // Create variable
    const x = variable(n);

    // Objective: c'x
    const cConst = constant(Array.from(cVec));
    let objective = dot(cConst, x);

    // Negate for maximization
    if (sense?.toLowerCase() === "max") {
      objective = objective.neg();
    }

    // Constraints: Ax <= b and x >= 0
    const constraints = [];

    // Ax <= b (one constraint per row)
    for (let i = 0; i < AMat.length; i++) {
      const row = constant(AMat[i]);
      constraints.push(dot(row, x).le(bVec[i]));
    }

    // x >= 0 (non-negativity)
    constraints.push(x.ge(0));

    // Solve
    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    // Extract solution
    const solution = result.valueOf(x);
    let optVal = result.value ?? 0;

    // Flip sign back for max problems
    if (sense?.toLowerCase() === "max") {
      optVal = -optVal;
    }

    // valueOf returns object like {"0": val, "1": val}, convert to array
    const solutionArray = Array.isArray(solution)
      ? solution.flat()
      : Object.values(solution) as number[];

    return solutionToColumn(optVal, solutionArray);
  } catch (error) {
    return [[formatError(error)]] as unknown as number[][];
  }
}

/**
 * Solve a Quadratic Program
 *
 * minimize 0.5 * x'Qx + c'x
 * subject to: Ax <= b, x >= 0
 *
 * @customfunction
 * @param Q Quadratic cost matrix (n x n, positive semidefinite)
 * @param c Linear cost vector
 * @param A Constraint matrix
 * @param b Constraint RHS vector
 * @returns Optimal value and solution
 */
export async function QP(
  Q: number[][],
  c: number[][],
  A: number[][],
  b: number[][]
): Promise<number[][]> {
  try {
    await ensureWasm();

    const n = getVectorLength(c);
    const QMat = rangeToMatrix(Q);
    const cVec = rangeToVector(c);
    const AMat = rangeToMatrix(A);
    const bVec = rangeToVector(b);

    // Create variable
    const x = variable(n);

    // Objective: 0.5 * x'Qx + c'x
    const QConst = constant(QMat);
    const cConst = constant(Array.from(cVec));
    const objective = quadForm(x, QConst).mul(0.5).add(dot(cConst, x));

    // Constraints: Ax <= b and x >= 0
    const constraints = [];

    for (let i = 0; i < AMat.length; i++) {
      const row = constant(AMat[i]);
      constraints.push(dot(row, x).le(bVec[i]));
    }

    constraints.push(x.ge(0));

    // Solve
    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    const solution = result.valueOf(x);
    const optVal = result.value ?? 0;

    // valueOf returns object like {"0": val, "1": val}, convert to array
    const solutionArray = Array.isArray(solution)
      ? solution.flat()
      : Object.values(solution) as number[];

    return solutionToColumn(optVal, solutionArray);
  } catch (error) {
    return [[formatError(error)]] as unknown as number[][];
  }
}

/**
 * Optimize a Portfolio
 *
 * maximize returns'w - risk_aversion * w'Sigma*w
 * subject to: sum(w) = 1, w >= 0
 *
 * @customfunction
 * @param returns Expected returns vector
 * @param covariance Covariance matrix of returns
 * @param riskAversion Risk aversion parameter (default: 1)
 * @returns Optimal weights [expected_return, w0, w1, ...]
 */
export async function PORTFOLIO(
  returns: number[][],
  covariance: number[][],
  riskAversion?: number
): Promise<number[][]> {
  try {
    await ensureWasm();

    const n = getVectorLength(returns);
    const mu = rangeToVector(returns);
    const Sigma = rangeToMatrix(covariance);
    const gamma = riskAversion ?? 1;

    // Create weight variable
    const w = variable(n);

    // Expected return: mu'w
    const muConst = constant(Array.from(mu));
    const expectedReturn = dot(muConst, w);

    // Variance: w'Sigma*w
    const SigmaConst = constant(Sigma);
    const variance = quadForm(w, SigmaConst);

    // Objective: minimize -return + gamma * variance (equivalent to maximizing risk-adjusted return)
    const objective = expectedReturn.neg().add(variance.mul(gamma));

    // Constraints: weights sum to 1, non-negative
    const constraints = [
      w.sum().eq(1), // Fully invested
      w.ge(0), // No short selling
    ];

    // Solve
    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    const weights = result.valueOf(w);

    // valueOf returns object like {"0": val, "1": val}, convert to array
    const weightsArray = Array.isArray(weights)
      ? weights.flat()
      : Object.values(weights) as number[];

    // Compute expected return of optimal portfolio
    let optExpectedReturn = 0;
    for (let i = 0; i < weightsArray.length; i++) {
      optExpectedReturn += mu[i] * weightsArray[i];
    }

    return solutionToColumn(optExpectedReturn, weightsArray);
  } catch (error) {
    return [[formatError(error)]] as unknown as number[][];
  }
}

/**
 * Solve a Mixed-Integer Linear Program
 *
 * minimize (or maximize) c'x
 * subject to: Ax <= b
 * with variable types: C=continuous, I=integer, B=binary
 *
 * @customfunction
 * @param c Objective coefficients (vector)
 * @param A Constraint matrix
 * @param b Constraint RHS (vector)
 * @param varTypes Variable types: "C" (continuous), "I" (integer), "B" (binary)
 * @param sense "min" or "max" (default: "min")
 * @returns Optimal value and solution [opt_val, x0, x1, ...]
 */
export async function MILP(
  c: number[][],
  A: number[][],
  b: number[][],
  varTypes: string[][],
  sense?: string
): Promise<number[][]> {
  try {
    await ensureWasm();

    const n = getVectorLength(c);
    const cVec = rangeToVector(c);
    const AMat = rangeToMatrix(A);
    const bVec = rangeToVector(b);

    // Parse variable types
    const types = varTypes.flat().map((t) => t?.toUpperCase() || "C");

    if (types.length !== n) {
      return [[`Error: Variable types (${types.length}) must match objective coefficients (${n})`]] as unknown as number[][];
    }

    // Create individual scalar variables with appropriate options
    const vars: ReturnType<typeof scalarVar>[] = [];
    for (let i = 0; i < n; i++) {
      const type = types[i];
      if (type === "B") {
        vars.push(scalarVar({ binary: true }));
      } else if (type === "I") {
        vars.push(scalarVar({ integer: true, nonneg: true }));
      } else {
        // Continuous, non-negative
        vars.push(scalarVar({ nonneg: true }));
      }
    }

    // Build objective: sum of c[i] * x[i]
    let objective = vars[0].mul(cVec[0]);
    for (let i = 1; i < n; i++) {
      objective = objective.add(vars[i].mul(cVec[i]));
    }

    // Negate for maximization
    if (sense?.toLowerCase() === "max") {
      objective = objective.neg();
    }

    // Constraints: Ax <= b (sum of A[i][j] * x[j] <= b[i])
    const constraints = [];
    for (let i = 0; i < AMat.length; i++) {
      let rowExpr = vars[0].mul(AMat[i][0]);
      for (let j = 1; j < n; j++) {
        rowExpr = rowExpr.add(vars[j].mul(AMat[i][j]));
      }
      constraints.push(rowExpr.le(bVec[i]));
    }

    // Solve
    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    // Extract solution from individual variables
    const solutionArray: number[] = [];
    for (const v of vars) {
      const val = result.valueOf(v);
      const num = Array.isArray(val) ? val[0] : (typeof val === 'object' ? Object.values(val)[0] : val);
      solutionArray.push(num as number);
    }
    let optVal = result.value ?? 0;

    // Flip sign back for max problems
    if (sense?.toLowerCase() === "max") {
      optVal = -optVal;
    }

    return solutionToColumn(optVal, solutionArray);
  } catch (error) {
    return [[formatError(error)]] as unknown as number[][];
  }
}

/**
 * Get Shadow Prices (Dual Values) for LP constraints
 *
 * Shows the marginal value of each constraint:
 * - Binding: constraint is active, shadow price shows value of relaxing it
 * - Slack: constraint is not active, shadow price is 0
 *
 * @customfunction
 * @param c Objective coefficients (vector)
 * @param A Constraint matrix
 * @param b Constraint RHS (vector)
 * @param sense "min" or "max" (default: "min")
 * @returns Constraint analysis [index, status, shadow_price] per row
 */
export async function SHADOW(
  c: number[][],
  A: number[][],
  b: number[][],
  sense?: string
): Promise<(string | number)[][]> {
  try {
    await ensureWasm();

    const n = getVectorLength(c);
    const cVec = rangeToVector(c);
    const AMat = rangeToMatrix(A);
    const bVec = rangeToVector(b);

    // Create variable
    const x = variable(n);

    // Objective: c'x
    const cConst = constant(Array.from(cVec));
    let objective = dot(cConst, x);

    // Negate for maximization
    const isMax = sense?.toLowerCase() === "max";
    if (isMax) {
      objective = objective.neg();
    }

    // Build constraints: Ax <= b and x >= 0
    // Track inequality constraints for dual values
    const inequalityConstraints = [];
    for (let i = 0; i < AMat.length; i++) {
      const row = constant(AMat[i]);
      inequalityConstraints.push(dot(row, x).le(bVec[i]));
    }

    // Add non-negativity constraint
    const constraints = [...inequalityConstraints, x.ge(0)];

    // Solve
    const result = await Problem.minimize(objective)
      .subjectTo(constraints)
      .solve();

    // Get dual values
    const duals = result.dual;

    if (!duals || duals.length === 0) {
      return [["Shadow prices not available for this problem type"]];
    }

    // Build output: header + one row per constraint
    const output: (string | number)[][] = [
      ["Constraint", "Status", "Shadow Price"],
    ];

    // Tolerance for determining binding vs slack
    const tolerance = 1e-6;

    for (let i = 0; i < AMat.length; i++) {
      // Dual values correspond to constraints in order
      const dualValue = i < duals.length ? duals[i] : 0;

      // Adjust sign for maximization problems
      const shadowPrice = isMax ? -dualValue : dualValue;

      const status = Math.abs(dualValue) > tolerance ? "Binding" : "Slack";

      output.push([i + 1, status, Math.round(shadowPrice * 1e6) / 1e6]);
    }

    return output;
  } catch (error) {
    return [[formatError(error)]] as unknown as (string | number)[][];
  }
}

// Register functions with Office.js custom function runtime
declare const CustomFunctions: {
  associate: (name: string, fn: Function) => void;
};

declare const Office: {
  onReady: (callback: () => void) => void;
};

// Wait for Office.js to be ready before registering functions
console.log("[CVX] functions.ts loaded, waiting for Office.onReady...");
Office.onReady(() => {
  console.log("[CVX] Office.onReady fired");
  if (typeof CustomFunctions !== "undefined") {
    console.log("[CVX] Registering custom functions...");
    CustomFunctions.associate("LP", LP);
    CustomFunctions.associate("QP", QP);
    CustomFunctions.associate("PORTFOLIO", PORTFOLIO);
    CustomFunctions.associate("MILP", MILP);
    CustomFunctions.associate("SHADOW", SHADOW);
    console.log("[CVX] Custom functions registered!");
  } else {
    console.log("[CVX] CustomFunctions not available");
  }
});
