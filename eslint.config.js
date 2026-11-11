// eslint.config.js — the code-style check run on every pull request.
//
// The tool is written as plain ES5 scripts that run unbuilt in the browser
// and, for the logic files, in Node too (the tests load the same files). The
// parser is set to ES5 for them on purpose: syntax a browser would need a
// build step for is an error here, not a surprise in production.
//
// Run: npm run lint

'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'test/fixtures/**'] },
  js.configs.recommended,
  {
    rules: {
      // An unused catch (e) and an unused callback argument are the project's
      // idiom ("no localStorage: carry on"); an unused variable or function is not.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      // Regular expressions here escape "/" and "-" inside character classes.
      // It is harmless and deliberate, so it is not flagged.
      'no-useless-escape': 'off'
    }
  },

  // The tool: browser scripts, most of them also loaded by Node in the tests.
  {
    files: ['*.js'],
    ignores: ['eslint.config.js', 'serve.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      globals: Object.assign({}, globals.browser, { module: 'writable', require: 'readonly', define: 'readonly', Promise: 'readonly', Uint8Array: 'readonly' })
    }
  },

  // The backend, the dev server and the unit tests: Node, same ES5 style.
  {
    files: ['backend/**/*.js', 'serve.js', 'test/*.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'commonjs',
      globals: Object.assign({}, globals.node, { Promise: 'readonly', URL: 'readonly', Uint8Array: 'readonly' })
    }
  },

  // Tooling that only ever runs in Node: modern syntax is fine. The browser
  // tests also carry functions that run inside the page.
  {
    files: ['eslint.config.js', 'scripts/**/*.js', 'test/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: Object.assign({}, globals.node, globals.browser)
    }
  }
];
