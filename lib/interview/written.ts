// Written interview tests: single choice, multiple select, true/false, short explanation.
//  - The bank below is hand-written and reviewed (source "bank"). AI-generated questions are accepted only if they pass
//    validateGeneratedQuestion() (source "ai"); if generation fails the caller gets an error, never an invented question.
//  - publicQuestion() is the ONLY shape sent to the browser before submission: it carries no answer and no explanation.
//  - Short-explanation answers are graded by concept coverage (keyword groups). That is a coverage check, not proof of
//    understanding, and the result says so.
import { createHash } from "node:crypto";

export const WRITTEN_CATEGORIES = ["DSA", "DBMS", "OOP", "Operating systems", "Computer networks", "Java", "Python", "JavaScript", "SQL", "System design", "AI/ML"] as const;
export type WrittenCategory = (typeof WRITTEN_CATEGORIES)[number];
export type WrittenKind = "single" | "multi" | "true_false" | "short";
export type Difficulty = "easy" | "medium" | "hard";

export interface Option { id: string; text: string }
export interface WrittenQuestion {
  id: string; category: WrittenCategory; kind: WrittenKind; difficulty: Difficulty; source: "bank" | "ai";
  prompt: string; options?: Option[];
  /** option ids for single/multi; ["true"] or ["false"] for true_false */
  correct?: string[];
  /** short: each group is one concept; any synonym in a group counts as covering it */
  concepts?: { name: string; anyOf: string[] }[];
  explanation: string; timeSeconds: number;
}

const tf = (): Option[] => [{ id: "true", text: "True" }, { id: "false", text: "False" }];
const o = (...t: string[]): Option[] => t.map((text, i) => ({ id: "abcdef"[i]!, text }));
const T = { easy: 45, medium: 75, hard: 120, short: 180 };

type Seed = Omit<WrittenQuestion, "source" | "timeSeconds"> & { timeSeconds?: number };
const seeds: Seed[] = [
  // DSA
  { id: "dsa-1", category: "DSA", kind: "single", difficulty: "easy", prompt: "What is the average time complexity of binary search on a sorted array of n elements?", options: o("O(n)", "O(log n)", "O(n log n)", "O(1)"), correct: ["b"], explanation: "Each comparison halves the remaining range, so about log2(n) steps are needed." },
  { id: "dsa-2", category: "DSA", kind: "multi", difficulty: "medium", prompt: "Which of these data structures can be used to implement a queue efficiently (O(1) enqueue and dequeue)?", options: o("Singly linked list with head and tail pointers", "Circular array", "Array where dequeue shifts every element", "Binary search tree"), correct: ["a", "b"], explanation: "A linked list with tail pointer and a circular buffer both give O(1) at both ends. Shifting elements costs O(n) per dequeue, and a BST is not a FIFO structure." },
  { id: "dsa-3", category: "DSA", kind: "true_false", difficulty: "medium", prompt: "Dijkstra's algorithm gives correct shortest paths on graphs that contain negative edge weights.", options: tf(), correct: ["false"], explanation: "Dijkstra assumes that once a node is finalised no shorter path exists, which negative edges break. Use Bellman-Ford for negative weights." },
  { id: "dsa-4", category: "DSA", kind: "short", difficulty: "medium", prompt: "Explain how a hash table handles collisions. Name at least one strategy.", concepts: [{ name: "collision means same bucket", anyOf: ["same index", "same bucket", "same slot", "two keys"] }, { name: "chaining or open addressing", anyOf: ["chaining", "linked list", "open addressing", "linear probing", "probing", "double hashing"] }], explanation: "Collisions happen when two keys map to one bucket. Chaining stores colliding entries in a list per bucket; open addressing probes for another free slot.", timeSeconds: T.short },
  // DBMS
  { id: "dbms-1", category: "DBMS", kind: "single", difficulty: "easy", prompt: "Which ACID property guarantees that a committed transaction survives a crash?", options: o("Atomicity", "Consistency", "Isolation", "Durability"), correct: ["d"], explanation: "Durability means committed changes are persisted (for example through a write-ahead log)." },
  { id: "dbms-2", category: "DBMS", kind: "single", difficulty: "medium", prompt: "A table is in 3NF but not BCNF. Which situation causes that?", options: o("A non-key attribute depends on part of the key", "A determinant of a functional dependency is not a candidate key", "The table has no primary key", "The table has NULL values"), correct: ["b"], explanation: "BCNF requires every determinant to be a superkey. 3NF still allows a dependency whose determinant is not a candidate key when the dependent attribute is part of a key." },
  { id: "dbms-3", category: "DBMS", kind: "multi", difficulty: "medium", prompt: "Which isolation anomalies can still occur under READ COMMITTED in the SQL standard?", options: o("Dirty read", "Non-repeatable read", "Phantom read", "Lost durability"), correct: ["b", "c"], explanation: "READ COMMITTED prevents dirty reads but allows non-repeatable reads and phantoms. Durability is not an isolation anomaly." },
  // OOP
  { id: "oop-1", category: "OOP", kind: "single", difficulty: "easy", prompt: "Which principle lets a subclass object be used wherever its superclass is expected?", options: o("Encapsulation", "Polymorphism (Liskov substitution)", "Abstraction", "Cohesion"), correct: ["b"], explanation: "Substitutability lets code written against the base type work with any subtype." },
  { id: "oop-2", category: "OOP", kind: "true_false", difficulty: "easy", prompt: "Method overloading is resolved at compile time in Java, while overriding is resolved at run time.", options: tf(), correct: ["true"], explanation: "Overloads are chosen from the static argument types; overridden methods are dispatched on the object's runtime class." },
  { id: "oop-3", category: "OOP", kind: "short", difficulty: "medium", prompt: "When would you prefer composition over inheritance?", concepts: [{ name: "has-a vs is-a", anyOf: ["has-a", "has a", "is-a", "is a"] }, { name: "flexibility / coupling", anyOf: ["coupling", "flexib", "change at runtime", "tight", "loosely", "fragile base"] }], explanation: "Prefer composition when the relationship is 'has-a', when you want to swap behaviour at runtime, or to avoid the tight coupling and fragile-base-class problem of inheritance.", timeSeconds: T.short },
  // OS
  { id: "os-1", category: "Operating systems", kind: "single", difficulty: "easy", prompt: "Which condition is NOT required for a deadlock?", options: o("Mutual exclusion", "Hold and wait", "Preemption of resources", "Circular wait"), correct: ["c"], explanation: "The four Coffman conditions are mutual exclusion, hold and wait, NO preemption, and circular wait. Preemption would break a deadlock." },
  { id: "os-2", category: "Operating systems", kind: "multi", difficulty: "medium", prompt: "Which of the following are shared between threads of the same process?", options: o("Heap memory", "Open file descriptors", "Stack", "Program counter"), correct: ["a", "b"], explanation: "Threads share the heap and file descriptors. Each thread has its own stack and program counter." },
  { id: "os-3", category: "Operating systems", kind: "true_false", difficulty: "medium", prompt: "A page fault always means the program has crashed.", options: tf(), correct: ["false"], explanation: "A page fault is a normal event: the OS loads the missing page from disk. Only an invalid access causes a crash (segmentation fault)." },
  // Networks
  { id: "net-1", category: "Computer networks", kind: "single", difficulty: "easy", prompt: "Which protocol provides reliable, ordered delivery of a byte stream?", options: o("UDP", "TCP", "ICMP", "ARP"), correct: ["b"], explanation: "TCP uses sequence numbers, acknowledgements and retransmission to deliver data reliably and in order." },
  { id: "net-2", category: "Computer networks", kind: "single", difficulty: "medium", prompt: "What does an HTTP 301 status code indicate?", options: o("Temporary redirect", "Permanent redirect", "Not modified", "Unauthorised"), correct: ["b"], explanation: "301 Moved Permanently. 302/307 are temporary redirects, 304 is Not Modified and 401 is Unauthorised." },
  { id: "net-3", category: "Computer networks", kind: "short", difficulty: "medium", prompt: "Briefly describe what happens when you type a URL in the browser, up to receiving the HTML.", concepts: [{ name: "DNS lookup", anyOf: ["dns", "domain name"] }, { name: "TCP/TLS connection", anyOf: ["tcp", "handshake", "tls", "https"] }, { name: "HTTP request and response", anyOf: ["http request", "get request", "request", "response"] }], explanation: "The browser resolves the name via DNS, opens a TCP (and TLS) connection to the server, sends an HTTP request and receives the HTML response.", timeSeconds: T.short },
  // Java
  { id: "java-1", category: "Java", kind: "single", difficulty: "easy", prompt: "Which collection does NOT allow duplicate elements?", options: o("ArrayList", "LinkedList", "HashSet", "Vector"), correct: ["c"], explanation: "A Set holds unique elements. List implementations such as ArrayList, LinkedList and Vector allow duplicates." },
  { id: "java-2", category: "Java", kind: "true_false", difficulty: "medium", prompt: "In Java, == on two String objects always compares their character content.", options: tf(), correct: ["false"], explanation: "== compares references. Use equals() to compare content (string literals may share an instance, which can hide the bug)." },
  { id: "java-3", category: "Java", kind: "single", difficulty: "medium", prompt: "What does the 'final' keyword on a class mean?", options: o("It cannot be instantiated", "It cannot be subclassed", "It has only static methods", "It is thread-safe"), correct: ["b"], explanation: "A final class cannot be extended. (String is a well-known example.)" },
  // Python
  { id: "py-1", category: "Python", kind: "single", difficulty: "easy", prompt: "Which of these is an immutable type in Python?", options: o("list", "dict", "set", "tuple"), correct: ["d"], explanation: "Tuples cannot be changed after creation; lists, dicts and sets can." },
  { id: "py-2", category: "Python", kind: "true_false", difficulty: "medium", prompt: "Using a mutable default argument such as def f(x, items=[]) creates a new list on every call.", options: tf(), correct: ["false"], explanation: "The default is created once, when the function is defined, so every call that omits the argument shares the same list." },
  { id: "py-3", category: "Python", kind: "multi", difficulty: "medium", prompt: "Which statements about Python's GIL (CPython) are true?", options: o("Only one thread executes Python bytecode at a time", "It makes multiprocessing useless", "CPU-bound threads do not run in parallel", "I/O-bound threads can still benefit from threading"), correct: ["a", "c", "d"], explanation: "The GIL serialises bytecode execution, so CPU-bound threads do not run in parallel, but threads waiting on I/O release it. Multiprocessing sidesteps the GIL, so it is useful." },
  // JavaScript
  { id: "js-1", category: "JavaScript", kind: "single", difficulty: "easy", prompt: "What does typeof null return in JavaScript?", options: o("\"null\"", "\"undefined\"", "\"object\"", "\"number\""), correct: ["c"], explanation: "It is a long-standing quirk: typeof null is \"object\"." },
  { id: "js-2", category: "JavaScript", kind: "single", difficulty: "medium", prompt: "What is logged? console.log(0.1 + 0.2 === 0.3)", options: o("true", "false", "undefined", "It throws"), correct: ["b"], explanation: "0.1 + 0.2 is 0.30000000000000004 in binary floating point, so the comparison is false." },
  { id: "js-3", category: "JavaScript", kind: "short", difficulty: "medium", prompt: "Explain what a closure is and give one use.", concepts: [{ name: "function remembers outer scope", anyOf: ["outer", "enclosing", "lexical", "scope", "remember"] }, { name: "example use", anyOf: ["private", "counter", "callback", "encapsulat", "factory", "memoiz", "partial", "curry"] }], explanation: "A closure is a function together with the variables of the scope where it was created. It enables private state, counters, callbacks and function factories.", timeSeconds: T.short },
  // SQL concepts
  { id: "sqlc-1", category: "SQL", kind: "single", difficulty: "easy", prompt: "Which clause filters groups after aggregation?", options: o("WHERE", "HAVING", "GROUP BY", "ORDER BY"), correct: ["b"], explanation: "WHERE filters rows before grouping; HAVING filters groups after." },
  { id: "sqlc-2", category: "SQL", kind: "true_false", difficulty: "medium", prompt: "COUNT(column_name) counts rows where that column is NULL.", options: tf(), correct: ["false"], explanation: "COUNT(column) ignores NULLs; COUNT(*) counts all rows." },
  { id: "sqlc-3", category: "SQL", kind: "single", difficulty: "medium", prompt: "Which join returns all rows from the left table even when there is no match on the right?", options: o("INNER JOIN", "LEFT JOIN", "CROSS JOIN", "SELF JOIN only"), correct: ["b"], explanation: "A LEFT JOIN keeps every left row and fills right columns with NULL where there is no match." },
  // System design
  { id: "sd-1", category: "System design", kind: "single", difficulty: "medium", prompt: "Which is the main purpose of a cache in front of a database?", options: o("Guarantee strong consistency", "Reduce read latency and database load", "Replace backups", "Encrypt data at rest"), correct: ["b"], explanation: "Caches serve frequent reads from fast memory. They add staleness risk rather than guarantee consistency." },
  { id: "sd-2", category: "System design", kind: "multi", difficulty: "hard", prompt: "Which techniques help a service stay available when one of its dependencies is slow or failing?", options: o("Timeouts", "Circuit breaker", "Retries with exponential backoff and jitter", "Unbounded retries with no delay"), correct: ["a", "b", "c"], explanation: "Timeouts, circuit breakers and backed-off retries contain failures. Unbounded immediate retries can overload the dependency and make things worse." },
  { id: "sd-3", category: "System design", kind: "short", difficulty: "hard", prompt: "Why might you shard a database, and what is one downside?", concepts: [{ name: "scale / capacity", anyOf: ["scale", "capacity", "throughput", "too large", "single node", "horizontal"] }, { name: "downside", anyOf: ["cross-shard", "join", "rebalanc", "hot", "complex", "transaction", "resharding"] }], explanation: "Sharding splits data across nodes to scale writes and storage. Downsides include cross-shard queries and transactions, rebalancing, and hot shards.", timeSeconds: T.short },
  // AI/ML
  { id: "ml-1", category: "AI/ML", kind: "single", difficulty: "easy", prompt: "A model scores 99% on training data but 70% on unseen data. What is the most likely problem?", options: o("Underfitting", "Overfitting", "Data leakage from the test set", "Too many classes"), correct: ["b"], explanation: "A large gap between training and unseen performance is the classic sign of overfitting." },
  { id: "ml-2", category: "AI/ML", kind: "multi", difficulty: "medium", prompt: "Which of these help reduce overfitting?", options: o("Regularisation", "More training data", "Early stopping", "Training much longer with a bigger model and no validation"), correct: ["a", "b", "c"], explanation: "Regularisation, more data and early stopping all reduce overfitting. A bigger model trained longer without validation usually worsens it." },
  { id: "ml-3", category: "AI/ML", kind: "true_false", difficulty: "medium", prompt: "Accuracy is a reliable metric for a classification problem where 99% of the examples belong to one class.", options: tf(), correct: ["false"], explanation: "A model that always predicts the majority class gets 99% accuracy while learning nothing. Use precision, recall, F1 or PR-AUC." },
];

export const QUESTION_BANK: WrittenQuestion[] = seeds.map((s) => ({ ...s, source: "bank" as const, timeSeconds: s.timeSeconds ?? T[s.difficulty] }));

export function publicQuestion(q: WrittenQuestion) {
  return { id: q.id, category: q.category, kind: q.kind, difficulty: q.difficulty, source: q.source, prompt: q.prompt, options: q.options, timeSeconds: q.timeSeconds, multiple: q.kind === "multi" };
}

export type WrittenResponse = { choice?: string[]; text?: string };
export interface GradeResult {
  questionId: string; category: WrittenCategory; kind: WrittenKind; source: "bank" | "ai"; difficulty: Difficulty;
  correct: boolean; score: number; correctAnswer?: string[]; explanation: string;
  covered?: string[]; missed?: string[]; note?: string; timedOut?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'/-]+/g, " ").replace(/\s+/g, " ").trim();

export function gradeWritten(q: WrittenQuestion, r: WrittenResponse, opts: { timedOut?: boolean } = {}): GradeResult {
  const base = { questionId: q.id, category: q.category, kind: q.kind, source: q.source, difficulty: q.difficulty, explanation: q.explanation, timedOut: opts.timedOut };
  if (q.kind === "short") {
    const text = norm(r.text ?? "");
    const concepts = q.concepts ?? [];
    const words = text.split(" ").filter(Boolean).length;
    const covered = concepts.filter((c) => c.anyOf.some((k) => text.includes(norm(k)))).map((c) => c.name);
    const missed = concepts.filter((c) => !covered.includes(c.name)).map((c) => c.name);
    // A one-word or keyword-stuffed answer cannot earn full credit.
    const raw = concepts.length ? Math.round((covered.length / concepts.length) * 100) : 0;
    const score = words < 8 ? Math.min(raw, 40) : raw;
    return { ...base, correct: score >= 75, score, covered, missed, correctAnswer: undefined, note: "Graded by checking which key ideas your answer mentions. This is a coverage check, not a full judgement of understanding." };
  }
  const chosen = [...new Set((r.choice ?? []).map(String))].sort();
  const right = [...(q.correct ?? [])].sort();
  const valid = new Set((q.options ?? []).map((x) => x.id));
  if (chosen.some((c) => !valid.has(c))) return { ...base, correct: false, score: 0, correctAnswer: right, note: "The response contained an option that does not exist." };
  const hits = chosen.filter((c) => right.includes(c)).length, wrong = chosen.length - hits;
  const exact = chosen.length === right.length && hits === right.length;
  // Multi-select earns partial credit; a wrong pick cancels a right one. Single choice and true/false are all-or-nothing.
  const score = exact ? 100 : q.kind === "multi" ? Math.max(0, Math.round(((hits - wrong) / right.length) * 100)) : 0;
  return { ...base, correct: exact, score, correctAnswer: right };
}

export interface TopicPerformance { category: WrittenCategory; answered: number; correct: number; averageScore: number }
export function topicPerformance(results: GradeResult[]): TopicPerformance[] {
  const m = new Map<WrittenCategory, GradeResult[]>();
  for (const r of results) m.set(r.category, [...(m.get(r.category) ?? []), r]);
  return [...m.entries()].map(([category, rs]) => ({ category, answered: rs.length, correct: rs.filter((x) => x.correct).length, averageScore: Math.round(rs.reduce((s, x) => s + x.score, 0) / rs.length) })).sort((a, b) => a.averageScore - b.averageScore);
}
export function writtenSummary(results: GradeResult[]) {
  return { answered: results.length, correct: results.filter((r) => r.correct).length, score: results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : null, topics: topicPerformance(results) };
}

export function pickQuestions(opts: { categories?: WrittenCategory[]; count: number; difficulty?: Difficulty; exclude?: string[]; rnd?: () => number }): WrittenQuestion[] {
  const rnd = opts.rnd ?? Math.random;
  let pool = QUESTION_BANK.filter((q) => (!opts.categories?.length || opts.categories.includes(q.category)) && (!opts.difficulty || q.difficulty === opts.difficulty) && !opts.exclude?.includes(q.id));
  pool = pool.map((q) => [rnd(), q] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return pool.slice(0, Math.max(0, opts.count));
}

export class GeneratedQuestionError extends Error { constructor(m: string) { super(m); this.name = "GeneratedQuestionError"; } }

/** AI-generated questions must pass a strict schema, or they are rejected. The caller then reports failure; nothing is fabricated. */
export function validateGeneratedQuestion(raw: unknown, ctx: { category: WrittenCategory; difficulty: Difficulty }): WrittenQuestion {
  const j = raw as any;
  const fail = (m: string): never => { throw new GeneratedQuestionError(m); };
  if (!j || typeof j !== "object") fail("not an object");
  const kind = j.kind as WrittenKind;
  if (!["single", "multi", "true_false"].includes(kind)) fail("unsupported kind");
  const prompt = typeof j.prompt === "string" ? j.prompt.trim() : "";
  const explanation = typeof j.explanation === "string" ? j.explanation.trim() : "";
  if (prompt.length < 15 || prompt.length > 500) fail("prompt length");
  if (explanation.length < 20 || explanation.length > 800) fail("explanation missing or too short");
  let options: Option[];
  if (kind === "true_false") options = tf();
  else {
    if (!Array.isArray(j.options) || j.options.length < 3 || j.options.length > 6) fail("option count");
    options = j.options.map((x: any, i: number) => ({ id: "abcdef"[i]!, text: typeof (x?.text ?? x) === "string" ? String(x?.text ?? x).trim() : "" }));
    if (options.some((x) => !x.text || x.text.length > 200)) fail("empty or long option");
    if (new Set(options.map((x) => norm(x.text))).size !== options.length) fail("duplicate options");
  }
  const correct = (Array.isArray(j.correct) ? j.correct : [j.correct]).map(String);
  const ids = new Set(options.map((x) => x.id));
  if (!correct.length || correct.some((c: string) => !ids.has(c)) || new Set(correct).size !== correct.length) fail("correct answer does not match options");
  if (kind !== "multi" && correct.length !== 1) fail("exactly one correct answer required");
  if (kind === "multi" && (correct.length < 2 || correct.length >= options.length)) fail("multi needs 2+ correct and at least one wrong option");
  const nrm = norm(prompt);
  if (QUESTION_BANK.some((b) => norm(b.prompt) === nrm)) fail("duplicates a bank question");
  const id = "ai:" + createHash("sha256").update(nrm + JSON.stringify(options) + correct.join(",")).digest("hex").slice(0, 16);
  return { id, category: ctx.category, kind, difficulty: ctx.difficulty, source: "ai", prompt, options, correct, explanation, timeSeconds: T[ctx.difficulty] };
}

export function buildGenerationPrompt(category: WrittenCategory, difficulty: Difficulty, kind: "single" | "multi" | "true_false", avoid: string[] = []): string {
  return `Write ONE ${difficulty} ${kind === "multi" ? "multiple-select" : kind === "true_false" ? "true/false" : "single-choice"} interview question about ${category} for a software candidate.
It must be factually unambiguous. Include a short explanation of why the answer is correct. Do not repeat these questions: ${avoid.slice(0, 5).map((a) => `"${a.slice(0, 80)}"`).join("; ") || "none"}.
Return ONLY JSON: {"kind":"${kind}","prompt":"...","options":["...","...","...","..."],"correct":["a"],"explanation":"..."}
Options are labelled a,b,c,d in order; "correct" lists the option letters${kind === "true_false" ? ' ("true" or "false"; omit options)' : ""}.`;
}
