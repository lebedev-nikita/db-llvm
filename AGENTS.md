# Rules for AI agents

## Project Context

Read `CONTEXT.md` before making architectural or product-direction changes.
It describes the project goal, core pipeline, MVP scope, safety model, and
current implementation direction.

## Dev Scripts

Use justfile for writing dev scripts, especially if they depend on each other (instead of package.json:scripts)

## Recommended npm libraries

- dedent-js - for multiline strings
- vitest - for testing

## Backwards compatibility

This project is in research stage, so there is no need to care about backwards compatibility
