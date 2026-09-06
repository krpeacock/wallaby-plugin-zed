const test = require("node:test");
const assert = require("node:assert");
const { add, subtract, classify } = require("../src/math");

test("add returns the sum of two numbers", () => {
  assert.strictEqual(add(2, 3), 5);
});

test("add handles negative numbers", () => {
  assert.strictEqual(add(-1, 1), 0);
});

// Intentionally wrong expectation so this test FAILS. It exists so the
// MCP verifier can exercise the "failing test" code path.
test("subtract returns the difference", () => {
  assert.strictEqual(subtract(5, 2), 2); // actual result is 3
});

test("classify returns positive/negative/zero", () => {
  assert.strictEqual(classify(10), "positive");
  assert.strictEqual(classify(-3), "negative");
  assert.strictEqual(classify(0), "zero");
});
