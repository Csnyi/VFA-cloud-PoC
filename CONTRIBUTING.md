# Contributing

Thank you for your interest in VFA-cloud-PoC.

This is a research prototype. Contributions that improve the clarity of the
protocol demonstration, fix bugs, or extend the documentation are welcome.

---

## Before you start

- Read the [README](README.md) to understand the scope and goals of this project.
- Check existing issues before opening a new one.
- This project follows the [VFA-Spec](https://github.com/Csnyi/VFA-Spec) protocol definition.
  Implementation changes that diverge from the spec should reference the spec explicitly.

---

## How to contribute

1. Fork the repository and create a feature branch from `main`.
2. Make your changes.
3. Test locally with `docker compose up --build` and verify all three demo modes
   (sandbox, deny, production) still work.
4. Open a pull request with a clear description of what changed and why.

---

## What is in scope

- Bug fixes in any component
- Documentation improvements (README, architecture notes, inline comments)
- Additional demo scenarios that illustrate new protocol paths
- Improvements to the wallet UI or demo dashboard
- Adding missing `.env` examples, Dockerfiles, or CI configuration

---

## What is out of scope

- Production security hardening (this is a PoC — see [SECURITY.md](SECURITY.md))
- Breaking changes to the VFA protocol flow without a corresponding spec update
- Unrelated features or significant scope expansion without prior discussion

---

## Code style

- Python: follow PEP 8; use type hints where they add clarity.
- JavaScript: plain ES2020+; no build step, no bundler.
- Keep functions small and focused.
- Prefer explicit over implicit — this is a demonstration codebase, so clarity
  matters more than brevity.

---

## Commit messages

Use short, descriptive commit messages in the imperative mood:

```
fix: correct session expiry check in policy server
docs: add architecture diagram to README
feat: add reject reason to wallet response payload
```
