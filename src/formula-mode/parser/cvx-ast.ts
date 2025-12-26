import type { Curvature, Sign } from '../dcp/types';

/**
 * CVX Annotated AST - Excel formula AST enriched with DCP properties
 *
 * Each node carries curvature and sign information for DCP analysis.
 */

export type CvxNodeType =
  | 'number'
  | 'cell-ref'
  | 'range-ref'
  | 'variable'      // Resolved optimization variable
  | 'parameter'     // Constant data from Excel cells
  | 'binary-op'
  | 'unary-op'
  | 'function-call'
  | 'error';

/**
 * Base interface for all CVX AST nodes
 */
export interface CvxNodeBase {
  type: CvxNodeType;
  curvature: Curvature;
  sign: Sign;
  span: { start: number; end: number };
}

/**
 * Numeric literal: 42, 3.14, -1
 */
export interface CvxNumber extends CvxNodeBase {
  type: 'number';
  value: number;
}

/**
 * Single cell reference: A1, $B$2
 */
export interface CvxCellRef extends CvxNodeBase {
  type: 'cell-ref';
  address: string;
  sheet?: string;
  isAbsoluteRow: boolean;
  isAbsoluteCol: boolean;
}

/**
 * Range reference: A1:B5
 */
export interface CvxRangeRef extends CvxNodeBase {
  type: 'range-ref';
  startAddress: string;
  endAddress: string;
  sheet?: string;
}

/**
 * Resolved optimization variable
 */
export interface CvxVariable extends CvxNodeBase {
  type: 'variable';
  name: string;
  dimension: number;
  range?: string;     // Original Excel range: "B2:B6"
  index?: number;     // For element access: x[i]
}

/**
 * Parameter (constant data read from Excel)
 */
export interface CvxParameter extends CvxNodeBase {
  type: 'parameter';
  value: number | number[];
  range?: string;     // Source Excel range
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

/**
 * Binary operation: a + b, x * 2
 */
export interface CvxBinaryOp extends CvxNodeBase {
  type: 'binary-op';
  operator: BinaryOperator;
  left: CvxNode;
  right: CvxNode;
}

export type UnaryOperator = '-' | '+' | '%';

/**
 * Unary operation: -x, +x
 */
export interface CvxUnaryOp extends CvxNodeBase {
  type: 'unary-op';
  operator: UnaryOperator;
  operand: CvxNode;
}

/**
 * Function call: SUM(A1:A5), SUMPRODUCT(costs, x)
 */
export interface CvxFunctionCall extends CvxNodeBase {
  type: 'function-call';
  name: string;
  args: CvxNode[];
  cvxjsAtom?: string;   // Corresponding cvxjs function: 'dot', 'sum', etc.
}

/**
 * Parse/transform error
 */
export interface CvxError extends CvxNodeBase {
  type: 'error';
  message: string;
  originalText?: string;
}

/**
 * Union of all CVX node types
 */
export type CvxNode =
  | CvxNumber
  | CvxCellRef
  | CvxRangeRef
  | CvxVariable
  | CvxParameter
  | CvxBinaryOp
  | CvxUnaryOp
  | CvxFunctionCall
  | CvxError;

/**
 * Create a number node
 */
export function cvxNumber(value: number, span = { start: 0, end: 0 }): CvxNumber {
  const sign: Sign = value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero';
  return { type: 'number', value, curvature: 'constant', sign, span };
}

/**
 * Create a variable node
 */
export function cvxVariable(
  name: string,
  dimension: number,
  range?: string,
  span = { start: 0, end: 0 }
): CvxVariable {
  return {
    type: 'variable',
    name,
    dimension,
    range,
    curvature: 'affine',
    sign: 'unknown',
    span,
  };
}

/**
 * Create a parameter node (constant data)
 */
export function cvxParameter(
  value: number | number[],
  range?: string,
  span = { start: 0, end: 0 }
): CvxParameter {
  let sign: Sign = 'unknown';
  if (typeof value === 'number') {
    sign = value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero';
  } else if (value.length > 0) {
    const allPositive = value.every(v => v >= 0);
    const allNegative = value.every(v => v <= 0);
    if (allPositive && value.some(v => v > 0)) sign = 'positive';
    else if (allNegative && value.some(v => v < 0)) sign = 'negative';
    else if (value.every(v => v === 0)) sign = 'zero';
  }
  return { type: 'parameter', value, range, curvature: 'constant', sign, span };
}

/**
 * Create a function call node
 */
export function cvxFunctionCall(
  name: string,
  args: CvxNode[],
  curvature: Curvature = 'unknown',
  span = { start: 0, end: 0 }
): CvxFunctionCall {
  return { type: 'function-call', name, args, curvature, sign: 'unknown', span };
}

/**
 * Create a binary op node
 */
export function cvxBinaryOp(
  operator: BinaryOperator,
  left: CvxNode,
  right: CvxNode,
  curvature: Curvature = 'unknown',
  sign: Sign = 'unknown',
  span = { start: 0, end: 0 }
): CvxBinaryOp {
  return { type: 'binary-op', operator, left, right, curvature, sign, span };
}

/**
 * Create a unary op node
 */
export function cvxUnaryOp(
  operator: UnaryOperator,
  operand: CvxNode,
  curvature: Curvature = 'unknown',
  sign: Sign = 'unknown',
  span = { start: 0, end: 0 }
): CvxUnaryOp {
  return { type: 'unary-op', operator, operand, curvature, sign, span };
}

/**
 * Create an error node
 */
export function cvxError(message: string, originalText?: string, span = { start: 0, end: 0 }): CvxError {
  return { type: 'error', message, originalText, curvature: 'unknown', sign: 'unknown', span };
}

/**
 * Check if a node is a constant (number or parameter)
 */
export function isConstant(node: CvxNode): boolean {
  return node.curvature === 'constant';
}

/**
 * Check if a node involves variables
 */
export function involvesVariables(node: CvxNode): boolean {
  switch (node.type) {
    case 'variable':
      return true;
    case 'number':
    case 'parameter':
      return false;
    case 'binary-op':
      return involvesVariables(node.left) || involvesVariables(node.right);
    case 'unary-op':
      return involvesVariables(node.operand);
    case 'function-call':
      return node.args.some(involvesVariables);
    case 'cell-ref':
    case 'range-ref':
      return false; // Unresolved refs are treated as data
    case 'error':
      return false;
  }
}
