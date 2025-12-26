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
} from "cvxjs";
import type {
  ProblemState,
  VariableDefinition,
  ConstraintDefinition,
  ObjectiveDefinition,
  ConstraintOperator,
} from "./types.js";

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
    let objective: Expr | null = null;

    // Add all linear terms
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

  private async buildConstraint(conDef: ConstraintDefinition): Promise<Constraint[]> {
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
}
