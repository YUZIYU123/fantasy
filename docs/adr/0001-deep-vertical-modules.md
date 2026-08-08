---
status: proposed
---

# Deep vertical modules behind existing adapters

The codebase will concentrate creation, asset, reading-session, and account behavior into four vertical deep modules, migrating one at a time while existing HTTP and React modules become adapters. Modules live with their dominant dependency—D1-backed lifecycles under `db/`, in-process reading behavior under `lib/`—because clusters of horizontal helpers or repository modules would widen interfaces and create pass-through modules; a port is introduced only where production and test adapters make the seam real.

This preserves current behavior during extraction, increases locality for business rules, and makes each module interface the test surface. Each phase replaces its prior implementation and redundant tests before the next phase begins, avoiding long-lived dual paths.
