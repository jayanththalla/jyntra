// SQL assessment problems. Expected output is NEVER hand-typed: it is produced by running `solution` against each dataset in the same
// sandbox the candidate's query runs in, so the two cannot disagree about NULLs, ties or ordering.
// Hidden datasets exist so a query that hard-codes the example output (or ignores ties / empty groups / NULLs) fails.
import { runSelect, type SqlRun, type SqlValue } from "./sql-sandbox";

export const SQL_TOPICS = ["select_filter", "joins", "group_having", "aggregates", "subqueries", "cte", "window_functions", "nth_highest", "duplicates", "department_analysis"] as const;
export type SqlTopic = (typeof SQL_TOPICS)[number];

const DDL = `CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, salary INTEGER NOT NULL, department_id INTEGER REFERENCES departments(id), email TEXT);`;
export const SCHEMA_TEXT = DDL;

type Emp = [id: number, name: string, salary: number, dept: number | null, email: string | null];
const q = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
const build = (depts: [number, string][], emps: Emp[]) =>
  `${DDL}\n${depts.map((d) => `INSERT INTO departments VALUES (${d[0]}, ${q(d[1])});`).join("\n")}\n${emps.map((e) => `INSERT INTO employees VALUES (${e.map(q).join(", ")});`).join("\n")}`;

const D_BASE: [number, string][] = [[1, "Engineering"], [2, "Sales"], [3, "HR"]];
const EMPS_EXAMPLE: Emp[] = [
  [1, "Asha", 90000, 1, "asha@x.com"], [2, "Ben", 80000, 1, "ben@x.com"], [3, "Chitra", 80000, 1, "chitra@x.com"], [4, "Dev", 60000, 2, "dev@x.com"],
  [5, "Esha", 55000, 2, "esha@x.com"], [6, "Farid", 40000, 3, "farid@x.com"], [7, "Gita", 60000, 2, "ben@x.com"], [8, "Hari", 95000, 1, "hari@x.com"],
];
// Hidden: one employee only (nth-highest must be NULL), an empty department, an employee with no department, duplicated e-mail in 3 rows.
const EMPS_EDGE: Emp[] = [[1, "Ila", 70000, 1, "ila@x.com"]];
const D_EDGE: [number, string][] = [[1, "Engineering"], [2, "Legal"]];
const EMPS_TIES: Emp[] = [
  [1, "Jai", 50000, 1, "j@x.com"], [2, "Kia", 50000, 1, "j@x.com"], [3, "Lev", 50000, 2, "j@x.com"], [4, "Mina", 30000, 2, "m@x.com"], [5, "Noor", 30000, null, "n@x.com"],
  [6, "Om", 70000, 3, "o@x.com"], [7, "Pia", 20000, 3, null], [8, "Raj", 20000, 3, null],
];

export interface SqlDataset { name: string; visible: boolean; setup: string }
const DATASETS: SqlDataset[] = [
  { name: "Example data", visible: true, setup: build(D_BASE, EMPS_EXAMPLE) },
  { name: "Hidden: single employee, empty department", visible: false, setup: build(D_EDGE, EMPS_EDGE) },
  { name: "Hidden: ties, NULLs and an employee without a department", visible: false, setup: build(D_BASE, EMPS_TIES) },
];

export interface SqlProblem {
  id: string; title: string; topic: SqlTopic; difficulty: "easy" | "medium" | "hard";
  description: string; ordered: boolean;
  /** Reference query: server-only until the candidate has run their own. */
  solution: string; explanation: string; tip: string;
}

export const SQL_PROBLEMS: SqlProblem[] = [
  { id: "sql-filter-high-paid", title: "High earners", topic: "select_filter", difficulty: "easy", ordered: true,
    description: "Return the names of employees who earn more than 60000, highest salary first. Break ties by name A to Z.",
    solution: "SELECT name FROM employees WHERE salary > 60000 ORDER BY salary DESC, name", explanation: "Filter with WHERE before sorting. ORDER BY accepts several keys: salary descending, then name ascending for ties.", tip: "Use `>` not `>=`: exactly 60000 is excluded." },
  { id: "sql-join-dept-name", title: "Employees with their department", topic: "joins", difficulty: "easy", ordered: true,
    description: "Return each employee's name and their department's name, ordered by employee name. Employees without a department are not listed.",
    solution: "SELECT e.name, d.name FROM employees e JOIN departments d ON d.id = e.department_id ORDER BY e.name", explanation: "An INNER JOIN keeps only employees whose department_id matches a department, which also drops employees with a NULL department_id.", tip: "Join on the key (department_id = id). Forgetting the ON condition makes a cross join." },
  { id: "sql-group-having", title: "Well-paid departments", topic: "group_having", difficulty: "medium", ordered: true,
    description: "Return the department name and the average salary rounded to the nearest integer, only for departments whose average salary is above 60000. Order by department name.",
    solution: "SELECT d.name, ROUND(AVG(e.salary)) FROM employees e JOIN departments d ON d.id = e.department_id GROUP BY d.id, d.name HAVING AVG(e.salary) > 60000 ORDER BY d.name", explanation: "WHERE filters rows before grouping; HAVING filters groups after aggregation. Compare the unrounded average, then round for display.", tip: "You cannot use an aggregate such as AVG() inside WHERE; use HAVING." },
  { id: "sql-aggregates", title: "Payroll summary", topic: "aggregates", difficulty: "easy", ordered: false,
    description: "Return one row with three columns: the number of employees, the total of all salaries and the highest salary.",
    solution: "SELECT COUNT(*), SUM(salary), MAX(salary) FROM employees", explanation: "Aggregate functions collapse all rows into one when there is no GROUP BY.", tip: "COUNT(*) counts rows; COUNT(column) skips NULLs." },
  { id: "sql-subquery-above-avg", title: "Above the company average", topic: "subqueries", difficulty: "medium", ordered: true,
    description: "Return the names of employees whose salary is strictly greater than the average salary of all employees, ordered by name.",
    solution: "SELECT name FROM employees WHERE salary > (SELECT AVG(salary) FROM employees) ORDER BY name", explanation: "A scalar subquery computes the company average once; the outer query compares each row with it.", tip: "Compare against the average of ALL employees, not per department." },
  { id: "sql-cte-top-payroll", title: "Highest payroll department", topic: "cte", difficulty: "medium", ordered: false,
    description: "Using a common table expression, return the single department (name and total salary) with the highest total payroll. If departments tie, return the one whose name comes first alphabetically.",
    solution: "WITH t AS (SELECT department_id, SUM(salary) AS s FROM employees WHERE department_id IS NOT NULL GROUP BY department_id) SELECT d.name, t.s FROM t JOIN departments d ON d.id = t.department_id ORDER BY t.s DESC, d.name LIMIT 1", explanation: "The CTE names the per-department totals so the final query can sort and take the top row.", tip: "Decide how ties and employees without a department are handled." },
  { id: "sql-second-highest", title: "Second-highest salary", topic: "nth_highest", difficulty: "medium", ordered: false,
    description: "Return one row with one column: the second-highest DISTINCT salary. If there is no second-highest salary, the single value must be NULL (not zero rows).",
    solution: "SELECT (SELECT DISTINCT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 1) AS second_highest", explanation: "DISTINCT removes ties, OFFSET 1 skips the top salary. Wrapping the query in a scalar subquery turns 'no row' into NULL.", tip: "A plain `SELECT ... LIMIT 1 OFFSET 1` returns zero rows when only one salary exists." },
  { id: "sql-nth-highest", title: "Third-highest salary", topic: "nth_highest", difficulty: "hard", ordered: false,
    description: "Return one row with one column: the third-highest DISTINCT salary, or NULL if fewer than three distinct salaries exist. (Try it with DENSE_RANK or with OFFSET.)",
    solution: "SELECT (SELECT salary FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS r FROM employees) WHERE r = 3 LIMIT 1) AS third_highest", explanation: "DENSE_RANK gives tied salaries the same rank without gaps, so rank 3 is the third distinct salary.", tip: "RANK() leaves gaps after ties, so rank 3 may not exist even when three distinct salaries do." },
  { id: "sql-duplicates", title: "Duplicate e-mails", topic: "duplicates", difficulty: "easy", ordered: true,
    description: "Return each e-mail address that appears on more than one employee, with how many employees share it. Ignore NULL e-mails. Order by e-mail.",
    solution: "SELECT email, COUNT(*) FROM employees WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1 ORDER BY email", explanation: "GROUP BY collects equal e-mails; HAVING COUNT(*) > 1 keeps the repeated ones.", tip: "NULL values group together; exclude them if they are not real duplicates." },
  { id: "sql-row-number-top", title: "Top earner per department", topic: "window_functions", difficulty: "hard", ordered: true,
    description: "For every department that has employees, return the department name, the top earner's name and salary. If two employees tie for the top salary, take the one with the lower id. Order by department name.",
    solution: "SELECT d.name, e.name, e.salary FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC, id) AS rn FROM employees WHERE department_id IS NOT NULL) e JOIN departments d ON d.id = e.department_id WHERE e.rn = 1 ORDER BY d.name", explanation: "ROW_NUMBER numbers rows within each department; taking rn = 1 gives exactly one row per department even with ties.", tip: "RANK() would return both tied employees. ROW_NUMBER with a tie-breaker returns one." },
  { id: "sql-rank-vs-dense", title: "RANK and DENSE_RANK", topic: "window_functions", difficulty: "medium", ordered: true,
    description: "Return name, salary, RANK() and DENSE_RANK() of salary (highest salary = 1) for every employee, ordered by salary descending then name.",
    solution: "SELECT name, salary, RANK() OVER (ORDER BY salary DESC), DENSE_RANK() OVER (ORDER BY salary DESC) FROM employees ORDER BY salary DESC, name", explanation: "After a tie, RANK skips numbers (1,2,2,4) while DENSE_RANK does not (1,2,2,3).", tip: "Both need OVER (ORDER BY salary DESC)." },
  { id: "sql-dept-analysis", title: "Department headcount and top salary", topic: "department_analysis", difficulty: "medium", ordered: true,
    description: "For EVERY department (including departments with no employees) return the department name, the number of employees and the highest salary (0 when there are no employees). Order by department name.",
    solution: "SELECT d.name, COUNT(e.id), COALESCE(MAX(e.salary), 0) FROM departments d LEFT JOIN employees e ON e.department_id = d.id GROUP BY d.id, d.name ORDER BY d.name", explanation: "LEFT JOIN keeps empty departments; COUNT(e.id) counts only matched employees; COALESCE replaces NULL with 0.", tip: "COUNT(*) would count the NULL-extended row as 1." },
];

export function getProblem(id: string): SqlProblem | undefined { return SQL_PROBLEMS.find((p) => p.id === id); }

/** What the browser may see before the candidate has run anything: no solution, no hidden data, no explanation. */
export function publicProblem(p: SqlProblem) {
  const ex = DATASETS[0]!;
  return {
    id: p.id, title: p.title, topic: p.topic, difficulty: p.difficulty, description: p.description, ordered: p.ordered,
    schema: SCHEMA_TEXT, exampleSetup: ex.setup.slice(DDL.length + 1),
    executionMode: "executed_in_sandbox" as const,
    engineNote: "Runs in an isolated in-memory SQLite database (not PostgreSQL). Read-only SELECT queries only; 2.5 second limit.",
    hiddenCases: DATASETS.filter((d) => !d.visible).length,
  };
}

const num = (v: SqlValue) => (typeof v === "number" ? v : v);
const eq = (a: SqlValue, b: SqlValue) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : a === b);
const key = (r: SqlValue[]) => JSON.stringify(r.map((v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)));

export function sameResult(expected: { rows: SqlValue[][] }, actual: { rows: SqlValue[][] }, ordered: boolean): boolean {
  if (expected.rows.length !== actual.rows.length) return false;
  if (ordered) return expected.rows.every((r, i) => r.length === actual.rows[i]!.length && r.every((v, j) => eq(v, actual.rows[i]![j]!)));
  const a = expected.rows.map(key).sort(), b = actual.rows.map(key).sort();
  return a.every((x, i) => x === b[i]);
}

export interface SqlCaseResult {
  name: string; visible: boolean; passed: boolean;
  /** Only for visible cases. Hidden cases never leak their expected rows. */
  expected?: { columns: string[]; rows: SqlValue[][] }; actual?: { columns: string[]; rows: SqlValue[][] } | null;
  problem?: string;
}
export interface SqlGrade {
  engine: "sqlite"; executionMode: "executed_in_sandbox";
  correct: boolean; score: number; passed: number; total: number;
  cases: SqlCaseResult[]; suggestions: string[];
  /** Revealed only after a query has been graded. */
  explanation: string; referenceSolution: string; topicFeedback: string;
  error?: { kind: string; message: string };
}

export async function gradeSql(problem: SqlProblem, sql: string, run: typeof runSelect = runSelect): Promise<SqlGrade> {
  const cases: SqlCaseResult[] = [];
  const suggestions: string[] = [];
  let firstError: SqlGrade["error"];
  for (const ds of DATASETS) {
    const exp = await run(problem.solution, ds.setup);
    if (!exp.ok) throw new Error(`reference solution failed on "${ds.name}": ${exp.message}`); // a bug in OUR problem, never blamed on the candidate
    const act: SqlRun = await run(sql, ds.setup);
    if (!act.ok) {
      firstError ??= { kind: act.kind, message: act.message };
      cases.push({ name: ds.name, visible: ds.visible, passed: false, problem: act.message, ...(ds.visible ? { expected: { columns: exp.columns, rows: exp.rows }, actual: null } : {}) });
      continue;
    }
    const passed = sameResult(exp, act, problem.ordered) && exp.columns.length === act.columns.length;
    const c: SqlCaseResult = { name: ds.name, visible: ds.visible, passed };
    if (ds.visible) { c.expected = { columns: exp.columns, rows: exp.rows }; c.actual = { columns: act.columns, rows: act.rows }; }
    if (!passed) {
      c.problem = exp.columns.length !== act.columns.length ? `Expected ${exp.columns.length} column(s) but got ${act.columns.length}.`
        : exp.rows.length !== act.rows.length ? `Expected ${exp.rows.length} row(s) but got ${act.rows.length}.`
        : problem.ordered && sameResult(exp, act, false) ? "The right rows came back in the wrong order." : "Some values differ from the expected result.";
    }
    cases.push(c);
  }
  const passedN = cases.filter((c) => c.passed).length;
  const visibleOk = cases.filter((c) => c.visible).every((c) => c.passed);
  const hiddenFail = cases.some((c) => !c.visible && !c.passed);
  if (firstError?.kind === "rejected") suggestions.push(firstError.message);
  else if (firstError) suggestions.push(`Fix the error first: ${firstError.message}`);
  if (visibleOk && hiddenFail) suggestions.push("Your query is right on the example data but fails on hidden data. Check NULL values, ties, empty groups and employees without a department. " + problem.tip);
  else if (!visibleOk && !firstError) suggestions.push(problem.tip);
  const correct = passedN === cases.length;
  return {
    engine: "sqlite", executionMode: "executed_in_sandbox", correct, score: Math.round((passedN / cases.length) * 100), passed: passedN, total: cases.length, cases, suggestions,
    explanation: problem.explanation, referenceSolution: problem.solution, topicFeedback: `Topic: ${problem.topic.replace(/_/g, " ")}. ${problem.tip}`,
    ...(firstError ? { error: firstError } : {}),
  };
}
