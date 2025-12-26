import type { CvxNode, CvxFunctionCall, CvxBinaryOp } from '../parser/cvx-ast';
import { describeNode } from '../parser/ast-transformer';
import type { DcpResult, DcpError, DcpContext, DcpErrorCode } from './types';
import { dcpValid, dcpInvalid } from './types';
import { isValidObjectiveCurvature, isValidConstraintCurvature } from './curvature-rules';
import { getFunctionInfo } from './function-registry';
import { getSuggestion } from './error-suggestions';

/**
 * Analyze a CVX AST for DCP compliance
 */
export function analyzeDcp(node: CvxNode, context?: DcpContext): DcpResult {
  // First check for parse/transform errors
  if (node.type === 'error') {
    return dcpInvalid({
      code: 'PARSE_ERROR',
      message: node.message,
      span: node.span,
    });
  }

  // Check for unresolved references
  if (node.type === 'cell-ref' || node.type === 'range-ref') {
    return dcpInvalid({
      code: 'UNRESOLVED_REFERENCE',
      message: `Unresolved cell reference: ${node.type === 'cell-ref' ? node.address : `${node.startAddress}:${node.endAddress}`}`,
      span: node.span,
      suggestion: 'Register this range as a variable or ensure it contains numeric data.',
    });
  }

  // Collect errors from the tree
  const errors: DcpError[] = [];
  collectErrors(node, errors);

  // Check curvature based on context
  if (context) {
    const contextError = checkContextCurvature(node, context);
    if (contextError) {
      errors.push(contextError);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      curvature: node.curvature,
      sign: node.sign,
      errors,
      warnings: [],
    };
  }

  return dcpValid(node.curvature, node.sign);
}

/**
 * Recursively collect DCP errors from the tree
 */
function collectErrors(node: CvxNode, errors: DcpError[]): void {
  switch (node.type) {
    case 'error':
      errors.push({
        code: 'PARSE_ERROR',
        message: node.message,
        span: node.span,
      });
      break;

    case 'binary-op':
      // Check for bilinear products
      if (node.operator === '*' && node.curvature === 'unknown') {
        if (node.left.curvature !== 'constant' && node.right.curvature !== 'constant') {
          const error: DcpError = {
            code: 'BILINEAR_PRODUCT',
            message: `Product of two non-constant expressions is bilinear (non-convex): ${describeNode(node.left)} * ${describeNode(node.right)}`,
            span: node.span,
          };
          error.suggestion = getSuggestion(error.code, node);
          errors.push(error);
        }
      }

      // Check for division by non-constant
      if (node.operator === '/' && node.right.curvature !== 'constant') {
        const error: DcpError = {
          code: 'VARIABLE_DIVISION',
          message: `Cannot divide by a non-constant expression: ${describeNode(node.right)}`,
          span: node.span,
        };
        error.suggestion = getSuggestion(error.code, node);
        errors.push(error);
      }

      // Check for non-constant power
      if (node.operator === '^' && node.curvature === 'unknown') {
        if (node.right.curvature !== 'constant') {
          const error: DcpError = {
            code: 'NON_CONSTANT_POWER',
            message: `Exponent must be a constant: ${describeNode(node.right)}`,
            span: node.span,
          };
          error.suggestion = getSuggestion(error.code, node);
          errors.push(error);
        }
      }

      // Recurse
      collectErrors(node.left, errors);
      collectErrors(node.right, errors);
      break;

    case 'unary-op':
      collectErrors(node.operand, errors);
      break;

    case 'function-call':
      // Check if function is supported
      const funcInfo = getFunctionInfo(node.name);
      if (!funcInfo) {
        const error: DcpError = {
          code: 'UNKNOWN_FUNCTION',
          message: `Unknown or unsupported function: ${node.name}`,
          span: node.span,
        };
        error.suggestion = getSuggestion(error.code, node);
        errors.push(error);
      }

      // Recurse into arguments
      for (const arg of node.args) {
        collectErrors(arg, errors);
      }
      break;

    // Leaf nodes don't have errors to collect
    case 'number':
    case 'variable':
    case 'parameter':
    case 'cell-ref':
    case 'range-ref':
      break;
  }
}

/**
 * Check if curvature is valid for the given context
 */
function checkContextCurvature(node: CvxNode, context: DcpContext): DcpError | null {
  const { role, sense, operator } = context;

  if (role === 'objective' && sense) {
    if (!isValidObjectiveCurvature(node.curvature, sense)) {
      const expected = sense === 'minimize' ? 'convex (or affine)' : 'concave (or affine)';
      const code: DcpErrorCode = sense === 'minimize' ? 'NON_CONVEX_OBJECTIVE' : 'NON_CONCAVE_OBJECTIVE';

      const error: DcpError = {
        code,
        message: `Cannot ${sense} a ${node.curvature} expression. Expected ${expected}.`,
        span: node.span,
      };
      error.suggestion = getSuggestion(code, node, context);
      return error;
    }
  }

  if ((role === 'constraint-lhs' || role === 'constraint-rhs') && operator) {
    // For constraint checking, we need both LHS and RHS
    // This is typically checked at a higher level with both sides
  }

  return null;
}

/**
 * Check a complete constraint for DCP compliance
 */
export function analyzeConstraint(
  lhs: CvxNode,
  rhs: CvxNode,
  operator: '<=' | '>=' | '=='
): DcpResult {
  // First analyze each side individually
  const lhsResult = analyzeDcp(lhs);
  const rhsResult = analyzeDcp(rhs);

  const errors: DcpError[] = [...lhsResult.errors, ...rhsResult.errors];

  // Check constraint curvature validity
  if (!isValidConstraintCurvature(lhs.curvature, rhs.curvature, operator)) {
    let message: string;
    let suggestion: string;

    if (operator === '==') {
      message = `Equality constraints require both sides to be affine. Got LHS: ${lhs.curvature}, RHS: ${rhs.curvature}`;
      suggestion = 'Reformulate as inequality constraints or ensure both sides are linear in the variables.';
    } else if (operator === '<=') {
      message = `For <= constraints: LHS must be convex/affine, RHS must be concave/affine. Got LHS: ${lhs.curvature}, RHS: ${rhs.curvature}`;
      if (lhs.curvature === 'concave') {
        suggestion = 'Try reversing the constraint: RHS >= LHS';
      } else {
        suggestion = 'Reformulate the constraint to satisfy DCP rules.';
      }
    } else {
      message = `For >= constraints: LHS must be concave/affine, RHS must be convex/affine. Got LHS: ${lhs.curvature}, RHS: ${rhs.curvature}`;
      if (lhs.curvature === 'convex') {
        suggestion = 'Try reversing the constraint: RHS <= LHS';
      } else {
        suggestion = 'Reformulate the constraint to satisfy DCP rules.';
      }
    }

    errors.push({
      code: 'WRONG_CURVATURE_INEQUALITY',
      message,
      suggestion,
    });
  }

  if (errors.length > 0) {
    return {
      valid: false,
      curvature: 'unknown',
      sign: 'unknown',
      errors,
      warnings: [],
    };
  }

  // Constraint is valid - return affine as the "overall" curvature
  return dcpValid('affine');
}

/**
 * Get a human-readable curvature badge
 */
export function getCurvatureBadge(curvature: string): string {
  switch (curvature) {
    case 'constant':
      return '[Constant]';
    case 'affine':
      return '[Affine]';
    case 'convex':
      return '[Convex]';
    case 'concave':
      return '[Concave]';
    case 'unknown':
      return '[Non-DCP]';
    default:
      return '[?]';
  }
}

/**
 * Get curvature color class for UI
 */
export function getCurvatureClass(curvature: string): string {
  switch (curvature) {
    case 'constant':
    case 'affine':
      return 'curvature-affine';
    case 'convex':
      return 'curvature-convex';
    case 'concave':
      return 'curvature-concave';
    default:
      return 'curvature-invalid';
  }
}
