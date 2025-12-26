/**
 * UI Controller
 *
 * Manages state and DOM interactions for the Problem Builder.
 */

import { loadWasm } from "cvxjs";
import type {
  ProblemState,
  VariableDefinition,
  ConstraintDefinition,
  ObjectiveDefinition,
  LinearTerm,
  QuadraticTerm,
  SolveResult,
  InputMode,
} from "./types.js";
import {
  createDefaultProblemState,
  createDefaultVariable,
  createDefaultConstraint,
  createDefaultLinearTerm,
  createDefaultQuadraticTerm,
} from "./types.js";
import {
  renderVariableCard,
  renderConstraintCard,
  renderObjectiveSection,
} from "./ui-components.js";
import { ProblemCompiler } from "./problem-compiler.js";
import { mapSolution, roundValues } from "./result-mapper.js";
import { parseAndAnalyze } from "../../formula-mode/index.js";

// Excel API types
declare const Excel: {
  run: <T>(callback: (context: ExcelContext) => Promise<T>) => Promise<T>;
};

interface ExcelContext {
  workbook: {
    getSelectedRange: () => ExcelRange;
    worksheets: {
      getActiveWorksheet: () => ExcelWorksheet;
    };
  };
  sync: () => Promise<void>;
}

interface ExcelWorksheet {
  getRange: (address: string) => ExcelRange;
}

interface ExcelRange {
  address: string;
  values: (number | string)[][];
  formulas: string[][];
  load: (props: string) => void;
  getCell: (row: number, col: number) => ExcelRange;
  getResizedRange: (deltaRows: number, deltaCols: number) => ExcelRange;
}

/**
 * Problem Builder UI Controller
 */
export class ProblemBuilderController {
  private state: ProblemState;
  private wasmReady = false;
  private lastResult: SolveResult | null = null;

  // DOM element references
  private variablesContainer: HTMLElement | null = null;
  private constraintsContainer: HTMLElement | null = null;
  private objectiveContainer: HTMLElement | null = null;
  private resultsContainer: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor() {
    this.state = createDefaultProblemState();
  }

  /**
   * Initialize the controller and bind to DOM
   */
  init(): void {
    this.variablesContainer = document.getElementById("pb-variables-list");
    this.constraintsContainer = document.getElementById("pb-constraints-list");
    this.objectiveContainer = document.getElementById("pb-objective");
    this.resultsContainer = document.getElementById("pb-results");
    this.statusEl = document.getElementById("status");

    // Bind add buttons
    document.getElementById("pb-add-variable")?.addEventListener("click", () => {
      this.addVariable();
    });

    document.getElementById("pb-add-constraint")?.addEventListener("click", () => {
      this.addConstraint();
    });

    document.getElementById("pb-solve")?.addEventListener("click", () => {
      this.solve();
    });

    // Initial render
    this.renderObjective();
  }

  /**
   * Set status message
   */
  private setStatus(message: string, type: "info" | "success" | "error" = "info"): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.className = `status ${type}`;
    }
  }

  /**
   * Get variable names for dropdowns
   */
  private getVariableNames(): string[] {
    return this.state.variables.map((v) => v.name).filter((n) => n.trim() !== "");
  }

  /**
   * Select range from Excel
   */
  private async selectRange(inputId: string): Promise<void> {
    try {
      await Excel.run(async (context) => {
        const range = context.workbook.getSelectedRange();
        range.load("address");
        await context.sync();

        const input = document.getElementById(inputId) as HTMLInputElement;
        if (input) {
          const address = range.address.includes("!")
            ? range.address.split("!")[1]
            : range.address;
          input.value = address;
          // Trigger change event
          input.dispatchEvent(new Event("change"));
        }
      });
    } catch (error) {
      this.setStatus(`Error selecting range: ${error}`, "error");
    }
  }

  /**
   * Read range from Excel
   */
  private async readRange(address: string): Promise<number[][]> {
    return Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange(address);
      range.load("values");
      await context.sync();
      return range.values as number[][];
    });
  }

  /**
   * Write values to Excel
   */
  private async writeRange(address: string, values: (number | string)[][]): Promise<void> {
    return Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const startCell = sheet.getRange(address).getCell(0, 0);
      const rows = values.length;
      const cols = values[0]?.length || 1;
      const outputRange = startCell.getResizedRange(rows - 1, cols - 1);
      outputRange.values = values;
      await context.sync();
    });
  }

  /**
   * Read formula from a cell
   */
  private async readFormula(address: string): Promise<string> {
    return Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const range = sheet.getRange(address);
      range.load("formulas");
      await context.sync();
      return range.formulas[0]?.[0] ?? "";
    });
  }

  /**
   * Select a formula cell from Excel and read its formula
   */
  private async selectFormulaCell(inputId: string): Promise<void> {
    try {
      await Excel.run(async (context) => {
        const range = context.workbook.getSelectedRange();
        range.load("address,formulas");
        await context.sync();

        const input = document.getElementById(inputId) as HTMLInputElement;
        if (input) {
          const address = range.address.includes("!")
            ? range.address.split("!")[1]
            : range.address;
          input.value = address;
          // Trigger change event to parse the formula
          input.dispatchEvent(new Event("change"));
        }
      });
    } catch (error) {
      this.setStatus(`Error selecting cell: ${error}`, "error");
    }
  }

  /**
   * Get variable info for formula parsing
   */
  private getVariableInfo(): Array<{ name: string; range: string }> {
    return this.state.variables
      .filter((v) => v.name.trim() && v.dimensionRange.trim())
      .map((v) => ({ name: v.name, range: v.dimensionRange }));
  }

  /**
   * Parse and validate objective formula
   */
  private async parseObjectiveFormula(cell: string): Promise<void> {
    if (!cell) {
      this.state.objective.formulaText = undefined;
      this.state.objective.formulaCurvature = undefined;
      this.state.objective.formulaParsedDesc = undefined;
      this.state.objective.formulaDcpValid = undefined;
      this.state.objective.formulaError = undefined;
      this.renderObjective();
      return;
    }

    try {
      // Read formula from cell
      const formula = await this.readFormula(cell);
      this.state.objective.formulaText = formula;

      if (!formula || !formula.startsWith("=")) {
        // Not a formula, treat as constant
        this.state.objective.formulaCurvature = "constant";
        this.state.objective.formulaParsedDesc = "constant value";
        this.state.objective.formulaDcpValid = true;
        this.state.objective.formulaError = undefined;
        this.renderObjective();
        return;
      }

      // Parse and analyze
      const result = await parseAndAnalyze(formula, {
        variables: this.getVariableInfo(),
        readRange: (addr) => this.readRange(addr),
        dcpContext: {
          role: "objective",
          sense: this.state.objective.sense,
        },
      });

      this.state.objective.formulaCurvature = result.dcp.curvature;
      this.state.objective.formulaParsedDesc = result.description;
      this.state.objective.formulaDcpValid = result.dcp.valid;
      this.state.objective.formulaError = result.dcp.errors[0]?.message;

      this.renderObjective();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.state.objective.formulaDcpValid = false;
      this.state.objective.formulaError = msg;
      this.renderObjective();
    }
  }

  /**
   * Parse and validate constraint formula
   */
  private async parseConstraintFormula(id: string, cell: string): Promise<void> {
    const conDef = this.state.constraints.find((c) => c.id === id);
    if (!conDef) return;

    if (!cell) {
      conDef.formulaLhsText = undefined;
      conDef.formulaLhsCurvature = undefined;
      conDef.formulaLhsParsedDesc = undefined;
      conDef.formulaLhsDcpValid = undefined;
      conDef.formulaLhsError = undefined;
      this.renderConstraints();
      return;
    }

    try {
      // Read formula from cell
      const formula = await this.readFormula(cell);
      conDef.formulaLhsText = formula;

      if (!formula || !formula.startsWith("=")) {
        // Not a formula, treat as constant
        conDef.formulaLhsCurvature = "constant";
        conDef.formulaLhsParsedDesc = "constant value";
        conDef.formulaLhsDcpValid = true;
        conDef.formulaLhsError = undefined;
        this.renderConstraints();
        return;
      }

      // Parse and analyze
      const result = await parseAndAnalyze(formula, {
        variables: this.getVariableInfo(),
        readRange: (addr) => this.readRange(addr),
        dcpContext: {
          role: "constraint-lhs",
          operator: conDef.operator,
        },
      });

      conDef.formulaLhsCurvature = result.dcp.curvature;
      conDef.formulaLhsParsedDesc = result.description;
      conDef.formulaLhsDcpValid = result.dcp.valid;
      conDef.formulaLhsError = result.dcp.errors[0]?.message;

      this.renderConstraints();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      conDef.formulaLhsDcpValid = false;
      conDef.formulaLhsError = msg;
      this.renderConstraints();
    }
  }

  /**
   * Ensure WASM solver is loaded
   */
  private async ensureWasm(): Promise<void> {
    if (!this.wasmReady) {
      this.setStatus("Loading solver...", "info");
      await loadWasm();
      this.wasmReady = true;
    }
  }

  // --- Variable Management ---

  addVariable(): void {
    const varDef = createDefaultVariable();
    this.state.variables.push(varDef);
    this.renderVariables();
    this.renderObjective(); // Update variable dropdowns
    this.renderConstraints(); // Update variable dropdowns
  }

  updateVariable(id: string, updates: Partial<VariableDefinition>): void {
    const varDef = this.state.variables.find((v) => v.id === id);
    if (varDef) {
      Object.assign(varDef, updates);

      // If name changed, update objective/constraints that reference old name
      if (updates.name !== undefined) {
        this.renderObjective();
        this.renderConstraints();
      }
    }
  }

  removeVariable(id: string): void {
    const idx = this.state.variables.findIndex((v) => v.id === id);
    if (idx !== -1) {
      const name = this.state.variables[idx].name;
      this.state.variables.splice(idx, 1);

      // Clear references to this variable in objective terms
      this.state.objective.linearTerms = this.state.objective.linearTerms.filter(
        (term) => term.varName !== name
      );
      this.state.objective.quadraticTerms = this.state.objective.quadraticTerms.filter(
        (term) => term.varName !== name
      );
      for (const con of this.state.constraints) {
        if (con.variableName === name) {
          con.variableName = "";
        }
      }

      this.renderVariables();
      this.renderObjective();
      this.renderConstraints();
    }
  }

  renderVariables(): void {
    if (!this.variablesContainer) return;
    this.variablesContainer.innerHTML = "";

    const names = this.getVariableNames();

    for (const varDef of this.state.variables) {
      const card = renderVariableCard(
        varDef,
        names,
        (id, updates) => this.updateVariable(id, updates),
        (id) => this.removeVariable(id),
        (inputId) => this.selectRange(inputId)
      );
      this.variablesContainer.appendChild(card);
    }
  }

  // --- Constraint Management ---

  addConstraint(): void {
    const conDef = createDefaultConstraint();
    // Default to first variable if available
    const names = this.getVariableNames();
    if (names.length > 0) {
      conDef.variableName = names[0];
    }
    this.state.constraints.push(conDef);
    this.renderConstraints();
  }

  updateConstraint(id: string, updates: Partial<ConstraintDefinition>): void {
    const conDef = this.state.constraints.find((c) => c.id === id);
    if (conDef) {
      Object.assign(conDef, updates);

      // If formula LHS cell changed, parse it
      if (updates.formulaLhsCell !== undefined) {
        this.parseConstraintFormula(id, updates.formulaLhsCell);
      }

      // If input mode changed, re-render
      if (updates.inputMode !== undefined) {
        this.renderConstraints();
      }
    }
  }

  removeConstraint(id: string): void {
    const idx = this.state.constraints.findIndex((c) => c.id === id);
    if (idx !== -1) {
      this.state.constraints.splice(idx, 1);
      this.renderConstraints();
    }
  }

  renderConstraints(): void {
    if (!this.constraintsContainer) return;
    this.constraintsContainer.innerHTML = "";

    const names = this.getVariableNames();

    for (const conDef of this.state.constraints) {
      const card = renderConstraintCard(
        conDef,
        names,
        (id, updates) => this.updateConstraint(id, updates),
        (id) => this.removeConstraint(id),
        (inputId) => this.selectRange(inputId),
        (inputId) => this.selectFormulaCell(inputId)
      );
      this.constraintsContainer.appendChild(card);
    }
  }

  // --- Objective Management ---

  updateObjectiveSense(sense: "minimize" | "maximize"): void {
    this.state.objective.sense = sense;
  }

  addLinearTerm(): void {
    const term = createDefaultLinearTerm();
    const names = this.getVariableNames();
    if (names.length > 0) {
      term.varName = names[0];
    }
    this.state.objective.linearTerms.push(term);
    this.renderObjective();
  }

  updateLinearTerm(id: string, updates: Partial<LinearTerm>): void {
    const term = this.state.objective.linearTerms.find((t) => t.id === id);
    if (term) {
      Object.assign(term, updates);
    }
  }

  removeLinearTerm(id: string): void {
    const idx = this.state.objective.linearTerms.findIndex((t) => t.id === id);
    if (idx !== -1) {
      this.state.objective.linearTerms.splice(idx, 1);
      this.renderObjective();
    }
  }

  addQuadraticTerm(): void {
    const term = createDefaultQuadraticTerm();
    const names = this.getVariableNames();
    if (names.length > 0) {
      term.varName = names[0];
    }
    this.state.objective.quadraticTerms.push(term);
    this.renderObjective();
  }

  updateQuadraticTerm(id: string, updates: Partial<QuadraticTerm>): void {
    const term = this.state.objective.quadraticTerms.find((t) => t.id === id);
    if (term) {
      Object.assign(term, updates);
    }
  }

  removeQuadraticTerm(id: string): void {
    const idx = this.state.objective.quadraticTerms.findIndex((t) => t.id === id);
    if (idx !== -1) {
      this.state.objective.quadraticTerms.splice(idx, 1);
      this.renderObjective();
    }
  }

  updateObjectiveMode(mode: InputMode): void {
    this.state.objective.inputMode = mode;
    this.renderObjective();
  }

  updateObjectiveFormulaCell(cell: string): void {
    this.state.objective.formulaCell = cell;
    // Parse formula asynchronously
    this.parseObjectiveFormula(cell);
  }

  renderObjective(): void {
    if (!this.objectiveContainer) return;
    this.objectiveContainer.innerHTML = "";

    const names = this.getVariableNames();

    const section = renderObjectiveSection(this.state.objective, names, {
      onSenseChange: (sense) => this.updateObjectiveSense(sense),
      onModeChange: (mode) => this.updateObjectiveMode(mode),
      onFormulaCellChange: (cell) => this.updateObjectiveFormulaCell(cell),
      onSelectFormulaCell: (inputId) => this.selectFormulaCell(inputId),
      onAddLinear: () => this.addLinearTerm(),
      onUpdateLinear: (id, updates) => this.updateLinearTerm(id, updates),
      onRemoveLinear: (id) => this.removeLinearTerm(id),
      onAddQuadratic: () => this.addQuadraticTerm(),
      onUpdateQuadratic: (id, updates) => this.updateQuadraticTerm(id, updates),
      onRemoveQuadratic: (id) => this.removeQuadraticTerm(id),
      onSelectRange: (inputId) => this.selectRange(inputId),
    });

    this.objectiveContainer.appendChild(section);
  }

  // --- Solve ---

  async solve(): Promise<void> {
    try {
      this.setStatus("Compiling problem...", "info");
      await this.ensureWasm();

      // Compile problem
      const compiler = new ProblemCompiler((addr) => this.readRange(addr));
      const { problem, variableMap, variableDimensions } = await compiler.compile(this.state);

      this.setStatus("Solving...", "info");
      const solution = await problem.solve();

      // Map solution
      this.lastResult = mapSolution(solution, variableMap, this.state.variables);

      // Display results
      this.renderResults();

      if (this.lastResult.status === "optimal") {
        const optVal = this.lastResult.objectiveValue?.toFixed(6) ?? "N/A";
        this.setStatus(`Solved! Optimal value: ${optVal}`, "success");
      } else {
        this.setStatus(`${this.lastResult.status}: ${this.lastResult.errorMessage}`, "error");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Error: ${msg}`, "error");
      this.lastResult = {
        status: "error",
        variables: [],
        constraints: [],
        errorMessage: msg,
      };
      this.renderResults();
    }
  }

  // --- Results Display ---

  renderResults(): void {
    if (!this.resultsContainer) return;
    this.resultsContainer.innerHTML = "";

    if (!this.lastResult) {
      this.resultsContainer.innerHTML = "<p>No results yet. Click Solve to run.</p>";
      return;
    }

    const result = this.lastResult;

    // Status header
    const statusHeader = document.createElement("div");
    statusHeader.className = `pb-result-status pb-result-${result.status}`;
    statusHeader.innerHTML = `<strong>Status:</strong> ${result.status}`;
    if (result.objectiveValue !== undefined) {
      statusHeader.innerHTML += ` | <strong>Objective:</strong> ${result.objectiveValue.toFixed(6)}`;
    }
    this.resultsContainer.appendChild(statusHeader);

    if (result.errorMessage) {
      const errorMsg = document.createElement("p");
      errorMsg.className = "pb-result-error";
      errorMsg.textContent = result.errorMessage;
      this.resultsContainer.appendChild(errorMsg);
    }

    // Variable results
    for (const varResult of result.variables) {
      const varCard = document.createElement("div");
      varCard.className = "pb-result-card";

      const header = document.createElement("div");
      header.className = "pb-result-header";
      header.innerHTML = `<strong>${varResult.name}</strong>`;
      varCard.appendChild(header);

      const values = roundValues(varResult.values);
      const valuesStr =
        values.length <= 10
          ? values.map((v) => v.toFixed(4)).join(", ")
          : values
              .slice(0, 10)
              .map((v) => v.toFixed(4))
              .join(", ") + ` ... (${values.length} total)`;

      const valuesEl = document.createElement("div");
      valuesEl.className = "pb-result-values";
      valuesEl.textContent = `[${valuesStr}]`;
      varCard.appendChild(valuesEl);

      // Write to Excel option
      const writeRow = document.createElement("div");
      writeRow.className = "pb-result-write";

      const writeInput = document.createElement("input");
      writeInput.type = "text";
      writeInput.placeholder = "Output cell (e.g., K1)";
      writeInput.id = `pb-write-${varResult.name}`;
      writeRow.appendChild(writeInput);

      const selectBtn = document.createElement("button");
      selectBtn.className = "secondary";
      selectBtn.textContent = "Select";
      selectBtn.onclick = () => this.selectRange(`pb-write-${varResult.name}`);
      writeRow.appendChild(selectBtn);

      const writeBtn = document.createElement("button");
      writeBtn.textContent = "Write";
      writeBtn.onclick = async () => {
        const addr = writeInput.value.trim();
        if (!addr) {
          this.setStatus("Enter an output cell address", "error");
          return;
        }
        try {
          const output = values.map((v) => [v]);
          await this.writeRange(addr, output);
          this.setStatus(`Wrote ${varResult.name} to ${addr}`, "success");
        } catch (err) {
          this.setStatus(`Error writing: ${err}`, "error");
        }
      };
      writeRow.appendChild(writeBtn);

      varCard.appendChild(writeRow);
      this.resultsContainer.appendChild(varCard);
    }
  }
}

// Export singleton instance
export const problemBuilder = new ProblemBuilderController();
