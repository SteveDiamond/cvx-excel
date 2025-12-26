import {
  variable,
  constant,
  dot,
  sum,
  sumSquares,
  abs,
  maximum,
  minimum,
  sqrt,
  log,
  exp,
  le,
  ge,
  eq,
  type Expr,
  type Constraint,
} from 'cvxjs';

import type {
  CvxNode,
  CvxNumber,
  CvxVariable,
  CvxParameter,
  CvxBinaryOp,
  CvxUnaryOp,
  CvxFunctionCall,
} from '../parser/cvx-ast';

/**
 * Context for expression building
 */
export interface BuildContext {
  /** Map of variable names to cvxjs expressions */
  variableExprs: Map<string, Expr>;

  /** Map of variable names to dimensions */
  variableDimensions: Map<string, number>;
}

/**
 * Build a cvxjs expression from a CVX AST node
 */
export function buildExpression(node: CvxNode, context: BuildContext): Expr {
  switch (node.type) {
    case 'number':
      return buildNumber(node);

    case 'parameter':
      return buildParameter(node);

    case 'variable':
      return buildVariable(node, context);

    case 'binary-op':
      return buildBinaryOp(node, context);

    case 'unary-op':
      return buildUnaryOp(node, context);

    case 'function-call':
      return buildFunctionCall(node, context);

    case 'cell-ref':
    case 'range-ref':
      throw new Error(`Unresolved reference: ${node.type}. All references must be resolved to variables or parameters.`);

    case 'error':
      throw new Error(`Cannot build expression from error node: ${node.message}`);

    default:
      throw new Error(`Unknown node type: ${(node as CvxNode).type}`);
  }
}

/**
 * Build a constant expression from a number
 */
function buildNumber(node: CvxNumber): Expr {
  return constant(node.value);
}

/**
 * Build a constant expression from a parameter
 */
function buildParameter(node: CvxParameter): Expr {
  if (Array.isArray(node.value)) {
    return constant(node.value);
  }
  return constant(node.value);
}

/**
 * Build a variable reference expression
 */
function buildVariable(node: CvxVariable, context: BuildContext): Expr {
  const expr = context.variableExprs.get(node.name);
  if (!expr) {
    throw new Error(`Variable "${node.name}" not found in context`);
  }

  // If accessing a specific element, we need to handle this differently
  // cvxjs doesn't have a direct .at() method for element access
  // For now, we return the full variable and let the caller handle indexing
  // This is typically used in the context of dot products where the full vector is needed
  if (node.index !== undefined) {
    // TODO: Implement element-wise variable access if needed
    // For now, just return the full expression
    console.warn(`Element access x[${node.index}] not fully supported, using full variable`);
  }

  return expr;
}

/**
 * Build a binary operation expression
 */
function buildBinaryOp(node: CvxBinaryOp, context: BuildContext): Expr {
  const left = buildExpression(node.left, context);
  const right = buildExpression(node.right, context);

  switch (node.operator) {
    case '+':
      return left.add(right);

    case '-':
      return left.sub(right);

    case '*':
      return left.mul(right);

    case '/':
      return left.div(right);

    case '^':
      // Power is tricky - check if exponent is a known constant
      if (node.right.type === 'number') {
        const exp = (node.right as CvxNumber).value;
        if (exp === 2) {
          // x^2 - use element-wise square
          return left.mul(left);
        }
        if (exp === 0.5) {
          // x^0.5 = sqrt
          return sqrt(left);
        }
        // General power - may not be supported directly
        throw new Error(`Power with exponent ${exp} not directly supported. Use SQRT for x^0.5 or multiply for x^2.`);
      }
      throw new Error('Non-constant exponents not supported');

    case '=':
    case '<>':
    case '<':
    case '>':
    case '<=':
    case '>=':
      throw new Error(`Comparison operator "${node.operator}" should not appear in expression building. Use constraint building instead.`);

    default:
      throw new Error(`Unsupported operator: ${node.operator}`);
  }
}

/**
 * Build a unary operation expression
 */
function buildUnaryOp(node: CvxUnaryOp, context: BuildContext): Expr {
  const operand = buildExpression(node.operand, context);

  switch (node.operator) {
    case '-':
      return operand.neg();

    case '+':
      return operand;

    case '%':
      // Percentage: divide by 100
      return operand.div(constant(100));

    default:
      throw new Error(`Unsupported unary operator: ${node.operator}`);
  }
}

/**
 * Build a function call expression
 */
function buildFunctionCall(node: CvxFunctionCall, context: BuildContext): Expr {
  const funcName = node.name.toUpperCase();
  const args = node.args.map(arg => buildExpression(arg, context));

  switch (funcName) {
    case 'SUM':
      // SUM of multiple arguments or a single vector
      if (args.length === 1) {
        return sum(args[0]);
      }
      // Sum of multiple scalars: add them together
      return args.reduce((acc, arg) => acc.add(arg));

    case 'SUMPRODUCT':
      // Dot product of two vectors
      if (args.length !== 2) {
        throw new Error('SUMPRODUCT requires exactly 2 arguments');
      }
      return dot(args[0], args[1]);

    case 'SUMSQ':
      // Sum of squares
      if (args.length === 1) {
        return sumSquares(args[0]);
      }
      // Multiple arguments: sum their squares
      return args.map(a => sumSquares(a)).reduce((acc, sq) => acc.add(sq));

    case 'ABS':
      if (args.length !== 1) {
        throw new Error('ABS requires exactly 1 argument');
      }
      return abs(args[0]);

    case 'MAX':
      if (args.length === 0) {
        throw new Error('MAX requires at least 1 argument');
      }
      if (args.length === 1) {
        return maximum(args[0]);
      }
      // max of multiple arguments
      return args.reduce((acc, arg) => maximum(acc, arg));

    case 'MIN':
      if (args.length === 0) {
        throw new Error('MIN requires at least 1 argument');
      }
      if (args.length === 1) {
        return minimum(args[0]);
      }
      // min of multiple arguments
      return args.reduce((acc, arg) => minimum(acc, arg));

    case 'SQRT':
      if (args.length !== 1) {
        throw new Error('SQRT requires exactly 1 argument');
      }
      return sqrt(args[0]);

    case 'LOG':
    case 'LN':
      if (args.length !== 1) {
        throw new Error(`${funcName} requires exactly 1 argument`);
      }
      return log(args[0]);

    case 'EXP':
      if (args.length !== 1) {
        throw new Error('EXP requires exactly 1 argument');
      }
      return exp(args[0]);

    case 'AVERAGE':
      // Average = sum / count
      if (args.length === 0) {
        throw new Error('AVERAGE requires at least 1 argument');
      }
      const sumExpr = args.length === 1 ? sum(args[0]) : args.reduce((acc, arg) => acc.add(arg));
      // Need to know the count - this is tricky with vectors
      throw new Error('AVERAGE not yet fully supported. Use SUM(x)/n manually.');

    case 'MMULT':
      throw new Error('MMULT (matrix multiplication) is planned for Phase 2');

    case 'TRANSPOSE':
      throw new Error('TRANSPOSE is planned for Phase 2');

    default:
      throw new Error(`Unsupported function: ${funcName}`);
  }
}

/**
 * Build a constraint expression (LHS op RHS)
 */
export function buildConstraint(
  lhs: CvxNode,
  rhs: CvxNode,
  operator: '<=' | '>=' | '==',
  context: BuildContext
): Constraint {
  const lhsExpr = buildExpression(lhs, context);
  const rhsExpr = buildExpression(rhs, context);

  switch (operator) {
    case '<=':
      return le(lhsExpr, rhsExpr);

    case '>=':
      return ge(lhsExpr, rhsExpr);

    case '==':
      return eq(lhsExpr, rhsExpr);

    default:
      throw new Error(`Unsupported constraint operator: ${operator}`);
  }
}

/**
 * Create the build context from variable definitions
 */
export function createBuildContext(
  variables: Array<{ name: string; dimension: number; expr?: Expr }>
): BuildContext {
  const variableExprs = new Map<string, Expr>();
  const variableDimensions = new Map<string, number>();

  for (const v of variables) {
    const expr = v.expr ?? variable(v.dimension);
    variableExprs.set(v.name, expr);
    variableDimensions.set(v.name, v.dimension);
  }

  return { variableExprs, variableDimensions };
}
