import type { CvxNode } from '../parser/cvx-ast';
import type { Curvature, Sign } from './types';
import { composeAdd, composeNeg } from './curvature-rules';

/**
 * Function Registry for Excel → cvxjs Mapping
 *
 * Each Excel function is mapped to:
 * - Its DCP curvature properties
 * - How to compute curvature from arguments
 * - The corresponding cvxjs function (if any)
 */

export type Monotonicity = 'increasing' | 'decreasing' | 'none';

export interface FunctionDcpInfo {
  /** Base curvature of the function, or 'varies' if it depends on arguments */
  curvature: Curvature | 'varies';

  /** Compute curvature from argument curvatures (when curvature === 'varies') */
  computeCurvature?: (args: CvxNode[]) => Curvature;

  /** Compute sign from argument signs */
  computeSign?: (args: CvxNode[]) => Sign;

  /** Monotonicity per argument (for DCP composition rules) */
  monotonicity: Monotonicity[];

  /** Corresponding cvxjs function/method name */
  cvxjsMapping: string | null;

  /** Human-readable description for error messages */
  description: string;

  /** Minimum number of arguments */
  minArgs: number;

  /** Maximum number of arguments (-1 for unlimited) */
  maxArgs: number;
}

/**
 * Registry of supported Excel functions
 */
export const FUNCTION_REGISTRY: Record<string, FunctionDcpInfo> = {
  // ============ AFFINE FUNCTIONS ============

  SUM: {
    curvature: 'varies',
    computeCurvature: (args) =>
      args.reduce((acc, arg) => composeAdd(acc, arg.curvature), 'constant' as Curvature),
    computeSign: (args) => {
      // Sum of positives is positive, etc.
      const allPositive = args.every((a) => a.sign === 'positive' || a.sign === 'zero');
      const allNegative = args.every((a) => a.sign === 'negative' || a.sign === 'zero');
      if (allPositive) return 'positive';
      if (allNegative) return 'negative';
      return 'unknown';
    },
    monotonicity: ['increasing'],
    cvxjsMapping: 'sum',
    description: 'Sum of values',
    minArgs: 1,
    maxArgs: -1,
  },

  SUMPRODUCT: {
    curvature: 'varies',
    computeCurvature: (args) => {
      if (args.length !== 2) return 'unknown';
      const [a, b] = args;

      // If one is constant, result takes curvature of the other
      if (a.curvature === 'constant') return b.curvature;
      if (b.curvature === 'constant') return a.curvature;

      // Both non-constant: bilinear, non-convex
      return 'unknown';
    },
    computeSign: (args) => {
      if (args.length !== 2) return 'unknown';
      // If both positive, product is positive
      if (args[0].sign === 'positive' && args[1].sign === 'positive') return 'positive';
      if (args[0].sign === 'negative' && args[1].sign === 'negative') return 'positive';
      if (args[0].sign === 'positive' && args[1].sign === 'negative') return 'negative';
      if (args[0].sign === 'negative' && args[1].sign === 'positive') return 'negative';
      return 'unknown';
    },
    monotonicity: ['increasing', 'increasing'],
    cvxjsMapping: 'dot',
    description: 'Dot product (element-wise multiply then sum)',
    minArgs: 2,
    maxArgs: 2,
  },

  AVERAGE: {
    curvature: 'varies',
    computeCurvature: (args) =>
      args.reduce((acc, arg) => composeAdd(acc, arg.curvature), 'constant' as Curvature),
    monotonicity: ['increasing'],
    cvxjsMapping: null, // Need to implement as sum(x)/n
    description: 'Average of values',
    minArgs: 1,
    maxArgs: -1,
  },

  // ============ CONVEX FUNCTIONS ============

  SUMSQ: {
    curvature: 'convex',
    computeSign: () => 'positive', // Sum of squares is always non-negative
    monotonicity: ['none'], // Not monotonic
    cvxjsMapping: 'sumSquares',
    description: 'Sum of squares',
    minArgs: 1,
    maxArgs: -1,
  },

  ABS: {
    curvature: 'convex',
    computeSign: () => 'positive', // Absolute value is always non-negative
    monotonicity: ['none'], // Not monotonic (decreasing for negative, increasing for positive)
    cvxjsMapping: 'abs',
    description: 'Absolute value',
    minArgs: 1,
    maxArgs: 1,
  },

  MAX: {
    curvature: 'varies',
    computeCurvature: (args) => {
      // Max of convex is convex, max of affine is convex
      const curvatures = args.map((a) => a.curvature);
      if (curvatures.every((c) => c === 'constant')) return 'constant';
      if (curvatures.some((c) => c === 'unknown')) return 'unknown';
      if (curvatures.some((c) => c === 'concave')) return 'unknown'; // max of concave is not convex
      // All are affine or convex (or constant)
      if (curvatures.every((c) => c === 'affine' || c === 'constant')) {
        return args.length === 1 ? 'affine' : 'convex';
      }
      return 'convex';
    },
    monotonicity: ['increasing', 'increasing'],
    cvxjsMapping: 'max',
    description: 'Maximum of values',
    minArgs: 1,
    maxArgs: -1,
  },

  // ============ CONCAVE FUNCTIONS ============

  MIN: {
    curvature: 'varies',
    computeCurvature: (args) => {
      // Min of concave is concave, min of affine is concave
      const curvatures = args.map((a) => a.curvature);
      if (curvatures.every((c) => c === 'constant')) return 'constant';
      if (curvatures.some((c) => c === 'unknown')) return 'unknown';
      if (curvatures.some((c) => c === 'convex')) return 'unknown'; // min of convex is not concave
      // All are affine or concave (or constant)
      if (curvatures.every((c) => c === 'affine' || c === 'constant')) {
        return args.length === 1 ? 'affine' : 'concave';
      }
      return 'concave';
    },
    monotonicity: ['increasing', 'increasing'],
    cvxjsMapping: 'min',
    description: 'Minimum of values',
    minArgs: 1,
    maxArgs: -1,
  },

  SQRT: {
    curvature: 'varies',
    computeCurvature: (args) => {
      if (args.length !== 1) return 'unknown';
      const arg = args[0];
      // sqrt is concave for non-negative arguments
      if (arg.curvature === 'constant') return 'constant';
      if (arg.curvature === 'affine') {
        // sqrt(affine) is concave if affine is non-negative
        if (arg.sign === 'positive' || arg.sign === 'zero') {
          return 'concave';
        }
      }
      return 'unknown';
    },
    computeSign: () => 'positive', // sqrt is always non-negative
    monotonicity: ['increasing'],
    cvxjsMapping: 'sqrt',
    description: 'Square root (concave)',
    minArgs: 1,
    maxArgs: 1,
  },

  LOG: {
    curvature: 'varies',
    computeCurvature: (args) => {
      if (args.length !== 1) return 'unknown';
      const arg = args[0];
      if (arg.curvature === 'constant') return 'constant';
      if (arg.curvature === 'affine' && arg.sign === 'positive') {
        return 'concave';
      }
      return 'unknown';
    },
    monotonicity: ['increasing'],
    cvxjsMapping: 'log',
    description: 'Natural logarithm (concave)',
    minArgs: 1,
    maxArgs: 1,
  },

  LN: {
    // Same as LOG
    curvature: 'varies',
    computeCurvature: (args) => {
      if (args.length !== 1) return 'unknown';
      const arg = args[0];
      if (arg.curvature === 'constant') return 'constant';
      if (arg.curvature === 'affine' && arg.sign === 'positive') {
        return 'concave';
      }
      return 'unknown';
    },
    monotonicity: ['increasing'],
    cvxjsMapping: 'log',
    description: 'Natural logarithm (concave)',
    minArgs: 1,
    maxArgs: 1,
  },

  // ============ NON-DCP FUNCTIONS (for error messages) ============

  EXP: {
    curvature: 'varies',
    computeCurvature: (args) => {
      if (args.length !== 1) return 'unknown';
      const arg = args[0];
      if (arg.curvature === 'constant') return 'constant';
      if (arg.curvature === 'affine') return 'convex'; // exp(affine) is convex
      return 'unknown';
    },
    computeSign: () => 'positive', // exp is always positive
    monotonicity: ['increasing'],
    cvxjsMapping: 'exp',
    description: 'Exponential (convex)',
    minArgs: 1,
    maxArgs: 1,
  },

  POWER: {
    curvature: 'unknown', // Complex - handled specially
    monotonicity: ['none', 'none'],
    cvxjsMapping: null,
    description: 'Power function',
    minArgs: 2,
    maxArgs: 2,
  },

  // ============ UNSUPPORTED (Phase 2) ============

  MMULT: {
    curvature: 'varies',
    computeCurvature: (args) => {
      if (args.length !== 2) return 'unknown';
      const [a, b] = args;
      if (a.curvature === 'constant') return b.curvature;
      if (b.curvature === 'constant') return a.curvature;
      return 'unknown'; // Matrix * Matrix with variables is complex
    },
    monotonicity: ['increasing', 'increasing'],
    cvxjsMapping: null, // Needs special handling for matrix ops
    description: 'Matrix multiplication (Phase 2)',
    minArgs: 2,
    maxArgs: 2,
  },

  TRANSPOSE: {
    curvature: 'varies',
    computeCurvature: (args) => (args.length === 1 ? args[0].curvature : 'unknown'),
    monotonicity: ['increasing'],
    cvxjsMapping: null,
    description: 'Matrix transpose',
    minArgs: 1,
    maxArgs: 1,
  },
};

/**
 * Get function info, case-insensitive
 */
export function getFunctionInfo(name: string): FunctionDcpInfo | undefined {
  return FUNCTION_REGISTRY[name.toUpperCase()];
}

/**
 * Check if a function is supported
 */
export function isFunctionSupported(name: string): boolean {
  return name.toUpperCase() in FUNCTION_REGISTRY;
}

/**
 * Get list of all supported functions
 */
export function getSupportedFunctions(): string[] {
  return Object.keys(FUNCTION_REGISTRY);
}

/**
 * Get human-readable curvature description for a function
 */
export function getFunctionCurvatureDescription(name: string): string {
  const info = getFunctionInfo(name);
  if (!info) return 'Unknown function';

  switch (info.curvature) {
    case 'constant':
      return 'constant';
    case 'affine':
      return 'affine (linear)';
    case 'convex':
      return 'convex';
    case 'concave':
      return 'concave';
    case 'varies':
      return 'depends on arguments';
    default:
      return 'unknown';
  }
}
