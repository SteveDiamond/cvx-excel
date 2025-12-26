/**
 * Problem Compiler
 *
 * Translates ProblemState (UI model) into cvxjs Problem objects.
 */

import {
  variable,
  constant,
  Problem,
  quadForm,
  dot,
  scalarVar,
  type Expr,
  type Constraint as CvxConstraint,
} from "cvxjs";
import type {
  ProblemState,
  VariableDefinition,
  ConstraintDefinition,
  ObjectiveDefinition,
  ConstraintOperator,
} from "./types.js";
import {
  parseAndAnalyze,
  buildExpression,
  buildConstraint as buildFormulaConstraint,
  createBuildContext,
  type BuildContext,
} from "../../formula-mode/index.js";

// Type for cvxjs constraint
type Constraint = ReturnType<Expr["le"]>;

interface CompiledVariable {
  definition: VariableDefinition;
  expr: Expr;
  dimension: number;
}

export interface CompileResult {
  problem: ReturnType<typeof Problem.minimize>;
  variableMap: Map<string, Expr>;
  variableDimensions: Map<string, number>;
}

type RangeReader = (address: string) => Promise<number[][]>;

/**
 * Compiles a ProblemState into a cvxjs Problem
 */
export class ProblemCompiler {
  private variables = new Map<string, CompiledVariable>();
  private readRange: RangeReader;

  constructor(readRange: RangeReader) {
    this.readRange = readRange;
  }

  async compile(state: ProblemState): Promise<CompileResult> {
    this.variables.clear();

    // Validate
    if (state.variables.length === 0) {
      throw new Error("At least one variable is required");
    }

    // 1. Build variables
    for (const varDef of state.variables) {
      if (!varDef.name.trim()) {
        throw new Error("All variables must have a name");
      }
      if (this.variables.has(varDef.name)) {
        throw new Error(`Duplicate variable name: ${varDef.name}`);
      }

      const dim = await this.resolveDimension(varDef);
      const expr = this.createVariable(varDef, dim);
      this.variables.set(varDef.name, { definition: varDef, expr, dimension: dim });
    }

    // 2. Build objective
    const objective = await this.buildObjective(state.objective);

    // 3. Build constraints
    const constraints: Constraint[] = [];

    // Add explicit constraints from state
    for (const conDef of state.constraints) {
      const cons = await this.buildConstraint(conDef);
      constraints.push(...cons);
    }

    // Add bound constraints for each variable
    for (const [, compiled] of this.variables) {
      const varDef = compiled.definition;
      const x = compiled.expr;

      // Apply lower bound if not already handled by nonneg option
      if (varDef.lowerBound !== null && varDef.lowerBound !== 0) {
        constraints.push(x.ge(varDef.lowerBound));
      } else if (varDef.lowerBound === 0 && varDef.varType !== "continuous") {
        // Integer/binary with nonneg already set in scalarVar
      } else if (varDef.lowerBound === 0) {
        constraints.push(x.ge(0));
      }

      // Apply upper bound
      if (varDef.upperBound !== null) {
        constraints.push(x.le(varDef.upperBound));
      }
    }

    // 4. Assemble problem
    const problem =
      state.objective.sense === "minimize"
        ? Problem.minimize(objective).subjectTo(constraints)
        : Problem.maximize(objective).subjectTo(constraints);

    // Build return maps
    const variableMap = new Map<string, Expr>();
    const variableDimensions = new Map<string, number>();
    for (const [name, compiled] of this.variables) {
      variableMap.set(name, compiled.expr);
      variableDimensions.set(name, compiled.dimension);
    }

    return { problem, variableMap, variableDimensions };
  }

  private async resolveDimension(varDef: VariableDefinition): Promise<number> {
    if (varDef.dimensionMode === "manual") {
      if (varDef.dimension < 1) {
        throw new Error(`Variable ${varDef.name}: dimension must be at least 1`);
      }
      return varDef.dimension;
    }

    if (!varDef.dimensionRange.trim()) {
      throw new Error(`Variable ${varDef.name}: dimension range is required`);
    }

    const data = await this.readRange(varDef.dimensionRange);
    const flat = data.flat();
    if (flat.length === 0) {
      throw new Error(`Variable ${varDef.name}: dimension range is empty`);
    }
    return flat.length;
  }

  private createVariable(varDef: VariableDefinition, dim: number): Expr {
    // For MILP with mixed types or scalar variables, use scalarVar
    if (dim === 1 || varDef.varType === "integer" || varDef.varType === "binary") {
      // For integer/binary, we need individual scalarVar calls
      if (dim === 1) {
        const options: { nonneg?: boolean; integer?: boolean; binary?: boolean } = {};

        if (varDef.varType === "binary") {
          options.binary = true;
        } else if (varDef.varType === "integer") {
          options.integer = true;
          if (varDef.lowerBound === 0 || varDef.lowerBound === null) {
            options.nonneg = true;
          }
        } else {
          if (varDef.lowerBound === 0) {
            options.nonneg = true;
          }
        }

        return scalarVar(options);
      }

      // For multi-dimensional integer/binary, we need to create individual scalarVars
      // This is a limitation - cvxjs doesn't support vector integer variables directly
      // For simplicity, we'll use variable(n) for continuous, and throw for multi-dim integer/binary
      if (varDef.varType !== "continuous") {
        throw new Error(
          `Variable ${varDef.name}: multi-dimensional integer/binary variables are not yet supported. Use dimension 1 or continuous type.`
        );
      }
    }

    // Continuous vector variable
    return variable(dim);
  }

  private async buildObjective(objDef: ObjectiveDefinition): Promise<Expr> {
    // Handle formula mode
    if (objDef.inputMode === "formula") {
      return this.buildFormulaObjective(objDef);
    }

    let objective: Expr | null = null;

    // Add all linear terms (card mode)
    for (const term of objDef.linearTerms) {
      if (!term.varName) {
        throw new Error("Linear term requires a variable");
      }
      if (!term.coefsRange) {
        throw new Error("Linear term requires coefficient range");
      }

      const compiled = this.variables.get(term.varName);
      if (!compiled) {
        throw new Error(`Unknown variable in objective: ${term.varName}`);
      }

      const cData = await this.readRange(term.coefsRange);
      const c = cData.flat();

      if (c.length !== compiled.dimension) {
        throw new Error(
          `Objective coefficients (${c.length}) must match variable ${term.varName} dimension (${compiled.dimension})`
        );
      }

      const cConst = constant(c);
      const linearTerm = dot(cConst, compiled.expr);
      objective = objective ? objective.add(linearTerm) : linearTerm;
    }

    // Add all quadratic terms
    for (const term of objDef.quadraticTerms) {
      if (!term.varName) {
        throw new Error("Quadratic term requires a variable");
      }
      if (!term.matrixRange) {
        throw new Error("Quadratic term requires matrix range");
      }

      const compiled = this.variables.get(term.varName);
      if (!compiled) {
        throw new Error(`Unknown variable in objective: ${term.varName}`);
      }

      const QData = await this.readRange(term.matrixRange);

      // Validate Q dimensions
      if (QData.length !== compiled.dimension || QData[0]?.length !== compiled.dimension) {
        throw new Error(
          `Quadratic matrix must be ${compiled.dimension}x${compiled.dimension} for variable ${term.varName}`
        );
      }

      const QConst = constant(QData);
      const quadTerm = quadForm(compiled.expr, QConst).mul(0.5);
      objective = objective ? objective.add(quadTerm) : quadTerm;
    }

    if (!objective) {
      throw new Error("Objective must have at least one term (linear or quadratic)");
    }

    return objective;
  }

  /**
   * Build objective from formula mode
   */
  private async buildFormulaObjective(objDef: ObjectiveDefinition): Promise<Expr> {
    if (!objDef.formulaText) {
      throw new Error("Formula mode objective requires a formula");
    }

    // Build variable info for parsing
    const variableInfo = Array.from(this.variables.entries()).map(([name, compiled]) => ({
      name,
      range: compiled.definition.dimensionRange || name,
    }));

    // Parse and analyze the formula
    const result = await parseAndAnalyze(objDef.formulaText, {
      variables: variableInfo,
      readRange: this.readRange,
      dcpContext: {
        role: "objective",
        sense: objDef.sense,
      },
    });

    if (!result.dcp.valid) {
      const errorMsg = result.dcp.errors[0]?.message || "Formula is not DCP-compliant";
      throw new Error(`Objective formula error: ${errorMsg}`);
    }

    // Build the expression
    const buildContext = this.createBuildContext();
    return buildExpression(result.ast, buildContext);
  }

  /**
   * Create build context for formula expression building
   */
  private createBuildContext(): BuildContext {
    const variables: Array<{ name: string; dimension: number; expr: Expr }> = [];
    for (const [name, compiled] of this.variables) {
      variables.push({
        name,
        dimension: compiled.dimension,
        expr: compiled.expr,
      });
    }
    return createBuildContext(variables);
  }

  private async buildConstraint(conDef: ConstraintDefinition): Promise<Constraint[]> {
    // Handle formula mode
    if (conDef.inputMode === "formula") {
      return this.buildFormulaConstraint(conDef);
    }

    if (!conDef.variableName) {
      throw new Error(`Constraint ${conDef.name || "(unnamed)"}: variable is required`);
    }

    const compiled = this.variables.get(conDef.variableName);
    if (!compiled) {
      throw new Error(
        `Constraint ${conDef.name || "(unnamed)"}: unknown variable ${conDef.variableName}`
      );
    }

    const x = compiled.expr;

    // Get RHS
    let rhs: number | number[];
    if (conDef.rhsMode === "scalar") {
      rhs = conDef.rhsScalar;
    } else {
      if (!conDef.rhsRange) {
        throw new Error(`Constraint ${conDef.name || "(unnamed)"}: RHS range is required`);
      }
      const rhsData = await this.readRange(conDef.rhsRange);
      rhs = rhsData.flat();
    }

    if (conDef.exprType === "variable") {
      // Simple: x >= rhs, x <= rhs, x == rhs
      if (Array.isArray(rhs)) {
        if (rhs.length !== compiled.dimension) {
          throw new Error(
            `Constraint ${conDef.name || "(unnamed)"}: RHS length (${rhs.length}) must match variable dimension (${compiled.dimension})`
          );
        }
        return [this.makeConstraint(x, conDef.operator, constant(rhs))];
      }
      return [this.makeConstraint(x, conDef.operator, rhs)];
    }

    if (conDef.exprType === "sum") {
      // sum(x) op rhs
      if (Array.isArray(rhs)) {
        throw new Error(
          `Constraint ${conDef.name || "(unnamed)"}: sum constraint requires scalar RHS`
        );
      }
      return [this.makeConstraint(x.sum(), conDef.operator, rhs)];
    }

    if (conDef.exprType === "linear") {
      // A @ x op b - expand to per-row constraints
      if (!conDef.lhsRange) {
        throw new Error(
          `Constraint ${conDef.name || "(unnamed)"}: matrix range (A) is required for linear constraints`
        );
      }

      const AData = await this.readRange(conDef.lhsRange);

      // Validate A dimensions
      if (AData[0]?.length !== compiled.dimension) {
        throw new Error(
          `Constraint ${conDef.name || "(unnamed)"}: matrix columns (${AData[0]?.length}) must match variable dimension (${compiled.dimension})`
        );
      }

      const bData = Array.isArray(rhs)
        ? rhs
        : Array(AData.length).fill(conDef.rhsScalar);

      if (bData.length !== AData.length) {
        throw new Error(
          `Constraint ${conDef.name || "(unnamed)"}: RHS length (${bData.length}) must match matrix rows (${AData.length})`
        );
      }

      const constraints: Constraint[] = [];
      for (let i = 0; i < AData.length; i++) {
        const row = constant(AData[i]);
        constraints.push(this.makeConstraint(dot(row, x), conDef.operator, bData[i]));
      }
      return constraints;
    }

    throw new Error(`Unknown constraint type: ${conDef.exprType}`);
  }

  private makeConstraint(
    lhs: Expr,
    op: ConstraintOperator,
    rhs: Expr | number
  ): Constraint {
    switch (op) {
      case "<=":
        return lhs.le(rhs);
      case ">=":
        return lhs.ge(rhs);
      case "==":
        return lhs.eq(rhs);
    }
  }

  /**
   * Build constraint from formula mode
   */
  private async buildFormulaConstraint(conDef: ConstraintDefinition): Promise<Constraint[]> {
    if (!conDef.formulaLhsText) {
      throw new Error(`Constraint ${conDef.name || "(unnamed)"}: LHS formula is required`);
    }

    // Build variable info for parsing
    const variableInfo = Array.from(this.variables.entries()).map(([name, compiled]) => ({
      name,
      range: compiled.definition.dimensionRange || name,
    }));

    // Parse LHS
    const lhsResult = await parseAndAnalyze(conDef.formulaLhsText, {
      variables: variableInfo,
      readRange: this.readRange,
      dcpContext: {
        role: "constraint-lhs",
        operator: conDef.operator,
      },
    });

    if (!lhsResult.dcp.valid) {
      const errorMsg = lhsResult.dcp.errors[0]?.message || "LHS formula is not DCP-compliant";
      throw new Error(`Constraint ${conDef.name || "(unnamed)"} LHS error: ${errorMsg}`);
    }

    // Parse RHS (if it's a formula)
    let rhsAst = null;
    if (conDef.formulaRhsText && conDef.formulaRhsText.startsWith("=")) {
      const rhsResult = await parseAndAnalyze(conDef.formulaRhsText, {
        variables: variableInfo,
        readRange: this.readRange,
        dcpContext: {
          role: "constraint-rhs",
          operator: conDef.operator,
        },
      });

      if (!rhsResult.dcp.valid) {
        const errorMsg = rhsResult.dcp.errors[0]?.message || "RHS formula is not DCP-compliant";
        throw new Error(`Constraint ${conDef.name || "(unnamed)"} RHS error: ${errorMsg}`);
      }
      rhsAst = rhsResult.ast;
    }

    // Build the constraint expression
    const buildContext = this.createBuildContext();
    const lhsExpr = buildExpression(lhsResult.ast, buildContext);

    let rhsExpr: Expr | number;
    if (rhsAst) {
      rhsExpr = buildExpression(rhsAst, buildContext);
    } else if (conDef.formulaRhsText) {
      // Try to parse as number
      const numValue = parseFloat(conDef.formulaRhsText);
      if (isNaN(numValue)) {
        throw new Error(`Constraint ${conDef.name || "(unnamed)"}: RHS must be a formula or number`);
      }
      rhsExpr = numValue;
    } else {
      // Read from RHS cell if specified
      if (conDef.formulaRhsCell) {
        const rhsData = await this.readRange(conDef.formulaRhsCell);
        rhsExpr = rhsData[0]?.[0] ?? 0;
      } else {
        throw new Error(`Constraint ${conDef.name || "(unnamed)"}: RHS is required`);
      }
    }

    return [this.makeConstraint(lhsExpr, conDef.operator, rhsExpr)];
  }
}
