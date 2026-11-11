import assert from "node:assert/strict";
import { coachDraft } from "@/components/outreach/DraftCoach";

const good = "Hi Asha, I came across Acme Pay and found your UPI checkout work interesting. I build APIs with FastAPI and Redis, and cut response time from 800ms to 200ms on my last project. Here is my work: https://github.com/asha/shop. Are you open to bringing on a backend developer?";
const c = coachDraft(good, "Acme Pay", ["FastAPI", "React"]);
assert.equal(c.context, true); assert.equal(c.relevance, true); assert.equal(c.proof, true); assert.equal(c.ask, true);
assert.ok(c.words > 30 && c.words < 80);

const bad = coachDraft("Hello sir, I am looking for an opportunity at your esteemed organization. Please find my resume attached. Kindly let me know.", "Acme Pay", ["FastAPI"]);
assert.deepEqual([bad.context, bad.relevance, bad.proof, bad.ask], [false, false, false, false]);

// a skill must match as a whole word: "Go" is not found inside "good"
assert.equal(coachDraft("This is a good message?", "X", ["Go"]).relevance, false);
assert.equal(coachDraft("I write Go services", "X", ["Go"]).relevance, true);
// special characters in skills must not break the matcher
assert.doesNotThrow(() => coachDraft("I use C++ and .NET", "X", ["C++", ".NET", "(("]));
assert.equal(coachDraft("", "X", []).words, 0);
console.log("coach checks: 8 passed");
