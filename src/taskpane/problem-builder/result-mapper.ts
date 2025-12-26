/**
 * Result Mapper
 *
 * Maps cvxjs solution values back to named variables.
 */

import type { Expr } from "cvxjs";
import type { SolveResult, VariableResult, VariableDefinition } from "./types.js";

interface SolutionLike {
  status?: string;
  value?: number;
  valueOf: (expr: Expr) => unknown;
}

/**
 * Maps a cvxjs solution to a SolveResult with named variables
 */
export function mapSolution(
  solution: SolutionLike,
  variableMap: Map<string, Expr>,
  variableDefinitions: VariableDefinition[]
): SolveResult {
  // Check for non-optimal status
  const status = solution.status?.toLowerCase() ?? "optimal";

  if (status.includes("infeasible")) {
    return {
      status: "infeasible",
      variables: [],
      constraints: [],
      errorMessage:
        "No feasible solution exists. The constraints cannot all be satisfied simultaneously.",
    };
  }

  if (status.includes("unbounded")) {
    return {
      status: "unbounded",
      variables: [],
      constraints: [],
      errorMessage:
        "The problem is unbounded. The objective can be improved indefinitely.",
    };
  }

  if (!status.includes("optimal") && !status.includes("solved")) {
    return {
      status: "error",
      variables: [],
      constraints: [],
      errorMessage: `Solver returned status: ${solution.status}`,
    };
  }

  // Extract variable values
  const variableResults: VariableResult[] = [];

  for (const varDef of variableDefinitions) {
    const expr = variableMap.get(varDef.name);
    if (!expr) continue;

    try {
      const rawValue = solution.valueOf(expr);
      const values = extractValues(rawValue);

      variableResults.push({
        name: varDef.name,
        values,
      });
    } catch {
      // Skip variables that can't be extracted
      variableResults.push({
        name: varDef.name,
        values: [],
      });
    }
  }

  return {
    status: "optimal",
    objectiveValue: solution.value,
    variables: variableResults,
    constraints: [], // Constraint status could be added later with dual values
  };
}

/**
 * Extract numeric values from cvxjs valueOf result
 *
 * cvxjs returns different formats:
 * - Object like {"0": val, "1": val}
 * - Array
 * - Single number
 */
function extractValues(rawValue: unknown): number[] {
  if (rawValue === null || rawValue === undefined) {
    return [];
  }

  // Single number
  if (typeof rawValue === "number") {
    return [rawValue];
  }

  // Array
  if (Array.isArray(rawValue)) {
    return rawValue.flat(Infinity).map((v) => Number(v));
  }

  // Object like {"0": val, "1": val}
  if (typeof rawValue === "object") {
    const values = Object.values(rawValue as Record<string, unknown>);
    return values.map((v) => Number(v));
  }

  return [];
}

/**
 * Format solution values for display
 */
export function formatValues(values: number[], precision = 6): string {
  if (values.length === 0) return "[]";
  if (values.length === 1) return values[0].toFixed(precision);

  const formatted = values.map((v) => v.toFixed(precision)).join(", ");
  return `[${formatted}]`;
}

/**
 * Round values for cleaner display (removes floating point noise)
 */
export function roundValues(values: number[], precision = 6): number[] {
  const factor = Math.pow(10, precision);
  return values.map((v) => Math.round(v * factor) / factor);
}
