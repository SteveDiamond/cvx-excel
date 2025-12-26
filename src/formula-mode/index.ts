/**
 * Formula Mode - Excel formula parsing with DCP verification
 *
 * This module provides:
 * 1. Excel formula parsing → CVX AST
 * 2. DCP (Disciplined Convex Programming) analysis
 * 3. cvxjs expression building
 *
 * Usage:
 * ```typescript
 * import { parseAndAnalyze, buildExpression } from './formula-mode';
 *
 * const result = await parseAndAnalyze(
 *   '=SUMPRODUCT(A1:A5, x)',
 *   { variables: [{ name: 'x', range: 'B1:B5' }], readRange }
 * );
 *
 * if (result.dcp.valid) {
 *   const expr = buildExpression(result.ast, context);
 * }
 * ```
 */

// Types
export type { Curvature, Sign, DcpResult, DcpError, DcpContext } from './dcp/types';
export type { CvxNode, CvxNodeType, CvxNumber, CvxVariable, CvxParameter, CvxFunctionCall, CvxBinaryOp, CvxUnaryOp } from './parser/cvx-ast';
export type { VariableDefinition } from './resolver/variable-resolver';
export type { BuildContext } from './builder/expression-builder';

// DCP utilities
export { dcpValid, dcpInvalid, dcpMerge } from './dcp/types';
export { getFunctionInfo, isFunctionSupported, getSupportedFunctions } from './dcp/function-registry';
export { analyzeDcp, analyzeConstraint, getCurvatureBadge, getCurvatureClass } from './dcp/analyzer';
export { getSuggestion, formatErrorWithSuggestion } from './dcp/error-suggestions';

// Curvature rules
export {
  composeAdd,
  composeSub,
  composeNeg,
  composeMul,
  composeDiv,
  composePower,
  isValidObjectiveCurvature,
  isValidConstraintCurvature,
} from './dcp/curvature-rules';

// Parser
export { parseFormula, describeNode, type TransformContext, type VariableInfo } from './parser/ast-transformer';
export { cvxNumber, cvxVariable, cvxParameter, cvxFunctionCall, cvxBinaryOp, cvxUnaryOp, cvxError, isConstant, involvesVariables } from './parser/cvx-ast';

// Resolver
export { VariableResolver, createResolver, expandRange, getRangeDimension, cellInRange, normalizeRange } from './resolver/variable-resolver';

// Builder
export { buildExpression, buildConstraint, createBuildContext } from './builder/expression-builder';

// ============ High-level API ============

import { parseFormula, type TransformContext } from './parser/ast-transformer';
import { analyzeDcp } from './dcp/analyzer';
import type { CvxNode } from './parser/cvx-ast';
import type { DcpResult, DcpContext } from './dcp/types';
import { VariableResolver } from './resolver/variable-resolver';

/**
 * Parse and analyze result
 */
export interface ParseAndAnalyzeResult {
  ast: CvxNode;
  dcp: DcpResult;
  description: string;
}

/**
 * High-level function to parse a formula and analyze DCP compliance
 */
export async function parseAndAnalyze(
  formula: string,
  options: {
    variables: Array<{ name: string; range: string }>;
    readRange: (range: string) => Promise<number[][]>;
    dcpContext?: DcpContext;
  }
): Promise<ParseAndAnalyzeResult> {
  // Build resolver
  const resolver = new VariableResolver();
  for (const v of options.variables) {
    resolver.registerVariable(v.name, v.range);
  }

  // Build transform context
  const context: TransformContext = {
    variables: resolver.getVariableDefinitions(),
    readRange: options.readRange,
    formula,
  };

  // Parse formula to CVX AST
  const ast = await parseFormula(formula, context);

  // Analyze DCP compliance
  const dcp = analyzeDcp(ast, options.dcpContext);

  // Generate description
  const { describeNode } = await import('./parser/ast-transformer');
  const description = describeNode(ast);

  return { ast, dcp, description };
}

/**
 * Quick validation of a formula (returns true/false)
 */
export async function isValidDcp(
  formula: string,
  options: {
    variables: Array<{ name: string; range: string }>;
    readRange: (range: string) => Promise<number[][]>;
    dcpContext?: DcpContext;
  }
): Promise<boolean> {
  const result = await parseAndAnalyze(formula, options);
  return result.dcp.valid;
}

/**
 * Get validation errors for a formula
 */
export async function getValidationErrors(
  formula: string,
  options: {
    variables: Array<{ name: string; range: string }>;
    readRange: (range: string) => Promise<number[][]>;
    dcpContext?: DcpContext;
  }
): Promise<string[]> {
  const result = await parseAndAnalyze(formula, options);
  return result.dcp.errors.map(e => e.suggestion ? `${e.message} (${e.suggestion})` : e.message);
}
