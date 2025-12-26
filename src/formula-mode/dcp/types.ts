/**
 * DCP (Disciplined Convex Programming) Type Definitions
 *
 * Curvature classification follows standard DCP rules:
 * - constant: Fixed value, no variables
 * - affine: Linear in variables (f(x) = Ax + b)
 * - convex: Convex function (f(tx + (1-t)y) <= tf(x) + (1-t)f(y))
 * - concave: Concave function (negative of convex)
 * - unknown: Cannot determine or non-convex
 */

export type Curvature = 'constant' | 'affine' | 'convex' | 'concave' | 'unknown';

export type Sign = 'positive' | 'negative' | 'zero' | 'unknown';

export type DcpErrorCode =
  | 'BILINEAR_PRODUCT'
  | 'VARIABLE_DIVISION'
  | 'NON_CONVEX_OBJECTIVE'
  | 'NON_CONCAVE_OBJECTIVE'
  | 'NON_AFFINE_EQUALITY'
  | 'WRONG_CURVATURE_INEQUALITY'
  | 'UNKNOWN_FUNCTION'
  | 'NON_CONSTANT_POWER'
  | 'PARSE_ERROR'
  | 'UNRESOLVED_REFERENCE';

export interface DcpError {
  code: DcpErrorCode;
  message: string;
  span?: { start: number; end: number };
  suggestion?: string;
}

export interface DcpWarning {
  message: string;
  span?: { start: number; end: number };
}

export interface DcpResult {
  valid: boolean;
  curvature: Curvature;
  sign: Sign;
  errors: DcpError[];
  warnings: DcpWarning[];
}

/**
 * Context for DCP analysis - what role is this expression playing?
 */
export interface DcpContext {
  role: 'objective' | 'constraint-lhs' | 'constraint-rhs';
  sense?: 'minimize' | 'maximize';
  operator?: '<=' | '>=' | '==';
}

/**
 * Create a valid DCP result
 */
export function dcpValid(curvature: Curvature, sign: Sign = 'unknown'): DcpResult {
  return { valid: true, curvature, sign, errors: [], warnings: [] };
}

/**
 * Create an invalid DCP result with an error
 */
export function dcpInvalid(error: DcpError, curvature: Curvature = 'unknown'): DcpResult {
  return { valid: false, curvature, sign: 'unknown', errors: [error], warnings: [] };
}

/**
 * Merge DCP results (for compound expressions)
 */
export function dcpMerge(a: DcpResult, b: DcpResult, mergedCurvature: Curvature, mergedSign: Sign): DcpResult {
  return {
    valid: a.valid && b.valid && mergedCurvature !== 'unknown',
    curvature: mergedCurvature,
    sign: mergedSign,
    errors: [...a.errors, ...b.errors],
    warnings: [...a.warnings, ...b.warnings],
  };
}
