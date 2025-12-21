/**
 * Excel ↔ cvxjs data conversion utilities
 *
 * Excel custom functions receive data as number[][] (2D arrays).
 * This module converts between Excel ranges and cvxjs-compatible formats.
 */

/**
 * Convert Excel range (2D array) to a flat Float64Array vector
 * Handles both row vectors and column vectors
 */
export function rangeToVector(range: number[][]): Float64Array {
  const flat: number[] = [];
  for (const row of range) {
    for (const cell of row) {
      if (typeof cell === "number" && !isNaN(cell)) {
        flat.push(cell);
      } else {
        throw new Error(`Invalid numeric value in range: ${cell}`);
      }
    }
  }
  return new Float64Array(flat);
}

/**
 * Convert Excel range (2D array) to a 2D number array (for matrices)
 */
export function rangeToMatrix(range: number[][]): number[][] {
  return range.map((row) =>
    row.map((cell) => {
      if (typeof cell === "number" && !isNaN(cell)) {
        return cell;
      }
      throw new Error(`Invalid numeric value in matrix: ${cell}`);
    })
  );
}

/**
 * Convert solution to Excel output format
 * Returns a 2D array suitable for Excel (row for optimal value, then solution values)
 */
export function solutionToRange(
  optimalValue: number,
  solution: number[]
): (number | string)[][] {
  const result: (number | string)[][] = [];
  result.push(["Optimal Value", optimalValue]);
  result.push(["Solution:"]);
  for (let i = 0; i < solution.length; i++) {
    result.push([`x[${i}]`, solution[i]]);
  }
  return result;
}

/**
 * Convert solution to compact row format for spill into Excel
 * [optimal_value, x0, x1, x2, ...]
 */
export function solutionToRow(
  optimalValue: number,
  solution: number[]
): number[][] {
  return [[optimalValue, ...solution]];
}

/**
 * Convert solution to column format for spill into Excel
 */
export function solutionToColumn(
  optimalValue: number,
  solution: number[]
): number[][] {
  const result: number[][] = [[optimalValue]];
  for (const val of solution) {
    result.push([val]);
  }
  return result;
}

/**
 * Get dimensions of a range
 */
export function getRangeDimensions(range: number[][]): {
  rows: number;
  cols: number;
} {
  if (!range || range.length === 0) {
    return { rows: 0, cols: 0 };
  }
  return {
    rows: range.length,
    cols: range[0]?.length || 0,
  };
}

/**
 * Validate that a range is a valid vector (single row or single column)
 */
export function isVector(range: number[][]): boolean {
  const dims = getRangeDimensions(range);
  return dims.rows === 1 || dims.cols === 1;
}

/**
 * Get the length of a vector range
 */
export function getVectorLength(range: number[][]): number {
  const dims = getRangeDimensions(range);
  return Math.max(dims.rows, dims.cols);
}
