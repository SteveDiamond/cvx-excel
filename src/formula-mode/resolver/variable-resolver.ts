/**
 * Variable Resolver - Maps Excel cell references to optimization variables
 */

export interface VariableDefinition {
  name: string;
  range: string;       // e.g., "B2:B6" or "B2" for scalar
  cells: string[];     // Individual cell addresses: ["B2", "B3", ...]
  dimension: number;
}

/**
 * Parse a range string into individual cell addresses
 */
export function expandRange(range: string): string[] {
  // Handle single cell
  if (!range.includes(':')) {
    return [range.toUpperCase()];
  }

  const [start, end] = range.split(':').map(s => s.trim().toUpperCase());
  const startCol = getColumnPart(start);
  const startRow = getRowPart(start);
  const endCol = getColumnPart(end);
  const endRow = getRowPart(end);

  const cells: string[] = [];

  for (let col = columnToNumber(startCol); col <= columnToNumber(endCol); col++) {
    for (let row = startRow; row <= endRow; row++) {
      cells.push(`${numberToColumn(col)}${row}`);
    }
  }

  return cells;
}

/**
 * Get the column part of a cell address (e.g., "B" from "B2")
 */
function getColumnPart(address: string): string {
  return address.replace(/[0-9$]/g, '');
}

/**
 * Get the row part of a cell address (e.g., 2 from "B2")
 */
function getRowPart(address: string): number {
  return parseInt(address.replace(/[A-Z$]/gi, ''), 10);
}

/**
 * Convert column letter to number (A=1, B=2, ..., Z=26, AA=27, ...)
 */
function columnToNumber(col: string): number {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

/**
 * Convert number to column letter (1=A, 2=B, ..., 26=Z, 27=AA, ...)
 */
function numberToColumn(num: number): string {
  let col = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    num = Math.floor((num - 1) / 26);
  }
  return col;
}

/**
 * Calculate dimension of a range
 */
export function getRangeDimension(range: string): number {
  return expandRange(range).length;
}

/**
 * Check if a cell address falls within a range
 */
export function cellInRange(cell: string, range: string): boolean {
  const cells = expandRange(range);
  return cells.includes(cell.toUpperCase());
}

/**
 * Get the index of a cell within a range (0-based)
 */
export function getCellIndexInRange(cell: string, range: string): number {
  const cells = expandRange(range);
  return cells.indexOf(cell.toUpperCase());
}

/**
 * Check if two ranges overlap
 */
export function rangesOverlap(range1: string, range2: string): boolean {
  const cells1 = new Set(expandRange(range1));
  const cells2 = expandRange(range2);
  return cells2.some(cell => cells1.has(cell));
}

/**
 * Normalize a range address (remove $ signs, uppercase)
 */
export function normalizeRange(range: string): string {
  return range.replace(/\$/g, '').toUpperCase();
}

/**
 * Variable Resolver class
 */
export class VariableResolver {
  private variables: Map<string, VariableDefinition> = new Map();
  private cellToVariable: Map<string, { varName: string; index: number }> = new Map();

  /**
   * Register a variable with its cell range
   */
  registerVariable(name: string, range: string): void {
    const normalizedRange = normalizeRange(range);
    const cells = expandRange(normalizedRange);

    const definition: VariableDefinition = {
      name,
      range: normalizedRange,
      cells,
      dimension: cells.length,
    };

    this.variables.set(name, definition);

    // Build reverse lookup: cell -> (variable, index)
    cells.forEach((cell, index) => {
      this.cellToVariable.set(cell, { varName: name, index });
    });
  }

  /**
   * Unregister a variable
   */
  unregisterVariable(name: string): void {
    const definition = this.variables.get(name);
    if (definition) {
      // Remove cell mappings
      for (const cell of definition.cells) {
        const mapping = this.cellToVariable.get(cell);
        if (mapping?.varName === name) {
          this.cellToVariable.delete(cell);
        }
      }
      this.variables.delete(name);
    }
  }

  /**
   * Clear all registered variables
   */
  clear(): void {
    this.variables.clear();
    this.cellToVariable.clear();
  }

  /**
   * Get all registered variable names
   */
  getVariableNames(): string[] {
    return Array.from(this.variables.keys());
  }

  /**
   * Get all variable definitions
   */
  getVariableDefinitions(): VariableDefinition[] {
    return Array.from(this.variables.values());
  }

  /**
   * Get a specific variable definition
   */
  getVariable(name: string): VariableDefinition | undefined {
    return this.variables.get(name);
  }

  /**
   * Check if a cell is part of a registered variable
   */
  isVariableCell(cell: string): boolean {
    return this.cellToVariable.has(normalizeRange(cell));
  }

  /**
   * Get the variable info for a cell (if any)
   */
  getVariableForCell(cell: string): { varName: string; index: number } | undefined {
    return this.cellToVariable.get(normalizeRange(cell));
  }

  /**
   * Check if a range exactly matches a registered variable
   */
  isVariableRange(range: string): boolean {
    const normalizedRange = normalizeRange(range);
    for (const def of this.variables.values()) {
      if (def.range === normalizedRange) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the variable name for a range (if exact match)
   */
  getVariableForRange(range: string): string | undefined {
    const normalizedRange = normalizeRange(range);
    for (const def of this.variables.values()) {
      if (def.range === normalizedRange) {
        return def.name;
      }
    }
    return undefined;
  }

  /**
   * Check if a range partially overlaps with any variable (but isn't an exact match)
   */
  rangeOverlapsVariable(range: string): { varName: string; overlap: string[] } | undefined {
    const normalizedRange = normalizeRange(range);
    const rangeCells = new Set(expandRange(normalizedRange));

    for (const def of this.variables.values()) {
      if (def.range === normalizedRange) {
        continue; // Exact match, not overlap
      }

      const overlap = def.cells.filter(cell => rangeCells.has(cell));
      if (overlap.length > 0) {
        return { varName: def.name, overlap };
      }
    }

    return undefined;
  }

  /**
   * Validate that no variables overlap
   */
  validateNoOverlaps(): { valid: boolean; overlaps: { var1: string; var2: string; cells: string[] }[] } {
    const overlaps: { var1: string; var2: string; cells: string[] }[] = [];
    const varList = Array.from(this.variables.values());

    for (let i = 0; i < varList.length; i++) {
      for (let j = i + 1; j < varList.length; j++) {
        const v1 = varList[i];
        const v2 = varList[j];
        const cells1 = new Set(v1.cells);
        const commonCells = v2.cells.filter(cell => cells1.has(cell));

        if (commonCells.length > 0) {
          overlaps.push({ var1: v1.name, var2: v2.name, cells: commonCells });
        }
      }
    }

    return { valid: overlaps.length === 0, overlaps };
  }
}

/**
 * Create a variable resolver from existing variable definitions
 */
export function createResolver(variables: Array<{ name: string; range: string }>): VariableResolver {
  const resolver = new VariableResolver();
  for (const v of variables) {
    resolver.registerVariable(v.name, v.range);
  }
  return resolver;
}
