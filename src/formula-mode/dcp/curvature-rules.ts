import type { Curvature, Sign } from './types';

/**
 * DCP Curvature Composition Rules
 *
 * These rules implement the disciplined convex programming composition rules
 * for combining expressions while preserving convexity guarantees.
 */

/**
 * Curvature of addition: a + b
 *
 * | a \ b      | constant | affine | convex | concave | unknown |
 * |------------|----------|--------|--------|---------|---------|
 * | constant   | constant | affine | convex | concave | unknown |
 * | affine     | affine   | affine | convex | concave | unknown |
 * | convex     | convex   | convex | convex | unknown | unknown |
 * | concave    | concave  | concave| unknown| concave | unknown |
 * | unknown    | unknown  | unknown| unknown| unknown | unknown |
 */
export function composeAdd(a: Curvature, b: Curvature): Curvature {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'constant') return b;
  if (b === 'constant') return a;
  if (a === b) return a; // affine+affine=affine, convex+convex=convex, etc.
  if (a === 'affine') return b;
  if (b === 'affine') return a;
  // convex + concave = unknown
  return 'unknown';
}

/**
 * Curvature of subtraction: a - b
 *
 * Subtraction is addition with negated second operand.
 */
export function composeSub(a: Curvature, b: Curvature): Curvature {
  return composeAdd(a, composeNeg(b));
}

/**
 * Curvature of negation: -a
 *
 * Negation flips convex <-> concave, preserves affine/constant.
 */
export function composeNeg(c: Curvature): Curvature {
  switch (c) {
    case 'convex':
      return 'concave';
    case 'concave':
      return 'convex';
    default:
      return c; // constant, affine, unknown stay same
  }
}

/**
 * Curvature of multiplication: a * b
 *
 * Multiplication is only DCP-compliant when at least one operand is constant.
 * The sign of the constant determines whether curvature is preserved or flipped.
 */
export function composeMul(
  aCurvature: Curvature,
  aSign: Sign,
  bCurvature: Curvature,
  bSign: Sign
): { curvature: Curvature; sign: Sign } {
  // If either is unknown curvature, result is unknown
  if (aCurvature === 'unknown' || bCurvature === 'unknown') {
    return { curvature: 'unknown', sign: 'unknown' };
  }

  // constant * constant = constant
  if (aCurvature === 'constant' && bCurvature === 'constant') {
    return {
      curvature: 'constant',
      sign: multiplySign(aSign, bSign),
    };
  }

  // a * constant: scale a by constant
  if (bCurvature === 'constant') {
    if (bSign === 'positive') {
      return { curvature: aCurvature, sign: multiplySign(aSign, bSign) };
    }
    if (bSign === 'negative') {
      return { curvature: composeNeg(aCurvature), sign: multiplySign(aSign, bSign) };
    }
    if (bSign === 'zero') {
      return { curvature: 'constant', sign: 'zero' };
    }
    // Unknown sign - curvature becomes unknown unless affine
    if (aCurvature === 'affine') {
      return { curvature: 'affine', sign: 'unknown' };
    }
    return { curvature: 'unknown', sign: 'unknown' };
  }

  // constant * b: scale b by constant
  if (aCurvature === 'constant') {
    if (aSign === 'positive') {
      return { curvature: bCurvature, sign: multiplySign(aSign, bSign) };
    }
    if (aSign === 'negative') {
      return { curvature: composeNeg(bCurvature), sign: multiplySign(aSign, bSign) };
    }
    if (aSign === 'zero') {
      return { curvature: 'constant', sign: 'zero' };
    }
    // Unknown sign
    if (bCurvature === 'affine') {
      return { curvature: 'affine', sign: 'unknown' };
    }
    return { curvature: 'unknown', sign: 'unknown' };
  }

  // Neither is constant: bilinear/non-convex
  return { curvature: 'unknown', sign: 'unknown' };
}

/**
 * Curvature of division: a / b
 *
 * Division is only DCP-compliant when denominator is a non-zero constant.
 */
export function composeDiv(
  numCurvature: Curvature,
  numSign: Sign,
  denCurvature: Curvature,
  denSign: Sign
): { curvature: Curvature; sign: Sign } {
  // Denominator must be constant
  if (denCurvature !== 'constant') {
    return { curvature: 'unknown', sign: 'unknown' };
  }

  // Division by zero would be an error
  if (denSign === 'zero') {
    return { curvature: 'unknown', sign: 'unknown' };
  }

  // Division by constant is same as multiplication by 1/constant
  // Sign of result depends on both signs
  if (denSign === 'positive') {
    return { curvature: numCurvature, sign: numSign };
  }
  if (denSign === 'negative') {
    return { curvature: composeNeg(numCurvature), sign: negateSign(numSign) };
  }

  // Unknown denominator sign
  if (numCurvature === 'affine' || numCurvature === 'constant') {
    return { curvature: numCurvature, sign: 'unknown' };
  }
  return { curvature: 'unknown', sign: 'unknown' };
}

/**
 * Curvature of power: a ^ b
 *
 * Power is complex in DCP:
 * - x^2 is convex
 * - x^0.5 (sqrt) is concave for x >= 0
 * - x^n for integer n >= 2 is convex if n is even
 * - For DCP simplicity, we only allow constant exponents
 */
export function composePower(
  baseCurvature: Curvature,
  baseSign: Sign,
  expCurvature: Curvature,
  expValue?: number
): { curvature: Curvature; sign: Sign } {
  // Exponent must be constant
  if (expCurvature !== 'constant') {
    return { curvature: 'unknown', sign: 'unknown' };
  }

  // If base is constant, result is constant
  if (baseCurvature === 'constant') {
    // Sign depends on exponent
    if (expValue !== undefined) {
      if (expValue === 0) return { curvature: 'constant', sign: 'positive' }; // x^0 = 1
      if (baseSign === 'positive') return { curvature: 'constant', sign: 'positive' };
      if (baseSign === 'zero') return { curvature: 'constant', sign: 'zero' };
      // Negative base with various exponents...
      if (Number.isInteger(expValue) && expValue % 2 === 0) {
        return { curvature: 'constant', sign: 'positive' };
      }
    }
    return { curvature: 'constant', sign: 'unknown' };
  }

  // For variable bases, we need specific exponent values
  if (expValue === undefined) {
    return { curvature: 'unknown', sign: 'unknown' };
  }

  // x^1 = x (preserves curvature)
  if (expValue === 1) {
    return { curvature: baseCurvature, sign: baseSign };
  }

  // x^0 = 1 (constant)
  if (expValue === 0) {
    return { curvature: 'constant', sign: 'positive' };
  }

  // x^2 is convex (if base is affine)
  if (expValue === 2 && baseCurvature === 'affine') {
    return { curvature: 'convex', sign: 'positive' };
  }

  // x^0.5 (sqrt) is concave for affine base with positive sign
  if (expValue === 0.5 && baseCurvature === 'affine') {
    if (baseSign === 'positive' || baseSign === 'zero') {
      return { curvature: 'concave', sign: 'positive' };
    }
  }

  // Other cases are complex - mark as unknown for safety
  return { curvature: 'unknown', sign: 'unknown' };
}

/**
 * Multiply two signs
 */
function multiplySign(a: Sign, b: Sign): Sign {
  if (a === 'zero' || b === 'zero') return 'zero';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === b) return 'positive';
  return 'negative';
}

/**
 * Negate a sign
 */
function negateSign(s: Sign): Sign {
  switch (s) {
    case 'positive':
      return 'negative';
    case 'negative':
      return 'positive';
    default:
      return s;
  }
}

/**
 * Compose signs for addition
 */
export function addSign(a: Sign, b: Sign): Sign {
  if (a === 'zero') return b;
  if (b === 'zero') return a;
  if (a === b) return a; // pos + pos = pos, neg + neg = neg
  return 'unknown'; // pos + neg could be anything
}

/**
 * Compose signs for subtraction
 */
export function subSign(a: Sign, b: Sign): Sign {
  return addSign(a, negateSign(b));
}

/**
 * Check if curvature is DCP-valid for an objective
 */
export function isValidObjectiveCurvature(
  curvature: Curvature,
  sense: 'minimize' | 'maximize'
): boolean {
  if (curvature === 'unknown') return false;
  if (curvature === 'constant' || curvature === 'affine') return true;
  if (sense === 'minimize') return curvature === 'convex';
  if (sense === 'maximize') return curvature === 'concave';
  return false;
}

/**
 * Check if curvature is DCP-valid for a constraint LHS
 */
export function isValidConstraintCurvature(
  lhsCurvature: Curvature,
  rhsCurvature: Curvature,
  operator: '<=' | '>=' | '=='
): boolean {
  // Equality constraints require both sides to be affine
  if (operator === '==') {
    return (
      (lhsCurvature === 'affine' || lhsCurvature === 'constant') &&
      (rhsCurvature === 'affine' || rhsCurvature === 'constant')
    );
  }

  // For <= : LHS must be convex (or affine), RHS must be concave (or affine)
  if (operator === '<=') {
    const lhsOk = lhsCurvature === 'constant' || lhsCurvature === 'affine' || lhsCurvature === 'convex';
    const rhsOk = rhsCurvature === 'constant' || rhsCurvature === 'affine' || rhsCurvature === 'concave';
    return lhsOk && rhsOk;
  }

  // For >= : LHS must be concave (or affine), RHS must be convex (or affine)
  if (operator === '>=') {
    const lhsOk = lhsCurvature === 'constant' || lhsCurvature === 'affine' || lhsCurvature === 'concave';
    const rhsOk = rhsCurvature === 'constant' || rhsCurvature === 'affine' || rhsCurvature === 'convex';
    return lhsOk && rhsOk;
  }

  return false;
}
