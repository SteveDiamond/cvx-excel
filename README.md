# CVX Excel

Convex optimization for Microsoft Excel, powered by [cvxjs](https://github.com/SteveDiamond/cvxjs).

## Features

- **Custom Functions**: Use `=CVX.LP()`, `=CVX.QP()`, `=CVX.PORTFOLIO()` directly in cells
- **Task Pane UI**: Interactive solver panel for complex problems
- **Cross-Platform**: Works on Excel Web, Windows Desktop, and Mac
- **No Backend Required**: Solvers run entirely in the browser via WebAssembly

## Custom Functions

### CVX.LP - Linear Programming

Solve: minimize c'x subject to Ax ≤ b, x ≥ 0

```
=CVX.LP(c_range, A_range, b_range, "min")
```

| Parameter | Description |
|-----------|-------------|
| c | Objective coefficients (column vector) |
| A | Constraint matrix (m × n) |
| b | Constraint RHS (column vector) |
| sense | "min" or "max" (optional, default: "min") |

**Returns**: Column with optimal value followed by solution values.

### CVX.QP - Quadratic Programming

Solve: minimize 0.5x'Qx + c'x subject to Ax ≤ b, x ≥ 0

```
=CVX.QP(Q_range, c_range, A_range, b_range)
```

| Parameter | Description |
|-----------|-------------|
| Q | Quadratic cost matrix (n × n, positive semidefinite) |
| c | Linear cost coefficients |
| A | Constraint matrix |
| b | Constraint RHS |

### CVX.PORTFOLIO - Portfolio Optimization

Solve: maximize returns'w - γ × w'Σw subject to sum(w) = 1, w ≥ 0

```
=CVX.PORTFOLIO(returns_range, covariance_range, risk_aversion)
```

| Parameter | Description |
|-----------|-------------|
| returns | Expected returns vector |
| covariance | Covariance matrix of returns |
| risk_aversion | Risk aversion parameter γ (optional, default: 1) |

## Development

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/SteveDiamond/cvx-excel.git
cd cvx-excel

# Install dependencies
npm install

# Start development server
npm run dev
```

### Sideloading the Add-in

1. Start the development server: `npm run dev`
2. Open Excel (Web or Desktop)
3. Go to Insert > Add-ins > Upload My Add-in
4. Select `manifest.xml` from this project
5. The CVX Excel add-in should appear in the ribbon

### Building for Production

```bash
npm run build
```

## Architecture

```
┌─────────────────────────────────────┐
│         Excel Add-in UI            │
│   (Task Pane + Custom Functions)   │
├─────────────────────────────────────┤
│           cvxjs library             │
│  (Expression system, DCP, Canon)   │
├─────────────────────────────────────┤
│     WASM Solvers                   │
│   (Clarabel for QP/SOCP,           │
│    HiGHS for LP/MIP)               │
└─────────────────────────────────────┘
```

## License

Apache-2.0
