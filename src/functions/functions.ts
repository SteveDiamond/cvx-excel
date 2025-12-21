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
} from "cvxjs";
import {
  rangeToVector,
  rangeToMatrix,
  solutionToColumn,
  getVectorLength,
  getRangeDimensions,
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

    return solutionToColumn(optVal, Array.isArray(solution) ? solution.flat() : [solution]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return [[`Error: ${msg}`]] as unknown as number[][];
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
    return solutionToColumn(optVal, Array.isArray(solution) ? solution.flat() : [solution]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return [[`Error: ${msg}`]] as unknown as number[][];
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
    const weightsFlat = Array.isArray(weights) ? weights.flat() : [weights];

    // Compute expected return of optimal portfolio
    let optExpectedReturn = 0;
    for (let i = 0; i < weightsFlat.length; i++) {
      optExpectedReturn += mu[i] * weightsFlat[i];
    }

    return solutionToColumn(optExpectedReturn, weightsFlat);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return [[`Error: ${msg}`]] as unknown as number[][];
  }
}

// Register functions with Office.js custom function runtime
declare const CustomFunctions: {
  associate: (name: string, fn: Function) => void;
};

if (typeof CustomFunctions !== "undefined") {
  CustomFunctions.associate("LP", LP);
  CustomFunctions.associate("QP", QP);
  CustomFunctions.associate("PORTFOLIO", PORTFOLIO);
}
