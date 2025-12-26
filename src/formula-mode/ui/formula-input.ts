/**
 * Formula Input Component
 *
 * Provides a UI for selecting Excel cells and displaying formula parsing results.
 */

import { parseAndAnalyze, getCurvatureBadge, getCurvatureClass } from '../index';
import type { Curvature } from '../dcp/types';

/**
 * Options for creating a formula input
 */
export interface FormulaInputOptions {
  /** Unique ID for the input */
  id: string;

  /** Label text */
  label: string;

  /** Registered variables for parsing */
  variables: Array<{ name: string; range: string }>;

  /** Function to read cell values from Excel */
  readRange: (range: string) => Promise<number[][]>;

  /** Function to read formula from a cell */
  readFormula: (address: string) => Promise<string>;

  /** Callback when formula changes */
  onChange?: (result: FormulaInputResult) => void;

  /** DCP context for validation */
  dcpContext?: {
    role: 'objective' | 'constraint-lhs' | 'constraint-rhs';
    sense?: 'minimize' | 'maximize';
    operator?: '<=' | '>=' | '==';
  };
}

/**
 * Result from formula input
 */
export interface FormulaInputResult {
  cell: string;
  formula: string;
  parsedDescription: string;
  curvature: Curvature;
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Create a formula input component
 */
export function createFormulaInput(options: FormulaInputOptions): HTMLElement {
  const { id, label, variables, readRange, readFormula, onChange, dcpContext } = options;

  // Create container
  const container = document.createElement('div');
  container.className = 'formula-input-container';
  container.id = `${id}-container`;

  // Label
  const labelEl = document.createElement('label');
  labelEl.htmlFor = `${id}-cell`;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  // Cell input row
  const inputRow = document.createElement('div');
  inputRow.className = 'formula-input-row';

  const cellInput = document.createElement('input');
  cellInput.type = 'text';
  cellInput.id = `${id}-cell`;
  cellInput.className = 'formula-cell-input';
  cellInput.placeholder = 'e.g., F10';
  inputRow.appendChild(cellInput);

  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'formula-select-btn';
  selectBtn.textContent = 'Select Cell';
  inputRow.appendChild(selectBtn);

  container.appendChild(inputRow);

  // Formula display
  const formulaDisplay = document.createElement('div');
  formulaDisplay.className = 'formula-display';
  formulaDisplay.id = `${id}-formula`;
  formulaDisplay.innerHTML = '<span class="placeholder">Select a cell to read its formula</span>';
  container.appendChild(formulaDisplay);

  // Parsed result display
  const resultDisplay = document.createElement('div');
  resultDisplay.className = 'formula-result';
  resultDisplay.id = `${id}-result`;
  resultDisplay.style.display = 'none';
  container.appendChild(resultDisplay);

  // DCP status indicator
  const statusIndicator = document.createElement('div');
  statusIndicator.className = 'dcp-status';
  statusIndicator.id = `${id}-status`;
  container.appendChild(statusIndicator);

  // State
  let currentResult: FormulaInputResult | null = null;

  // Select cell button handler
  selectBtn.addEventListener('click', async () => {
    try {
      // Get current selection from Excel
      const address = await getCurrentSelection();
      cellInput.value = address;

      // Read and parse formula
      await parseCell(address);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to select cell');
    }
  });

  // Manual cell input handler
  let debounceTimer: number | null = null;
  cellInput.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      const address = cellInput.value.trim();
      if (address) {
        await parseCell(address);
      } else {
        clearResult();
      }
    }, 300) as unknown as number;
  });

  // Parse a cell's formula
  async function parseCell(address: string): Promise<void> {
    try {
      // Read formula from cell
      const formula = await readFormula(address);

      formulaDisplay.innerHTML = `<code>${escapeHtml(formula || '(empty)')}</code>`;

      if (!formula || !formula.startsWith('=')) {
        // Not a formula, treat as constant
        showResult({
          cell: address,
          formula: formula || '',
          parsedDescription: 'constant value',
          curvature: 'constant',
          isValid: true,
        });
        return;
      }

      // Parse and analyze
      const result = await parseAndAnalyze(formula, {
        variables,
        readRange,
        dcpContext,
      });

      const inputResult: FormulaInputResult = {
        cell: address,
        formula,
        parsedDescription: result.description,
        curvature: result.dcp.curvature,
        isValid: result.dcp.valid,
        errorMessage: result.dcp.errors[0]?.message,
      };

      showResult(inputResult);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to parse formula');
    }
  }

  // Display result
  function showResult(result: FormulaInputResult): void {
    currentResult = result;

    resultDisplay.style.display = 'block';
    resultDisplay.innerHTML = `
      <span class="parsed-expr">${escapeHtml(result.parsedDescription)}</span>
      <span class="curvature-badge ${getCurvatureClass(result.curvature)}">${getCurvatureBadge(result.curvature)}</span>
    `;

    if (result.isValid) {
      statusIndicator.className = 'dcp-status dcp-valid';
      statusIndicator.innerHTML = '✓ DCP Valid';
    } else {
      statusIndicator.className = 'dcp-status dcp-invalid';
      statusIndicator.innerHTML = `✗ ${escapeHtml(result.errorMessage || 'Not DCP compliant')}`;
    }

    onChange?.(result);
  }

  // Display error
  function showError(message: string): void {
    currentResult = null;
    resultDisplay.style.display = 'block';
    resultDisplay.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
    statusIndicator.className = 'dcp-status dcp-error';
    statusIndicator.innerHTML = '✗ Error';
  }

  // Clear result
  function clearResult(): void {
    currentResult = null;
    formulaDisplay.innerHTML = '<span class="placeholder">Select a cell to read its formula</span>';
    resultDisplay.style.display = 'none';
    statusIndicator.className = 'dcp-status';
    statusIndicator.innerHTML = '';
  }

  // Get current Excel selection
  async function getCurrentSelection(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check if Excel API is available (Office.js)
      const excelGlobal = (globalThis as { Excel?: { run: Function } }).Excel;
      if (!excelGlobal) {
        reject(new Error('Excel API not available'));
        return;
      }

      excelGlobal.run(async (context: { workbook: { getSelectedRange: () => { load: (props: string) => void; address: string } }; sync: () => Promise<void> }) => {
        const selection = context.workbook.getSelectedRange();
        selection.load('address');
        await context.sync();
        // Remove sheet name if present (e.g., "Sheet1!A1" -> "A1")
        const address = selection.address.includes('!')
          ? selection.address.split('!')[1]
          : selection.address;
        resolve(address);
      }).catch(reject);
    });
  }

  // Add getter for current result
  Object.defineProperty(container, 'getResult', {
    value: () => currentResult,
    writable: false,
  });

  return container;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * CSS styles for formula input component
 */
export const FORMULA_INPUT_STYLES = `
.formula-input-container {
  margin-bottom: 16px;
}

.formula-input-container label {
  display: block;
  font-weight: 500;
  margin-bottom: 4px;
}

.formula-input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.formula-cell-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.formula-select-btn {
  padding: 6px 12px;
  background: #0078d4;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.formula-select-btn:hover {
  background: #106ebe;
}

.formula-display {
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  margin-bottom: 8px;
}

.formula-display .placeholder {
  color: #888;
  font-style: italic;
}

.formula-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #e8f4ff;
  border-radius: 4px;
  margin-bottom: 8px;
}

.formula-result .parsed-expr {
  flex: 1;
  font-family: 'Consolas', 'Monaco', monospace;
}

.curvature-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.curvature-affine {
  background: #e3f2fd;
  color: #1565c0;
}

.curvature-convex {
  background: #e8f5e9;
  color: #2e7d32;
}

.curvature-concave {
  background: #fff3e0;
  color: #e65100;
}

.curvature-invalid {
  background: #ffebee;
  color: #c62828;
}

.dcp-status {
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.dcp-status.dcp-valid {
  background: #e8f5e9;
  color: #2e7d32;
}

.dcp-status.dcp-invalid {
  background: #fff3e0;
  color: #e65100;
}

.dcp-status.dcp-error {
  background: #ffebee;
  color: #c62828;
}

.formula-result .error {
  color: #c62828;
}
`;
