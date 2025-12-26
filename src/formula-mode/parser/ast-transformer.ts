import { tokenize } from 'excel-formula-tokenizer';
import { buildTree } from 'excel-formula-ast';

// Define node types based on excel-formula-ast's structure
interface CellNode {
  type: 'cell';
  key: string;
  refType?: 'relative' | 'mixed' | 'absolute';
}

interface CellRangeNode {
  type: 'cell-range';
  left: ASTNode;
  right: ASTNode;
}

interface FunctionNode {
  type: 'function';
  name: string;
  arguments: ASTNode[];
}

interface NumberNode {
  type: 'number';
  value: number;
}

interface TextNode {
  type: 'text';
  value: string;
}

interface BinaryExpressionNode {
  type: 'binary-expression';
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

interface UnaryExpressionNode {
  type: 'unary-expression';
  operator: string;
  operand: ASTNode;
}

interface LogicalNode {
  type: 'logical';
  value: boolean;
}

type ASTNode = CellNode | CellRangeNode | FunctionNode | NumberNode | TextNode | BinaryExpressionNode | UnaryExpressionNode | LogicalNode;

import type {
  CvxNode,
  CvxNumber,
  CvxCellRef,
  CvxRangeRef,
  CvxBinaryOp,
  CvxUnaryOp,
  CvxFunctionCall,
  BinaryOperator,
  UnaryOperator,
} from './cvx-ast';
import {
  cvxNumber,
  cvxVariable,
  cvxParameter,
  cvxFunctionCall,
  cvxBinaryOp,
  cvxUnaryOp,
  cvxError,
} from './cvx-ast';
import type { Curvature, Sign } from '../dcp/types';
import { composeAdd, composeSub, composeMul, composeDiv, composePower, addSign, subSign } from '../dcp/curvature-rules';
import { getFunctionInfo } from '../dcp/function-registry';

/**
 * Variable definition for resolution
 */
export interface VariableInfo {
  name: string;
  range: string;       // e.g., "B2:B6"
  cells: string[];     // e.g., ["B2", "B3", "B4", "B5", "B6"]
  dimension: number;
}

/**
 * Context for AST transformation
 */
export interface TransformContext {
  /** Registered optimization variables */
  variables: VariableInfo[];

  /** Function to read cell/range values from Excel */
  readRange: (range: string) => Promise<number[][]>;

  /** Current formula for error reporting */
  formula: string;
}

/**
 * Parse an Excel formula string and transform to CVX AST
 */
export async function parseFormula(
  formula: string,
  context: TransformContext
): Promise<CvxNode> {
  // Remove leading = if present
  const formulaText = formula.startsWith('=') ? formula.slice(1) : formula;

  try {
    // Tokenize and build raw AST
    const tokens = tokenize(formulaText);
    const ast = buildTree(tokens);

    // Transform to CVX AST
    return await transformNode(ast, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cvxError(`Parse error: ${message}`, formula);
  }
}

/**
 * Transform an excel-formula-ast node to CvxNode
 */
async function transformNode(
  node: ASTNode,
  context: TransformContext
): Promise<CvxNode> {
  switch (node.type) {
    case 'number':
      return cvxNumber(node.value as number);

    case 'text':
      // Text strings are treated as errors in optimization context
      return cvxError(`Text strings not supported: "${node.value}"`, String(node.value));

    case 'cell':
      return await transformCellRef(node, context);

    case 'cell-range':
      return await transformRangeRef(node, context);

    case 'function':
      return await transformFunction(node, context);

    case 'binary-expression':
      return await transformBinaryOp(node, context);

    case 'unary-expression':
      return await transformUnaryOp(node, context);

    default:
      return cvxError(`Unsupported node type: ${(node as ASTNode).type}`);
  }
}

/**
 * Transform a cell reference (A1, $B$2)
 */
async function transformCellRef(
  node: ASTNode,
  context: TransformContext
): Promise<CvxNode> {
  const address = getCellAddress(node);

  // Check if this cell is part of a registered variable
  for (const varInfo of context.variables) {
    const cellIndex = varInfo.cells.indexOf(address);
    if (cellIndex !== -1) {
      // This cell is a variable element
      const varNode = cvxVariable(varInfo.name, varInfo.dimension, varInfo.range);
      varNode.index = cellIndex;
      return varNode;
    }
  }

  // Not a variable - read as constant parameter
  try {
    const values = await context.readRange(address);
    const value = values[0]?.[0] ?? 0;
    return cvxParameter(value, address);
  } catch {
    // If we can't read, create an unresolved cell ref
    const key = (node as { key?: string }).key || '';
    const cellRef: CvxCellRef = {
      type: 'cell-ref',
      address,
      isAbsoluteRow: key.includes('$') && key.lastIndexOf('$') > 0,
      isAbsoluteCol: key.startsWith('$'),
      curvature: 'constant',
      sign: 'unknown',
      span: { start: 0, end: 0 },
    };
    return cellRef;
  }
}

/**
 * Transform a range reference (A1:B5)
 */
async function transformRangeRef(
  node: ASTNode,
  context: TransformContext
): Promise<CvxNode> {
  if (node.type !== 'cell-range') {
    return cvxError('Expected cell-range node');
  }
  const rangeNode = node as CellRangeNode;
  const startAddress = getCellAddress(rangeNode.left);
  const endAddress = getCellAddress(rangeNode.right);
  const rangeAddress = `${startAddress}:${endAddress}`;

  // Check if this range exactly matches a registered variable
  for (const varInfo of context.variables) {
    if (varInfo.range === rangeAddress) {
      return cvxVariable(varInfo.name, varInfo.dimension, varInfo.range);
    }
  }

  // Not a variable - read as constant parameter
  try {
    const values = await context.readRange(rangeAddress);
    const flatValues = values.flat();
    return cvxParameter(flatValues, rangeAddress);
  } catch {
    // If we can't read, create an unresolved range ref
    const rangeRef: CvxRangeRef = {
      type: 'range-ref',
      startAddress,
      endAddress,
      curvature: 'constant',
      sign: 'unknown',
      span: { start: 0, end: 0 },
    };
    return rangeRef;
  }
}

/**
 * Transform a function call
 */
async function transformFunction(
  node: ASTNode,
  context: TransformContext
): Promise<CvxNode> {
  if (node.type !== 'function') {
    return cvxError('Expected function node');
  }
  const astFuncNode = node as FunctionNode;
  const funcName = astFuncNode.name.toUpperCase();
  const funcInfo = getFunctionInfo(funcName);

  // Transform arguments
  const args: CvxNode[] = [];
  for (const argNode of astFuncNode.arguments || []) {
    args.push(await transformNode(argNode, context));
  }

  // Check argument count
  if (funcInfo) {
    if (args.length < funcInfo.minArgs) {
      return cvxError(`${funcName} requires at least ${funcInfo.minArgs} argument(s)`);
    }
    if (funcInfo.maxArgs !== -1 && args.length > funcInfo.maxArgs) {
      return cvxError(`${funcName} accepts at most ${funcInfo.maxArgs} argument(s)`);
    }
  }

  // Compute curvature based on function properties
  let curvature: Curvature = 'unknown';
  let sign: Sign = 'unknown';

  if (funcInfo) {
    if (funcInfo.curvature === 'varies') {
      curvature = funcInfo.computeCurvature?.(args) ?? 'unknown';
    } else {
      curvature = funcInfo.curvature;
    }

    if (funcInfo.computeSign) {
      sign = funcInfo.computeSign(args);
    }
  }

  const cvxFuncNode = cvxFunctionCall(funcName, args, curvature);
  cvxFuncNode.sign = sign;
  if (funcInfo?.cvxjsMapping) {
    cvxFuncNode.cvxjsAtom = funcInfo.cvxjsMapping;
  }

  return cvxFuncNode;
}

/**
 * Transform a binary operation
 */
async function transformBinaryOp(
  node: ASTNode,
  context: TransformContext
): Promise<CvxNode> {
  if (node.type !== 'binary-expression') {
    return cvxError('Expected binary-expression node');
  }
  const binNode = node as BinaryExpressionNode;
  const left = await transformNode(binNode.left, context);
  const right = await transformNode(binNode.right, context);
  const operator = binNode.operator as BinaryOperator;

  let curvature: Curvature;
  let sign: Sign;

  switch (operator) {
    case '+':
      curvature = composeAdd(left.curvature, right.curvature);
      sign = addSign(left.sign, right.sign);
      break;

    case '-':
      curvature = composeSub(left.curvature, right.curvature);
      sign = subSign(left.sign, right.sign);
      break;

    case '*': {
      const result = composeMul(left.curvature, left.sign, right.curvature, right.sign);
      curvature = result.curvature;
      sign = result.sign;
      break;
    }

    case '/': {
      const result = composeDiv(left.curvature, left.sign, right.curvature, right.sign);
      curvature = result.curvature;
      sign = result.sign;
      break;
    }

    case '^': {
      // Get exponent value if it's a constant
      const expValue = right.type === 'number' ? (right as CvxNumber).value : undefined;
      const result = composePower(left.curvature, left.sign, right.curvature, expValue);
      curvature = result.curvature;
      sign = result.sign;
      break;
    }

    // Comparison operators produce constant (boolean) results
    case '=':
    case '<>':
    case '<':
    case '>':
    case '<=':
    case '>=':
      curvature = 'constant';
      sign = 'unknown';
      break;

    // String concatenation
    case '&':
      return cvxError('String concatenation (&) not supported in optimization');

    default:
      curvature = 'unknown';
      sign = 'unknown';
  }

  return cvxBinaryOp(operator, left, right, curvature, sign);
}

/**
 * Transform a unary operation
 */
async function transformUnaryOp(
  node: ASTNode,
  context: TransformContext
): Promise<CvxNode> {
  if (node.type !== 'unary-expression') {
    return cvxError('Expected unary-expression node');
  }
  const unaryNode = node as UnaryExpressionNode;
  const operand = await transformNode(unaryNode.operand, context);
  const operator = unaryNode.operator as UnaryOperator;

  let curvature = operand.curvature;
  let sign = operand.sign;

  switch (operator) {
    case '-':
      // Negation flips curvature
      if (curvature === 'convex') curvature = 'concave';
      else if (curvature === 'concave') curvature = 'convex';

      // Negation flips sign
      if (sign === 'positive') sign = 'negative';
      else if (sign === 'negative') sign = 'positive';
      break;

    case '+':
      // Unary plus is a no-op
      break;

    case '%':
      // Percentage (divide by 100)
      // Only valid for constants
      if (curvature !== 'constant') {
        return cvxError('Percentage (%) operator only valid for constants');
      }
      break;
  }

  return cvxUnaryOp(operator, operand, curvature, sign);
}

/**
 * Extract cell address from a cell node
 */
function getCellAddress(node: ASTNode): string {
  if (node.type === 'cell') {
    // In excel-formula-ast, key is a string like "A1" or "$A$1"
    const key = (node as { key?: string }).key || '';
    // Remove $ signs to get the normalized address
    return key.replace(/\$/g, '').toUpperCase();
  }
  return '';
}

/**
 * Generate a human-readable description of a CVX node
 */
export function describeNode(node: CvxNode): string {
  switch (node.type) {
    case 'number':
      return String(node.value);

    case 'variable':
      return node.name;

    case 'parameter':
      if (Array.isArray(node.value)) {
        if (node.value.length <= 3) {
          return `[${node.value.join(', ')}]`;
        }
        return `[${node.value.slice(0, 2).join(', ')}, ..., ${node.value[node.value.length - 1]}]`;
      }
      return String(node.value);

    case 'cell-ref':
      return node.address;

    case 'range-ref':
      return `${node.startAddress}:${node.endAddress}`;

    case 'binary-op':
      return `(${describeNode(node.left)} ${node.operator} ${describeNode(node.right)})`;

    case 'unary-op':
      return `${node.operator}${describeNode(node.operand)}`;

    case 'function-call':
      if (node.cvxjsAtom) {
        return `${node.cvxjsAtom}(${node.args.map(describeNode).join(', ')})`;
      }
      return `${node.name}(${node.args.map(describeNode).join(', ')})`;

    case 'error':
      return `<error: ${node.message}>`;

    default:
      return '<unknown>';
  }
}
