/**
 * UI Components
 *
 * Reusable HTML builders for the Problem Builder interface.
 */

import type {
  VariableDefinition,
  ConstraintDefinition,
  ObjectiveDefinition,
  LinearTerm,
  QuadraticTerm,
  VarType,
  ConstraintOperator,
  ConstraintExprType,
  InputMode,
} from "./types.js";
import { getCurvatureBadge, getCurvatureClass } from "../../formula-mode/index.js";

/**
 * Create a card container element
 */
export function createCard(id: string, onRemove?: () => void): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "pb-card";
  card.id = id;

  if (onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.className = "pb-remove-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove";
    removeBtn.onclick = (e) => {
      e.preventDefault();
      onRemove();
    };
    card.appendChild(removeBtn);
  }

  return card;
}

/**
 * Create a labeled input with optional select button
 */
export function createRangeInput(
  label: string,
  id: string,
  placeholder: string,
  onSelect: (inputId: string) => void
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "pb-field";

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const inputRow = document.createElement("div");
  inputRow.className = "range-input";

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.placeholder = placeholder;
  inputRow.appendChild(input);

  const selectBtn = document.createElement("button");
  selectBtn.className = "secondary";
  selectBtn.textContent = "Select";
  selectBtn.onclick = (e) => {
    e.preventDefault();
    onSelect(id);
  };
  inputRow.appendChild(selectBtn);

  container.appendChild(inputRow);
  return container;
}

/**
 * Create a text input field
 */
export function createTextInput(
  label: string,
  id: string,
  placeholder: string,
  value = ""
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "pb-field";

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.placeholder = placeholder;
  input.value = value;
  container.appendChild(input);

  return container;
}

/**
 * Create a number input field
 */
export function createNumberInput(
  label: string,
  id: string,
  value: number | null,
  placeholder = ""
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "pb-field";

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const input = document.createElement("input");
  input.type = "number";
  input.id = id;
  input.placeholder = placeholder;
  input.value = value !== null ? String(value) : "";
  container.appendChild(input);

  return container;
}

/**
 * Create a select dropdown
 */
export function createSelect<T extends string>(
  label: string,
  id: string,
  options: { value: T; label: string }[],
  selected?: T
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "pb-field";

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const select = document.createElement("select");
  select.id = id;

  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === selected) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  container.appendChild(select);
  return container;
}

/**
 * Create a checkbox field
 */
export function createCheckbox(
  label: string,
  id: string,
  checked = false
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "pb-field pb-checkbox";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  container.appendChild(input);

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  return container;
}

/**
 * Create a horizontal row of fields
 */
export function createFieldRow(...children: HTMLElement[]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "pb-field-row";
  for (const child of children) {
    row.appendChild(child);
  }
  return row;
}

/**
 * Create a mode toggle (Formula/Cards)
 */
export function createModeToggle(
  id: string,
  selected: InputMode,
  onChange: (mode: InputMode) => void
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "pb-mode-toggle";

  const formulaBtn = document.createElement("button");
  formulaBtn.type = "button";
  formulaBtn.id = `${id}-formula`;
  formulaBtn.className = selected === "formula" ? "active" : "";
  formulaBtn.textContent = "Formula";
  formulaBtn.onclick = () => {
    formulaBtn.className = "active";
    cardsBtn.className = "";
    onChange("formula");
  };
  container.appendChild(formulaBtn);

  const cardsBtn = document.createElement("button");
  cardsBtn.type = "button";
  cardsBtn.id = `${id}-cards`;
  cardsBtn.className = selected === "cards" ? "active" : "";
  cardsBtn.textContent = "Cards";
  cardsBtn.onclick = () => {
    cardsBtn.className = "active";
    formulaBtn.className = "";
    onChange("cards");
  };
  container.appendChild(cardsBtn);

  return container;
}

/**
 * Create a formula input with cell selection and DCP indicator
 */
export function createFormulaInput(
  id: string,
  label: string,
  cellValue: string,
  formulaText: string,
  parsedDesc: string | undefined,
  curvature: string | undefined,
  dcpValid: boolean | undefined,
  errorMessage: string | undefined,
  onSelectCell: (inputId: string) => void,
  onCellChange: (cell: string) => void
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "pb-formula-input";

  // Label
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  container.appendChild(labelEl);

  // Cell input row
  const inputRow = document.createElement("div");
  inputRow.className = "pb-formula-input-row";

  const cellInput = document.createElement("input");
  cellInput.type = "text";
  cellInput.id = `${id}-cell`;
  cellInput.className = "pb-formula-cell";
  cellInput.placeholder = "e.g., F10";
  cellInput.value = cellValue || "";
  cellInput.addEventListener("change", () => {
    onCellChange(cellInput.value.trim());
  });
  inputRow.appendChild(cellInput);

  const selectBtn = document.createElement("button");
  selectBtn.type = "button";
  selectBtn.className = "secondary";
  selectBtn.textContent = "Select Cell";
  selectBtn.onclick = (e) => {
    e.preventDefault();
    onSelectCell(`${id}-cell`);
  };
  inputRow.appendChild(selectBtn);

  container.appendChild(inputRow);

  // Formula display
  const formulaDisplay = document.createElement("div");
  formulaDisplay.className = "pb-formula-display";
  formulaDisplay.id = `${id}-formula-display`;
  if (formulaText) {
    formulaDisplay.innerHTML = `<code>${escapeHtml(formulaText)}</code>`;
  } else {
    formulaDisplay.innerHTML = '<span class="placeholder">Select a cell to read its formula</span>';
  }
  container.appendChild(formulaDisplay);

  // Parsed result display
  if (parsedDesc && curvature) {
    const resultDisplay = document.createElement("div");
    resultDisplay.className = "pb-formula-result";
    resultDisplay.innerHTML = `
      <span class="parsed-expr">${escapeHtml(parsedDesc)}</span>
      <span class="curvature-badge ${getCurvatureClass(curvature as 'constant' | 'affine' | 'convex' | 'concave' | 'unknown')}">${getCurvatureBadge(curvature as 'constant' | 'affine' | 'convex' | 'concave' | 'unknown')}</span>
    `;
    container.appendChild(resultDisplay);
  }

  // DCP status indicator
  const statusIndicator = document.createElement("div");
  statusIndicator.className = "pb-dcp-status";
  statusIndicator.id = `${id}-dcp-status`;

  if (dcpValid === true) {
    statusIndicator.classList.add("dcp-valid");
    statusIndicator.innerHTML = "✓ DCP Valid";
  } else if (dcpValid === false) {
    statusIndicator.classList.add("dcp-invalid");
    statusIndicator.innerHTML = `✗ ${escapeHtml(errorMessage || "Not DCP compliant")}`;
  } else if (cellValue && !formulaText) {
    statusIndicator.classList.add("dcp-pending");
    statusIndicator.innerHTML = "⋯ Reading formula...";
  }
  container.appendChild(statusIndicator);

  return container;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render a variable card
 */
export function renderVariableCard(
  varDef: VariableDefinition,
  variableNames: string[],
  onUpdate: (id: string, updates: Partial<VariableDefinition>) => void,
  onRemove: (id: string) => void,
  onSelectRange: (inputId: string) => void
): HTMLDivElement {
  const card = createCard(`var-${varDef.id}`, () => onRemove(varDef.id));

  // Name field
  const nameField = createTextInput("Name", `var-name-${varDef.id}`, "e.g., weights", varDef.name);
  const nameInput = nameField.querySelector("input")!;
  nameInput.addEventListener("change", () => {
    onUpdate(varDef.id, { name: nameInput.value.trim() });
  });
  card.appendChild(nameField);

  // Dimension mode and value
  const dimModeSelect = createSelect<"range" | "manual">(
    "Dimension",
    `var-dimmode-${varDef.id}`,
    [
      { value: "range", label: "From Range" },
      { value: "manual", label: "Manual" },
    ],
    varDef.dimensionMode
  );
  card.appendChild(dimModeSelect);

  const dimModeEl = dimModeSelect.querySelector("select")!;

  // Dimension range input (shown when mode = range)
  const dimRangeField = createRangeInput(
    "Dimension Range",
    `var-dimrange-${varDef.id}`,
    "e.g., A1:A5",
    onSelectRange
  );
  dimRangeField.id = `var-dimrange-container-${varDef.id}`;
  const dimRangeInput = dimRangeField.querySelector("input")!;
  dimRangeInput.value = varDef.dimensionRange;
  dimRangeInput.addEventListener("change", () => {
    onUpdate(varDef.id, { dimensionRange: dimRangeInput.value });
  });
  card.appendChild(dimRangeField);

  // Dimension manual input (shown when mode = manual)
  const dimManualField = createNumberInput("Dimension", `var-dimmanual-${varDef.id}`, varDef.dimension);
  dimManualField.id = `var-dimmanual-container-${varDef.id}`;
  const dimManualInput = dimManualField.querySelector("input")!;
  dimManualInput.addEventListener("change", () => {
    onUpdate(varDef.id, { dimension: parseInt(dimManualInput.value, 10) || 1 });
  });
  card.appendChild(dimManualField);

  // Toggle visibility based on dimension mode
  const updateDimVisibility = () => {
    const mode = dimModeEl.value as "range" | "manual";
    dimRangeField.style.display = mode === "range" ? "block" : "none";
    dimManualField.style.display = mode === "manual" ? "block" : "none";
  };
  dimModeEl.addEventListener("change", () => {
    onUpdate(varDef.id, { dimensionMode: dimModeEl.value as "range" | "manual" });
    updateDimVisibility();
  });
  updateDimVisibility();

  // Variable type
  const typeSelect = createSelect<VarType>(
    "Type",
    `var-type-${varDef.id}`,
    [
      { value: "continuous", label: "Continuous" },
      { value: "integer", label: "Integer" },
      { value: "binary", label: "Binary" },
    ],
    varDef.varType
  );
  const typeEl = typeSelect.querySelector("select")!;
  typeEl.addEventListener("change", () => {
    onUpdate(varDef.id, { varType: typeEl.value as VarType });
  });
  card.appendChild(typeSelect);

  // Bounds (inline)
  const boundsRow = createFieldRow(
    createNumberInput("Lower", `var-lb-${varDef.id}`, varDef.lowerBound, "-inf"),
    createNumberInput("Upper", `var-ub-${varDef.id}`, varDef.upperBound, "+inf")
  );
  const lbInput = boundsRow.querySelector(`#var-lb-${varDef.id}`) as HTMLInputElement;
  const ubInput = boundsRow.querySelector(`#var-ub-${varDef.id}`) as HTMLInputElement;
  lbInput.addEventListener("change", () => {
    const val = lbInput.value.trim();
    onUpdate(varDef.id, { lowerBound: val === "" ? null : parseFloat(val) });
  });
  ubInput.addEventListener("change", () => {
    const val = ubInput.value.trim();
    onUpdate(varDef.id, { upperBound: val === "" ? null : parseFloat(val) });
  });
  card.appendChild(boundsRow);

  return card;
}

/**
 * Render a constraint card
 */
export function renderConstraintCard(
  conDef: ConstraintDefinition,
  variableNames: string[],
  onUpdate: (id: string, updates: Partial<ConstraintDefinition>) => void,
  onRemove: (id: string) => void,
  onSelectRange: (inputId: string) => void,
  onSelectFormulaCell?: (inputId: string) => void
): HTMLDivElement {
  const card = createCard(`con-${conDef.id}`, () => onRemove(conDef.id));

  // Name field
  const nameField = createTextInput("Name", `con-name-${conDef.id}`, "e.g., budget", conDef.name);
  const nameInput = nameField.querySelector("input")!;
  nameInput.addEventListener("change", () => {
    onUpdate(conDef.id, { name: nameInput.value.trim() });
  });
  card.appendChild(nameField);

  // Mode toggle (Formula / Cards)
  const modeToggle = createModeToggle(`con-mode-${conDef.id}`, conDef.inputMode, (mode) => {
    onUpdate(conDef.id, { inputMode: mode });
    updateModeVisibility();
  });
  card.appendChild(modeToggle);

  // Formula mode container
  const formulaContainer = document.createElement("div");
  formulaContainer.id = `con-formula-container-${conDef.id}`;

  // LHS formula input
  const lhsFormulaInput = createFormulaInput(
    `con-lhs-formula-${conDef.id}`,
    "LHS Formula Cell",
    conDef.formulaLhsCell || "",
    conDef.formulaLhsText || "",
    conDef.formulaLhsParsedDesc,
    conDef.formulaLhsCurvature,
    conDef.formulaLhsDcpValid,
    conDef.formulaLhsError,
    onSelectFormulaCell || onSelectRange,
    (cell) => onUpdate(conDef.id, { formulaLhsCell: cell })
  );
  formulaContainer.appendChild(lhsFormulaInput);

  // Operator (shared between modes)
  const formulaOpSelect = createSelect<ConstraintOperator>(
    "Operator",
    `con-formula-op-${conDef.id}`,
    [
      { value: "<=", label: "≤" },
      { value: ">=", label: "≥" },
      { value: "==", label: "=" },
    ],
    conDef.operator
  );
  const formulaOpEl = formulaOpSelect.querySelector("select")!;
  formulaOpEl.addEventListener("change", () => {
    onUpdate(conDef.id, { operator: formulaOpEl.value as ConstraintOperator });
  });
  formulaContainer.appendChild(formulaOpSelect);

  // RHS formula input (simpler - just cell or constant)
  const rhsRow = document.createElement("div");
  rhsRow.className = "pb-formula-rhs-row";

  const rhsLabel = document.createElement("label");
  rhsLabel.textContent = "RHS (cell or value)";
  rhsRow.appendChild(rhsLabel);

  const rhsInput = document.createElement("input");
  rhsInput.type = "text";
  rhsInput.id = `con-formula-rhs-${conDef.id}`;
  rhsInput.placeholder = "e.g., 1 or H2";
  rhsInput.value = conDef.formulaRhsText || conDef.formulaRhsCell || "";
  rhsInput.addEventListener("change", () => {
    const val = rhsInput.value.trim();
    // Check if it's a cell reference or a number
    if (/^[A-Z]+[0-9]+$/i.test(val)) {
      onUpdate(conDef.id, { formulaRhsCell: val, formulaRhsText: undefined });
    } else {
      onUpdate(conDef.id, { formulaRhsText: val, formulaRhsCell: undefined });
    }
  });
  rhsRow.appendChild(rhsInput);

  const rhsSelectBtn = document.createElement("button");
  rhsSelectBtn.type = "button";
  rhsSelectBtn.className = "secondary";
  rhsSelectBtn.textContent = "Select";
  rhsSelectBtn.onclick = (e) => {
    e.preventDefault();
    (onSelectFormulaCell || onSelectRange)(`con-formula-rhs-${conDef.id}`);
  };
  rhsRow.appendChild(rhsSelectBtn);

  formulaContainer.appendChild(rhsRow);

  // DCP status for constraint
  if (conDef.formulaLhsDcpValid !== undefined) {
    const statusIndicator = document.createElement("div");
    statusIndicator.className = "pb-dcp-status";

    if (conDef.formulaLhsDcpValid && conDef.formulaRhsDcpValid !== false) {
      statusIndicator.classList.add("dcp-valid");
      statusIndicator.innerHTML = "✓ DCP Valid Constraint";
    } else {
      statusIndicator.classList.add("dcp-invalid");
      const error = conDef.formulaLhsError || conDef.formulaRhsError || "Not DCP compliant";
      statusIndicator.innerHTML = `✗ ${escapeHtml(error)}`;
    }
    formulaContainer.appendChild(statusIndicator);
  }

  card.appendChild(formulaContainer);

  // Cards mode container
  const cardsContainer = document.createElement("div");
  cardsContainer.id = `con-cards-container-${conDef.id}`;

  // Expression type
  const exprTypeSelect = createSelect<ConstraintExprType>(
    "Type",
    `con-exprtype-${conDef.id}`,
    [
      { value: "variable", label: "Variable (x ≤ b)" },
      { value: "sum", label: "Sum (sum(x) = c)" },
      { value: "linear", label: "Linear (A @ x ≤ b)" },
    ],
    conDef.exprType
  );
  cardsContainer.appendChild(exprTypeSelect);

  // Variable selection
  const varOptions = variableNames.map((name) => ({ value: name, label: name }));
  if (varOptions.length === 0) {
    varOptions.push({ value: "", label: "(no variables)" });
  }
  const varSelect = createSelect(
    "Variable",
    `con-var-${conDef.id}`,
    varOptions,
    conDef.variableName
  );
  const varEl = varSelect.querySelector("select")!;
  varEl.addEventListener("change", () => {
    onUpdate(conDef.id, { variableName: varEl.value });
  });
  cardsContainer.appendChild(varSelect);

  // LHS Range (for linear constraints)
  const lhsField = createRangeInput(
    "Matrix (A)",
    `con-lhs-${conDef.id}`,
    "e.g., B1:F3",
    onSelectRange
  );
  lhsField.id = `con-lhs-container-${conDef.id}`;
  const lhsInput = lhsField.querySelector("input")!;
  lhsInput.value = conDef.lhsRange || "";
  lhsInput.addEventListener("change", () => {
    onUpdate(conDef.id, { lhsRange: lhsInput.value });
  });
  cardsContainer.appendChild(lhsField);

  // Operator
  const opSelect = createSelect<ConstraintOperator>(
    "Operator",
    `con-op-${conDef.id}`,
    [
      { value: "<=", label: "≤" },
      { value: ">=", label: "≥" },
      { value: "==", label: "=" },
    ],
    conDef.operator
  );
  const opEl = opSelect.querySelector("select")!;
  opEl.addEventListener("change", () => {
    onUpdate(conDef.id, { operator: opEl.value as ConstraintOperator });
  });
  cardsContainer.appendChild(opSelect);

  // RHS mode
  const rhsModeSelect = createSelect<"scalar" | "range">(
    "RHS Type",
    `con-rhsmode-${conDef.id}`,
    [
      { value: "scalar", label: "Scalar" },
      { value: "range", label: "Range" },
    ],
    conDef.rhsMode
  );
  cardsContainer.appendChild(rhsModeSelect);

  // RHS scalar
  const rhsScalarField = createNumberInput("Value", `con-rhsscalar-${conDef.id}`, conDef.rhsScalar);
  rhsScalarField.id = `con-rhsscalar-container-${conDef.id}`;
  const rhsScalarInput = rhsScalarField.querySelector("input")!;
  rhsScalarInput.addEventListener("change", () => {
    onUpdate(conDef.id, { rhsScalar: parseFloat(rhsScalarInput.value) || 0 });
  });
  cardsContainer.appendChild(rhsScalarField);

  // RHS range
  const rhsRangeField = createRangeInput(
    "RHS Range",
    `con-rhsrange-${conDef.id}`,
    "e.g., G1:G3",
    onSelectRange
  );
  rhsRangeField.id = `con-rhsrange-container-${conDef.id}`;
  const rhsRangeInput = rhsRangeField.querySelector("input")!;
  rhsRangeInput.value = conDef.rhsRange;
  rhsRangeInput.addEventListener("change", () => {
    onUpdate(conDef.id, { rhsRange: rhsRangeInput.value });
  });
  cardsContainer.appendChild(rhsRangeField);

  card.appendChild(cardsContainer);

  // Update visibility based on expression type, RHS mode, and input mode
  const exprTypeEl = exprTypeSelect.querySelector("select")!;
  const rhsModeEl = rhsModeSelect.querySelector("select")!;

  const updateCardsModeVisibility = () => {
    const exprType = exprTypeEl.value as ConstraintExprType;
    const rhsMode = rhsModeEl.value as "scalar" | "range";

    // LHS only for linear
    lhsField.style.display = exprType === "linear" ? "block" : "none";

    // RHS fields
    rhsScalarField.style.display = rhsMode === "scalar" ? "block" : "none";
    rhsRangeField.style.display = rhsMode === "range" ? "block" : "none";
  };

  const updateModeVisibility = () => {
    const mode = conDef.inputMode;
    formulaContainer.style.display = mode === "formula" ? "block" : "none";
    cardsContainer.style.display = mode === "cards" ? "block" : "none";
    if (mode === "cards") {
      updateCardsModeVisibility();
    }
  };

  exprTypeEl.addEventListener("change", () => {
    onUpdate(conDef.id, { exprType: exprTypeEl.value as ConstraintExprType });
    updateCardsModeVisibility();
  });

  rhsModeEl.addEventListener("change", () => {
    onUpdate(conDef.id, { rhsMode: rhsModeEl.value as "scalar" | "range" });
    updateCardsModeVisibility();
  });

  updateModeVisibility();

  return card;
}

/**
 * Render a linear term card
 */
export function renderLinearTermCard(
  term: LinearTerm,
  variableNames: string[],
  onUpdate: (id: string, updates: Partial<LinearTerm>) => void,
  onRemove: (id: string) => void,
  onSelectRange: (inputId: string) => void
): HTMLDivElement {
  const card = createCard(`linear-${term.id}`, () => onRemove(term.id));

  // Coefficient range
  const coefField = createRangeInput(
    "Coefficients (c)",
    `linear-coef-${term.id}`,
    "e.g., C1:C5",
    onSelectRange
  );
  const coefInput = coefField.querySelector("input")!;
  coefInput.value = term.coefsRange;
  coefInput.addEventListener("change", () => {
    onUpdate(term.id, { coefsRange: coefInput.value });
  });
  card.appendChild(coefField);

  // Variable selection
  const varOptions = variableNames.map((name) => ({ value: name, label: name }));
  if (varOptions.length === 0) {
    varOptions.push({ value: "", label: "(no variables)" });
  }
  const varSelect = createSelect(
    "Variable",
    `linear-var-${term.id}`,
    varOptions,
    term.varName
  );
  const varEl = varSelect.querySelector("select")!;
  varEl.addEventListener("change", () => {
    onUpdate(term.id, { varName: varEl.value });
  });
  card.appendChild(varSelect);

  return card;
}

/**
 * Render a quadratic term card
 */
export function renderQuadraticTermCard(
  term: QuadraticTerm,
  variableNames: string[],
  onUpdate: (id: string, updates: Partial<QuadraticTerm>) => void,
  onRemove: (id: string) => void,
  onSelectRange: (inputId: string) => void
): HTMLDivElement {
  const card = createCard(`quad-${term.id}`, () => onRemove(term.id));

  // Matrix range
  const matrixField = createRangeInput(
    "Matrix (Q)",
    `quad-matrix-${term.id}`,
    "e.g., D1:H5",
    onSelectRange
  );
  const matrixInput = matrixField.querySelector("input")!;
  matrixInput.value = term.matrixRange;
  matrixInput.addEventListener("change", () => {
    onUpdate(term.id, { matrixRange: matrixInput.value });
  });
  card.appendChild(matrixField);

  // Variable selection
  const varOptions = variableNames.map((name) => ({ value: name, label: name }));
  if (varOptions.length === 0) {
    varOptions.push({ value: "", label: "(no variables)" });
  }
  const varSelect = createSelect(
    "Variable",
    `quad-var-${term.id}`,
    varOptions,
    term.varName
  );
  const varEl = varSelect.querySelector("select")!;
  varEl.addEventListener("change", () => {
    onUpdate(term.id, { varName: varEl.value });
  });
  card.appendChild(varSelect);

  return card;
}

/**
 * Render the objective section
 */
export function renderObjectiveSection(
  objDef: ObjectiveDefinition,
  variableNames: string[],
  callbacks: {
    onSenseChange: (sense: "minimize" | "maximize") => void;
    onModeChange: (mode: InputMode) => void;
    onFormulaCellChange: (cell: string) => void;
    onSelectFormulaCell: (inputId: string) => void;
    onAddLinear: () => void;
    onUpdateLinear: (id: string, updates: Partial<LinearTerm>) => void;
    onRemoveLinear: (id: string) => void;
    onAddQuadratic: () => void;
    onUpdateQuadratic: (id: string, updates: Partial<QuadraticTerm>) => void;
    onRemoveQuadratic: (id: string) => void;
    onSelectRange: (inputId: string) => void;
  }
): HTMLDivElement {
  const section = document.createElement("div");
  section.className = "pb-section";

  // Mode toggle (Formula / Cards)
  const modeToggle = createModeToggle("pb-obj-mode", objDef.inputMode, callbacks.onModeChange);
  section.appendChild(modeToggle);

  // Sense
  const senseSelect = createSelect<"minimize" | "maximize">(
    "Sense",
    "pb-obj-sense",
    [
      { value: "minimize", label: "Minimize" },
      { value: "maximize", label: "Maximize" },
    ],
    objDef.sense
  );
  const senseEl = senseSelect.querySelector("select")!;
  senseEl.addEventListener("change", () => {
    callbacks.onSenseChange(senseEl.value as "minimize" | "maximize");
  });
  section.appendChild(senseSelect);

  // Formula mode container
  const formulaContainer = document.createElement("div");
  formulaContainer.id = "pb-obj-formula-container";
  formulaContainer.style.display = objDef.inputMode === "formula" ? "block" : "none";

  const formulaInput = createFormulaInput(
    "pb-obj",
    "Objective Cell",
    objDef.formulaCell || "",
    objDef.formulaText || "",
    objDef.formulaParsedDesc,
    objDef.formulaCurvature,
    objDef.formulaDcpValid,
    objDef.formulaError,
    callbacks.onSelectFormulaCell,
    callbacks.onFormulaCellChange
  );
  formulaContainer.appendChild(formulaInput);
  section.appendChild(formulaContainer);

  // Cards mode container
  const cardsContainer = document.createElement("div");
  cardsContainer.id = "pb-obj-cards-container";
  cardsContainer.style.display = objDef.inputMode === "cards" ? "block" : "none";

  // Linear terms section
  const linearHeader = document.createElement("div");
  linearHeader.className = "pb-section-header";
  linearHeader.innerHTML = `<span style="font-size: 12px; color: #666;">Linear terms (c' @ x)</span>`;
  const addLinearBtn = document.createElement("button");
  addLinearBtn.className = "secondary";
  addLinearBtn.textContent = "+ Add";
  addLinearBtn.style.padding = "2px 8px";
  addLinearBtn.style.fontSize = "11px";
  addLinearBtn.onclick = (e) => {
    e.preventDefault();
    callbacks.onAddLinear();
  };
  linearHeader.appendChild(addLinearBtn);
  cardsContainer.appendChild(linearHeader);

  const linearList = document.createElement("div");
  linearList.id = "pb-linear-terms";
  for (const term of objDef.linearTerms) {
    const card = renderLinearTermCard(
      term,
      variableNames,
      callbacks.onUpdateLinear,
      callbacks.onRemoveLinear,
      callbacks.onSelectRange
    );
    linearList.appendChild(card);
  }
  cardsContainer.appendChild(linearList);

  // Quadratic terms section
  const quadHeader = document.createElement("div");
  quadHeader.className = "pb-section-header";
  quadHeader.style.marginTop = "12px";
  quadHeader.innerHTML = `<span style="font-size: 12px; color: #666;">Quadratic terms (0.5 x' Q x)</span>`;
  const addQuadBtn = document.createElement("button");
  addQuadBtn.className = "secondary";
  addQuadBtn.textContent = "+ Add";
  addQuadBtn.style.padding = "2px 8px";
  addQuadBtn.style.fontSize = "11px";
  addQuadBtn.onclick = (e) => {
    e.preventDefault();
    callbacks.onAddQuadratic();
  };
  quadHeader.appendChild(addQuadBtn);
  cardsContainer.appendChild(quadHeader);

  const quadList = document.createElement("div");
  quadList.id = "pb-quad-terms";
  for (const term of objDef.quadraticTerms) {
    const card = renderQuadraticTermCard(
      term,
      variableNames,
      callbacks.onUpdateQuadratic,
      callbacks.onRemoveQuadratic,
      callbacks.onSelectRange
    );
    quadList.appendChild(card);
  }
  cardsContainer.appendChild(quadList);

  section.appendChild(cardsContainer);

  return section;
}
