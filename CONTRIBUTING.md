# Contributing to Kumix Worker

Thank you for your interest in contributing to the Kumix Worker repository. It contains the worker runtime, HTTP API, SQLite state, FFmpeg services, React dashboard, tests, and release workflows.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to `hai@kumix.io`.

## Why Contribute?

This package is community-driven. Your contributions help:

- Improve developer experience and documentation
- Fix issues and enhance reliability
- Extend tooling and workflow capabilities

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.3.0 or higher
- Node.js 24 or higher
- Git

### Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/kumixlabs/worker.git
   cd worker
   ```
3. Install dependencies:
   ```bash
   bun install
   bun install --cwd frontend
   ```
4. Create a new branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running the Project

```bash
# Run the backend and Vite dashboard in development mode
bun run dev

# Build the backend and dashboard
bun run build

# Type-check all workspaces
bun run types:check

# Lint (check)
bun run lint

# Lint (auto-fix)
bun run lint:fix

# Format code
bun run format
```

### Working on the Frontend

```bash
cd frontend
bun run dev
bun run build
bun run types:check
```

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting to ensure consistent code quality.

### Code Standards

- **Indentation**: 2 spaces
- **Line Width**: Follow the repository Biome configuration
- **Quotes**: Double quotes for JavaScript/TypeScript
- **Semicolons**: Always required
- **Trailing Commas**: All
- **Arrow Parentheses**: Always

### Lint and Format

Before committing, always run:

```bash
# Lint (check)
bun run lint

# Lint (auto-fix)
bun run lint:fix

# Format files
bun run format

# Check formatting without writing
bun run format:check
```

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-new-capability` - For new features
- `fix/build-script-bug` - For bug fixes
- `docs/update-readme` - For documentation
- `refactor/simplify-structure` - For refactoring

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(ui): add component
fix(ci): correct bun run command in workflow
docs(readme): clarify release process
refactor(workspace): simplify outputs in turbo.json
test(package): add basic type check script
```

**Format**: `type(scope): description`

**Types**:

- `feat` or `feature`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Maintenance tasks

### Writing Code

1. **Follow existing patterns**: Look at existing code for consistency
2. **Write TypeScript**: All code should be properly typed
3. **Keep it simple**: Avoid over-engineering solutions
4. **Add comments**: Only where the code isn't self-explanatory
5. **Export cleanly**: Follow the existing export patterns in each package

### Testing

**All changes must pass the following checks** before submitting:

```bash
# Type-check all workspaces
bun run types:check

# Build to ensure no build errors
bun run build

# Lint (check)
bun run lint

# Format code
bun run format
```

Make sure:

- All TypeScript types are correct
- No build errors or warnings
- Code follows the style guide
- Existing functionality is not broken

## Submitting Changes

### Pull Request Process

1. **Update your branch** with the latest changes from main:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push your changes** to your fork:

   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create a Pull Request** on GitHub targeting the `main` branch

4. **Fill in the PR template** with:
   - **Clear title**: Use conventional commit format (e.g., "feat(animation): add text reveal component")
   - **Description**: Explain what changed and why
   - **Breaking changes**: Clearly document any breaking changes
   - **Related issues**: Reference issues (e.g., "Fixes #123", "Closes #456")
   - **Screenshots/videos**: Add visual proof for UI changes
   - **Testing**: Describe how you tested the changes

5. **Wait for review**: Maintainers will review your PR and may request changes

**Keep PRs focused**: Large pull requests are harder to review. Try to keep changes focused on a single feature or fix.

### Pull Request Checklist

- [ ] Code follows the project's style guidelines
- [ ] Typecheck passes (`bun run types:check`)
- [ ] Lint passes (`bun run lint`)
- [ ] Tests pass (`bun run test`)
- [ ] Build succeeds (`bun run build`)
- [ ] Formatting check passes (`bun run format:check`)
- [ ] Generated `public/` assets are updated when frontend changes
- [ ] Commit messages follow conventional commits
- [ ] Documentation is updated (if needed)
- [ ] No breaking changes (or clearly documented if necessary)

## Release Process

Maintainers release a version by updating `package.json`, updating `CHANGELOG.md`, and creating a matching tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The release workflow requires the tag to match `package.json` exactly. It publishes the NPM package and builds multi-platform Docker images. Manual workflow dispatch is not enabled.

## Security

If you discover a security vulnerability, please report it privately as described in [SECURITY.md](./SECURITY.md).

**Do not report security issues through public GitHub issues.**

## Questions and Support

If you have questions or need help:

- Check the [documentation](./README.md)
- Open an issue in the [GitHub repository](https://github.com/kumixlabs/worker/issues)
- Ask a question in a GitHub discussion when appropriate

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.
