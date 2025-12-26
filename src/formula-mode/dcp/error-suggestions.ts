import type { CvxNode, CvxFunctionCall, CvxBinaryOp } from '../parser/cvx-ast';
import { describeNode } from '../parser/ast-transformer';
import type { DcpErrorCode, DcpContext } from './types';
import { getSupportedFunctions } from './function-registry';

/**
 * Get a helpful suggestion for a DCP error
 */
export function getSuggestion(
  code: DcpErrorCode,
  node: CvxNode,
  context?: DcpContext
): string {
  switch (code) {
    case 'BILINEAR_PRODUCT':
      return getBilinearSuggestion(node as CvxBinaryOp);

    case 'VARIABLE_DIVISION':
      return 'Division by variables is not DCP-compliant. Try reformulating: multiply both sides by the denominator, or use a constant divisor.';

    case 'NON_CONSTANT_POWER':
      return 'The exponent must be a constant value. Use a fixed number like x^2 or x^0.5, not x^y.';

    case 'UNKNOWN_FUNCTION':
      return getUnknownFunctionSuggestion(node as CvxFunctionCall);

    case 'NON_CONVEX_OBJECTIVE':
      return getNonConvexObjectiveSuggestion(node, context);

    case 'NON_CONCAVE_OBJECTIVE':
      return getNonConcaveObjectiveSuggestion(node, context);

    case 'NON_AFFINE_EQUALITY':
      return 'Equality constraints (==) require both sides to be affine (linear). Use inequality constraints for convex/concave expressions.';

    case 'WRONG_CURVATURE_INEQUALITY':
      return getWrongCurvatureSuggestion(node, context);

    case 'PARSE_ERROR':
      return 'Check the formula syntax. Common issues: missing parentheses, unknown cell references, or unsupported operators.';

    case 'UNRESOLVED_REFERENCE':
      return 'This cell reference could not be resolved. Make sure the cell contains a number, or register it as an optimization variable.';

    default:
      return 'Check the DCP rules for this expression type.';
  }
}

/**
 * Suggestion for bilinear product errors
 */
function getBilinearSuggestion(node: CvxBinaryOp): string {
  const leftDesc = describeNode(node.left);
  const rightDesc = describeNode(node.right);

  // Find variable names if possible
  const leftVar = findVariableName(node.left);
  const rightVar = findVariableName(node.right);

  if (leftVar && rightVar) {
    return `Product of variables "${leftVar}" and "${rightVar}" is bilinear (non-convex). ` +
      `Define one as a constant by moving its values to data cells (not a variable range).`;
  }

  return `Product ${leftDesc} * ${rightDesc} is bilinear. ` +
    'One factor must be a constant for DCP compliance. ' +
    'Move one term to data cells or reformulate the expression.';
}

/**
 * Suggestion for unknown function errors
 */
function getUnknownFunctionSuggestion(node: CvxFunctionCall): string {
  const supported = getSupportedFunctions();
  const funcName = node.name.toUpperCase();

  // Check for similar function names
  const similar = supported.filter(f =>
    f.includes(funcName.slice(0, 3)) || funcName.includes(f.slice(0, 3))
  );

  if (similar.length > 0) {
    return `Function "${funcName}" is not supported. Did you mean: ${similar.join(', ')}?`;
  }

  return `Function "${funcName}" is not supported. Supported functions: ${supported.slice(0, 8).join(', ')}...`;
}

/**
 * Suggestion for non-convex objective when minimizing
 */
function getNonConvexObjectiveSuggestion(node: CvxNode, context?: DcpContext): string {
  const curvature = node.curvature;

  if (curvature === 'concave') {
    return 'This expression is concave, which cannot be minimized. ' +
      'Try maximizing instead, or negate the expression: minimize(-f(x)) = maximize(f(x)).';
  }

  if (curvature === 'unknown') {
    // Look for specific patterns
    if (node.type === 'function-call') {
      const funcNode = node as CvxFunctionCall;
      if (funcNode.name === 'LOG' || funcNode.name === 'LN') {
        return 'LOG/LN is concave. To minimize, either maximize instead, or use -LOG(x).';
      }
      if (funcNode.name === 'SQRT') {
        return 'SQRT is concave. To minimize, maximize instead, or minimize x^2 which is convex.';
      }
    }

    return 'This expression has unknown curvature (possibly non-convex). ' +
      'Reformulate using supported DCP atoms: SUM, SUMPRODUCT, SUMSQ, ABS, MAX (for convex).';
  }

  return 'Reformulate the objective to be convex or affine for minimization.';
}

/**
 * Suggestion for non-concave objective when maximizing
 */
function getNonConcaveObjectiveSuggestion(node: CvxNode, context?: DcpContext): string {
  const curvature = node.curvature;

  if (curvature === 'convex') {
    return 'This expression is convex, which cannot be maximized. ' +
      'Try minimizing instead, or negate the expression: maximize(-f(x)) = minimize(f(x)).';
  }

  if (curvature === 'unknown') {
    if (node.type === 'function-call') {
      const funcNode = node as CvxFunctionCall;
      if (funcNode.name === 'SUMSQ') {
        return 'SUMSQ is convex. To maximize, minimize instead (or use -SUMSQ, but that is concave).';
      }
      if (funcNode.name === 'ABS') {
        return 'ABS is convex. To maximize, minimize instead.';
      }
    }

    return 'This expression has unknown curvature (possibly non-convex). ' +
      'Reformulate using supported DCP atoms: SUM, SUMPRODUCT, MIN, LOG, SQRT (for concave).';
  }

  return 'Reformulate the objective to be concave or affine for maximization.';
}

/**
 * Suggestion for wrong curvature in constraints
 */
function getWrongCurvatureSuggestion(node: CvxNode, context?: DcpContext): string {
  if (!context || !context.operator) {
    return 'Check the DCP rules: <= needs convex LHS, >= needs concave LHS, == needs affine both sides.';
  }

  const op = context.operator;

  if (op === '==') {
    return 'Equality constraints require affine (linear) expressions on both sides. ' +
      'Use inequalities for convex/concave expressions.';
  }

  if (op === '<=') {
    if (node.curvature === 'concave') {
      return 'Concave expressions cannot be on the LHS of <=. ' +
        'Try reversing: concave_expr >= rhs becomes rhs <= concave_expr.';
    }
  }

  if (op === '>=') {
    if (node.curvature === 'convex') {
      return 'Convex expressions cannot be on the LHS of >=. ' +
        'Try reversing: convex_expr <= rhs.';
    }
  }

  return 'Reformulate the constraint to satisfy DCP rules.';
}

/**
 * Find a variable name in a node tree
 */
function findVariableName(node: CvxNode): string | null {
  if (node.type === 'variable') {
    return node.name;
  }

  if (node.type === 'binary-op') {
    return findVariableName(node.left) || findVariableName(node.right);
  }

  if (node.type === 'unary-op') {
    return findVariableName(node.operand);
  }

  if (node.type === 'function-call') {
    for (const arg of node.args) {
      const name = findVariableName(arg);
      if (name) return name;
    }
  }

  return null;
}

/**
 * Format an error message with suggestion for display
 */
export function formatErrorWithSuggestion(
  message: string,
  suggestion?: string
): string {
  if (!suggestion) return message;
  return `${message}\n\nSuggestion: ${suggestion}`;
}
