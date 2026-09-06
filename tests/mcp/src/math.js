// Simple module under test for the Wallaby MCP verification fixture.
function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function classify(n) {
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "zero";
}

module.exports = { add, subtract, classify };
