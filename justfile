default:
  @just --list

typecheck:
  pnpm exec tsc --noEmit

test:
  pnpm exec vitest run
