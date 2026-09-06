// JavaScript tests that verify the Wallaby MCP server functionality through
// the same stdio/MCP protocol Zed's agent uses.
//
// Requires a running Wallaby instance on the fixture project (tests/mcp).
// Run `npm run verify` in tests/mcp (orchestrates license + Wallaby lifecycle).
//
// Covers one or more call types per tool:
//   - succeeding calls (passing test data, coverage, per-file/per-line queries)
//   - failing calls   (failing test data with stack traces, unknown ids)
//   - protocol errors (tools/call with missing required arguments)

import test from 'node:test';
import assert from 'node:assert';
import { McpClient, locateMcpServer } from './lib/mcp-client.mjs';

const FIXTURE_TEST_FILE = 'test/math.test.js';
const FIXTURE_SOURCE_FILE = 'src/math.js';
const PASSING_TEST_NAME = 'add returns the sum of two numbers';
const FAILING_TEST_NAME = 'subtract returns the difference';
const EXPECTED_TEST_COUNT = 4;

const server = locateMcpServer();
assert.ok(server, 'Wallaby MCP server not found. Run `npm run verify` in tests/mcp, or install Wallaby.');
const client = new McpClient(server);

// The `3_` prefix Wallaby prepends to test ids is per-run state, so we discover
// the ids dynamically from wallaby_allTests instead of hardcoding them.
let allTests = [];
let passingTest = null;
let failingTest = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  await client.start();
  // Readiness: Wallaby may still be starting; poll until it reports the fixture tests.
  const deadline = Date.now() + 60_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const data = JSON.parse((await client.callTool('wallaby_allTests', {})).content[0].text);
      if (Array.isArray(data.tests) && data.tests.length >= EXPECTED_TEST_COUNT) {
        allTests = data.tests;
        failingTest = data.tests.find((t) => t.name.join(' ').includes(FAILING_TEST_NAME));
        passingTest = data.tests.find((t) => t.name.join(' ').includes(PASSING_TEST_NAME));
        return;
      }
      last = `reported ${data.tests?.length ?? 0}/${EXPECTED_TEST_COUNT} tests`;
    } catch (err) {
      last = err.message;
    }
    await sleep(1000);
  }
  throw new Error(
    `Wallaby did not report ${EXPECTED_TEST_COUNT} fixture tests within 60s (${last}). ` +
      'Is Wallaby running on tests/mcp?'
  );
});

test.after(() => client.close());

test('tools/list exposes the Wallaby MCP tools', async () => {
  const names = (await client.toolsList()).tools.map((t) => t.name);
  for (const tool of [
    'wallaby_allTests',
    'wallaby_failingTests',
    'wallaby_testById',
    'wallaby_allTestsForFile',
    'wallaby_failingTestsForFile',
    'wallaby_allTestsForFileAndLine',
    'wallaby_failingTestsForFileAndLine',
    'wallaby_coveredLinesForFile',
    'wallaby_coveredLinesForTest',
    'wallaby_runtimeValues',
  ]) {
    assert.ok(names.includes(tool), `missing tool ${tool}`);
  }
});

test('wallaby_allTests reports passing AND failing tests', () => {
  assert.ok(passingTest, `passing test not found: ${PASSING_TEST_NAME}`);
  assert.ok(failingTest, `failing test not found: ${FAILING_TEST_NAME}`);
  assert.strictEqual(passingTest.status, 'passed');
  assert.strictEqual(failingTest.status, 'failed');
});

test('wallaby_allTests failure data includes a stack trace', () => {
  assert.ok(Array.isArray(failingTest.errors) && failingTest.errors.length > 0, 'failing test has no errors');
  const stack = JSON.stringify(failingTest.errors);
  assert.match(stack, /assert\.strictEqual/);
  assert.match(stack, new RegExp(FIXTURE_TEST_FILE.replace(/\./g, '\\.')));
});

test('wallaby_failingTests returns only failing tests', async () => {
  const data = JSON.parse((await client.callTool('wallaby_failingTests', {})).content[0].text);
  assert.ok(data.tests.length >= 1, 'expected at least one failing test');
  assert.ok(data.tests.every((t) => t.status === 'failed'), 'all returned tests should be failed');
  assert.ok(data.tests.some((t) => t.name.join(' ').includes(FAILING_TEST_NAME)));
});

test('wallaby_testById looks up a test by id (passing and failing)', async () => {
  const passing = JSON.parse(
    (await client.callTool('wallaby_testById', { testId: passingTest.id })).content[0].text
  );
  assert.strictEqual(passing.tests[0].status, 'passed');

  const failing = JSON.parse(
    (await client.callTool('wallaby_testById', { testId: failingTest.id })).content[0].text
  );
  assert.strictEqual(failing.tests[0].status, 'failed');
  assert.ok(failing.tests[0].errors.length > 0, 'failing test looked up by id should carry errors');
});

test('wallaby_testById with an unknown id reports not found', async () => {
  const data = JSON.parse(
    (await client.callTool('wallaby_testById', { testId: '999_does-not-exist' })).content[0].text
  );
  assert.deepStrictEqual(data.tests, []);
  assert.match(data.description, /was not found/);
});

test('wallaby_allTestsForFile returns all tests for the fixture test file', async () => {
  const data = JSON.parse(
    (await client.callTool('wallaby_allTestsForFile', { file: FIXTURE_TEST_FILE })).content[0].text
  );
  const names = data.tests.map((t) => t.name.join(' '));
  assert.strictEqual(data.tests.length, EXPECTED_TEST_COUNT);
  assert.ok(names.includes(PASSING_TEST_NAME));
  assert.ok(names.includes(FAILING_TEST_NAME));
});

test('wallaby_failingTestsForFile returns only failing tests for the file', async () => {
  const data = JSON.parse(
    (await client.callTool('wallaby_failingTestsForFile', { file: FIXTURE_TEST_FILE })).content[0].text
  );
  assert.ok(data.tests.length >= 1);
  assert.ok(data.tests.every((t) => t.status === 'failed'));
  assert.ok(data.tests.some((t) => t.name.join(' ').includes(FAILING_TEST_NAME)));
});

test('wallaby_allTestsForFileAndLine finds the passing test at a source line', async () => {
  const data = JSON.parse(
    (
      await client.callTool('wallaby_allTestsForFileAndLine', {
        file: FIXTURE_TEST_FILE,
        line: 5,
        lineContent: '  assert.strictEqual(add(2, 3), 5);',
      })
    ).content[0].text
  );
  assert.ok(
    data.tests.some((t) => t.status === 'passed' && t.name.join(' ').includes(PASSING_TEST_NAME)),
    'expected the passing test at that line'
  );
});

test('wallaby_failingTestsForFileAndLine finds the failing test at its failing line', async () => {
  const data = JSON.parse(
    (
      await client.callTool('wallaby_failingTestsForFileAndLine', {
        file: FIXTURE_TEST_FILE,
        line: 16,
        lineContent: '  assert.strictEqual(subtract(5, 2), 2); // actual result is 3',
      })
    ).content[0].text
  );
  assert.ok(
    data.tests.some((t) => t.status === 'failed' && t.name.join(' ').includes(FAILING_TEST_NAME)),
    'expected the failing test at that line'
  );
});

test('wallaby_coveredLinesForFile returns coverage for the source file', async () => {
  const data = JSON.parse(
    (await client.callTool('wallaby_coveredLinesForFile', { file: FIXTURE_SOURCE_FILE })).content[0].text
  );
  const entry = data.files.find((f) => f.path === FIXTURE_SOURCE_FILE);
  assert.ok(entry, `no coverage entry for ${FIXTURE_SOURCE_FILE}`);
  assert.ok(typeof entry.coveragePercentage === 'number' && entry.coveragePercentage > 0);
  assert.ok(Object.keys(entry.coverageMap).length > 0, 'coverage map has covered lines');
});

test('wallaby_coveredLinesForTest returns coverage for a specific test', async () => {
  const data = JSON.parse(
    (await client.callTool('wallaby_coveredLinesForTest', { testId: passingTest.id })).content[0].text
  );
  assert.ok(data.files.length >= 1, 'expected covered files for the passing test');
  assert.ok(data.files.some((f) => f.path === FIXTURE_SOURCE_FILE));
});

test('wallaby_runtimeValues returns captured runtime values at a source location', async () => {
  // Runtime value tracing is active on a licensed Wallaby; the values below
  // come from the fixture tests that execute `return a + b;` in src/math.js.
  const data = JSON.parse(
    (
      await client.callTool('wallaby_runtimeValues', {
        file: FIXTURE_SOURCE_FILE,
        line: 2,
        lineContent: '  return a + b;',
        expression: 'a + b',
      })
    ).content[0].text
  );
  assert.ok(Array.isArray(data.values) && data.values.length >= 2, 'expected captured values');
  const captured = data.values.map((v) => v.value);
  assert.ok(captured.includes('5'), 'expected add(2, 3) === 5 to be captured');
  assert.ok(captured.includes('0'), 'expected add(-1, 1) === 0 to be captured');
  assert.ok(data.values.every((v) => v.fromTest), 'each value should cite the test it came from');
});

test('wallaby_runtimeValuesByTest scopes runtime values to a specific test', async () => {
  const data = JSON.parse(
    (
      await client.callTool('wallaby_runtimeValuesByTest', {
        file: FIXTURE_SOURCE_FILE,
        line: 2,
        lineContent: '  return a + b;',
        expression: 'a + b',
        testId: passingTest.id,
      })
    ).content[0].text
  );
  assert.ok(Array.isArray(data.values) && data.values.length >= 1);
  assert.ok(data.values.includes('5'), 'expected add(2, 3) === 5 from the passing test');
});

test('tools/call with missing required arguments returns a protocol error', async () => {
  // wallaby_testById requires testId; omitting it must surface an MCP error.
  await assert.rejects(client.callTool('wallaby_testById', {}), /Invalid arguments/);
});