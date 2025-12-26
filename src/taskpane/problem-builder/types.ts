/**
 * Type definitions for the Problem Builder
 */

import type { Curvature } from '../../formula-mode/dcp/types';

export type VarType = "continuous" | "integer" | "binary";

/** Input mode for objective and constraints */
export type InputMode = "cards" | "formula";

export interface VariableDefinition {
  id: string;
  name: string;
  dimensionMode: "manual" | "range";
  dimension: number;
  dimensionRange: string;
  varType: VarType;
  lowerBound: number | null; // null = -Infinity
  upperBound: number | null; // null = +Infinity
}

export type ConstraintOperator = "<=" | ">=" | "==";

export type ConstraintExprType =
  | "variable" // x >= 0, x <= b
  | "sum" // sum(x) == 1
  | "linear"; // A @ x <= b

export interface ConstraintDefinition {
  id: string;
  name: string;

  // Input mode: cards (structured) or formula (Excel formula)
  inputMode: InputMode;

  // === Card mode fields ===
  exprType: ConstraintExprType;
  variableName: string;
  operator: ConstraintOperator;
  rhsMode: "scalar" | "range";
  rhsScalar: number;
  rhsRange: string;
  lhsRange?: string; // For linear constraints (A matrix)

  // === Formula mode fields ===
  formulaLhsCell?: string;     // Cell containing LHS formula (e.g., "G2")
  formulaLhsText?: string;     // The formula text (e.g., "=SUM(B2:B6)")
  formulaRhsCell?: string;     // Cell containing RHS (e.g., "H2")
  formulaRhsText?: string;     // The RHS formula/value
  formulaCurvature?: Curvature; // Parsed curvature
  formulaParsedDesc?: string;  // Human-readable description (e.g., "sum(weights) == 1")
  formulaDcpValid?: boolean;   // DCP validation result
  formulaError?: string;       // Error message if invalid
}

export type ObjectiveSense = "minimize" | "maximize";

export interface LinearTerm {
  id: string;
  coefsRange: string;
  varName: string;
}

export interface QuadraticTerm {
  id: string;
  matrixRange: string;
  varName: string;
}

export interface ObjectiveDefinition {
  sense: ObjectiveSense;

  // Input mode: cards (structured) or formula (Excel formula)
  inputMode: InputMode;

  // === Card mode fields ===
  linearTerms: LinearTerm[];
  quadraticTerms: QuadraticTerm[];

  // === Formula mode fields ===
  formulaCell?: string;        // Cell containing objective formula (e.g., "F10")
  formulaText?: string;        // The formula text (e.g., "=SUMPRODUCT(A1:A5, x)")
  formulaCurvature?: Curvature; // Parsed curvature
  formulaParsedDesc?: string;  // Human-readable description (e.g., "dot(costs, weights)")
  formulaDcpValid?: boolean;   // DCP validation result
  formulaError?: string;       // Error message if invalid
}

export interface ProblemState {
  variables: VariableDefinition[];
  objective: ObjectiveDefinition;
  constraints: ConstraintDefinition[];
}

export interface VariableResult {
  name: string;
  values: number[];
}

export interface ConstraintResult {
  name: string;
  status: "active" | "slack";
  slackValue?: number;
}

export interface SolveResult {
  status: "optimal" | "infeasible" | "unbounded" | "error";
  objectiveValue?: number;
  variables: VariableResult[];
  constraints: ConstraintResult[];
  errorMessage?: string;
}

// Helper to create a default empty variable
export function createDefaultVariable(): VariableDefinition {
  return {
    id: crypto.randomUUID(),
    name: "",
    dimensionMode: "range",
    dimension: 1,
    dimensionRange: "",
    varType: "continuous",
    lowerBound: 0,
    upperBound: null,
  };
}

// Helper to create a default empty constraint
export function createDefaultConstraint(): ConstraintDefinition {
  return {
    id: crypto.randomUUID(),
    name: "",
    inputMode: "cards",
    exprType: "variable",
    variableName: "",
    operator: ">=",
    rhsMode: "scalar",
    rhsScalar: 0,
    rhsRange: "",
    lhsRange: "",
  };
}

// Helper to create a default linear term
export function createDefaultLinearTerm(): LinearTerm {
  return {
    id: crypto.randomUUID(),
    coefsRange: "",
    varName: "",
  };
}

// Helper to create a default quadratic term
export function createDefaultQuadraticTerm(): QuadraticTerm {
  return {
    id: crypto.randomUUID(),
    matrixRange: "",
    varName: "",
  };
}

// Helper to create a default objective
export function createDefaultObjective(): ObjectiveDefinition {
  return {
    sense: "minimize",
    inputMode: "cards",
    linearTerms: [],
    quadraticTerms: [],
  };
}

// Helper to create a default problem state
export function createDefaultProblemState(): ProblemState {
  return {
    variables: [],
    objective: createDefaultObjective(),
    constraints: [],
  };
}
