# Rules for this project

## Always install shared dependencies at the root

This project is a pnpm monorepo with two packages:
- tutorial-agent
- tutorial-step-executor

Whenever you want to install a new dependency in a package, double-check that it's not also used in the other package. If it is, install the package in the project root from where it can be access by both. Then, remove the installation of that depencendy in the package where it was already used (by deleting it from that package's `package.json`). Then `pnpm run clean` from the project root.