# Contributing

## Pre-commit hooks

This repo uses [lefthook](https://github.com/evilmartians/lefthook) for pre-commit
gates. After `pnpm install`, the hooks are installed automatically via the
root `prepare` script (`lefthook install`).

What runs on `git commit`:

- **`lint-staged`** — `eslint` on staged `.ts`/`.tsx` files (parallel).
- **`gitleaks`** — scans staged changes for secrets. Silent skip if the
  `gitleaks` binary is not installed locally; CI enforces secret scanning via
  trufflehog (`.github/workflows/ci.yml`). Install instructions:
  <https://github.com/gitleaks/gitleaks>.

What runs on `git commit -m "..."`:

- **`lint-commit-message`** — rejects non-[conventional-commits] messages.
  Allowed prefixes: `feat|fix|docs|test|chore|refactor|ci|build|perf` (with
  optional `(scope)` and `!` for breaking changes).

What runs on `git push`:

- **`test-unit`** — full `pnpm run test:unit` across the workspace.

### Emergency bypass

`git commit --no-verify` skips all pre-commit and commit-msg hooks. Use only
when a hook is itself broken and you need to land a fix; CI will still enforce
the same gates.

### Installing gitleaks locally

```bash
# macOS
brew install gitleaks

# Linux (binary release)
curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/master/install.sh | sh

# Docker-based
docker pull zricethezav/gitleaks:latest
```

[conventional-commits]: https://www.conventionalcommits.org/
