// Wallaby configuration for the MCP verification fixture.
// node:test is auto-detected; these globs just scope what Wallaby watches.
module.exports = {
  files: ["src/**/*.js"],
  tests: ["test/**/*.test.js"],
  env: { type: "node" },
};
