# Contributing to Refetch

Thank you for your interest in contributing to Refetch! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors. Please be considerate, constructive, and professional in all interactions.

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm (comes with Node.js)
- Git
- A GitHub account

### Finding Issues to Work On

- Check the [Issues](../../issues) page for open issues
- Look for issues labeled `good first issue` if you're new to the project
- Look for issues labeled `help wanted` for items we'd especially like contributions on
- Feel free to propose new features or improvements by opening an issue first

## Development Setup

1. **Fork the repository**
   ```bash
   # Click the "Fork" button on GitHub
   ```

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/library.git
   cd library/refetch
   ```

3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/mshindi-labs/library.git
   ```

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Build the project**
   ```bash
   npm run build
   ```

6. **Verify your setup**
   ```bash
   # Check that the build output exists
   ls -la dist/
   ```

## Project Structure

```
refetch/
├── src/
│   ├── index.ts          # Main entry point and exports
│   ├── refetch.ts        # Core create() function and instance methods
│   ├── types.ts          # TypeScript type definitions
│   ├── constants.ts      # Constants and configuration
│   └── utils.ts          # Utility functions
├── dist/                 # Build output (generated)
├── README.md            # User-facing documentation
├── CLAUDE.md            # Claude Code guidance
├── CONTRIBUTING.md      # This file
├── LICENSE              # MIT license
├── package.json         # Package configuration
├── tsconfig.json        # TypeScript configuration
└── tsup.config.ts       # Build configuration
```

### Key Files

- **src/refetch.ts**: Contains the main `create()` factory function and all HTTP method implementations
- **src/types.ts**: All TypeScript interfaces, types, and the PROBLEM_CODE enum
- **src/utils.ts**: Helper functions for URL building, header merging, response parsing, etc.
- **src/constants.ts**: Shared constants like default timeout, status code ranges, and error messages

## Development Workflow

### Creating a Branch

Always create a new branch for your work:

```bash
# Update your main branch
git checkout main
git pull upstream main

# Create a new branch
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `perf/` - Performance improvements

### Making Changes

1. **Make your changes** in the appropriate files
2. **Build the project** to ensure it compiles:
   ```bash
   npm run build
   ```
3. **Test your changes** manually (see [Testing Guidelines](#testing-guidelines))
4. **Check TypeScript types**:
   ```bash
   npx tsc --noEmit
   ```

### Keeping Your Branch Updated

```bash
# Fetch upstream changes
git fetch upstream

# Rebase your branch on upstream/main
git rebase upstream/main

# If there are conflicts, resolve them and continue
git rebase --continue
```

## Coding Standards

### TypeScript Guidelines

1. **Use strict TypeScript**
   - The project uses `strict: true` in tsconfig.json
   - Avoid using `any` types unless absolutely necessary
   - Prefer interfaces for objects, types for unions/intersections

2. **Follow existing patterns**
   - Match the code style of the file you're editing
   - Use the same naming conventions
   - Follow the existing architecture (closures for state, sequential transforms, etc.)

3. **Type safety**
   - All public APIs must be properly typed
   - Use generics where appropriate (e.g., `ApiResponse<T>`)
   - Ensure type inference works correctly for consumers

### Code Style

1. **Formatting**
   - Use 2 spaces for indentation (not tabs)
   - Use single quotes for strings
   - Add trailing commas in multi-line objects/arrays
   - Keep lines under 80-100 characters when reasonable

2. **Naming conventions**
   - `camelCase` for variables, functions, and methods
   - `PascalCase` for types, interfaces, and enums
   - `UPPER_CASE` for constants
   - Descriptive names that convey purpose

3. **Documentation**
   - Add JSDoc comments for all exported functions, types, and interfaces
   - Include `@param` and `@returns` tags
   - Provide usage examples for complex features
   - Update README.md if adding user-facing features

### Example Code

```typescript
/**
 * Classify the problem based on status code or error
 *
 * @param status - HTTP status code (if available)
 * @param error - JavaScript Error object (if available)
 * @returns PROBLEM_CODE enum value indicating the error type
 */
export function classifyProblem(status?: number, error?: Error): PROBLEM_CODE {
  // Implementation...
}
```

## Testing Guidelines

Currently, the project does not have an automated test suite. When making changes, please test manually:

### Manual Testing Checklist

1. **Build succeeds**
   ```bash
   npm run build
   ```

2. **Type checking passes**
   ```bash
   npx tsc --noEmit
   ```

3. **Create a test file** (not committed) to verify your changes:
   ```typescript
   // test-local.ts
   import { create, PROBLEM_CODE } from './src/index';

   const api = create({
     baseURL: 'https://jsonplaceholder.typicode.com',
   });

   // Test your changes here
   async function test() {
     const response = await api.get('/posts/1');
     console.log(response);
   }

   test();
   ```

4. **Run your test file**
   ```bash
   npx tsx test-local.ts
   ```

### What to Test

When making changes, verify:

- ✅ Basic HTTP methods work (GET, POST, PUT, PATCH, DELETE, HEAD)
- ✅ Request transforms are applied correctly
- ✅ Response transforms are applied correctly
- ✅ Monitors are called appropriately
- ✅ Error classification works (network errors, timeouts, HTTP errors)
- ✅ TypeScript types are correct and infer properly
- ✅ Both ESM and CommonJS builds work
- ✅ Backward compatibility is maintained (no breaking changes without major version bump)

### Future: Automated Testing

We welcome contributions to add automated testing! If you'd like to help set up a test suite:

- Consider using Vitest or Jest
- Focus on unit tests for utility functions first
- Add integration tests for the main API
- Include edge cases and error scenarios
- Mock fetch API responses

## Submitting Changes

### Commit Messages

Write clear, descriptive commit messages following this format:

```
<type>: <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Example:**

```
feat: add retry mechanism for failed requests

Implement automatic retry logic with exponential backoff for
network errors and 5xx server errors. Configurable via new
`retries` and `retryDelay` options in RefetchConfig.

- Add retry logic to request function
- Add new config options with defaults
- Update types and documentation
- Maintain backward compatibility

Closes #123
```

### Pull Request Process

1. **Push your branch** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request** on GitHub:
   - Go to your fork on GitHub
   - Click "New Pull Request"
   - Select your branch
   - Fill out the PR template (if available)

3. **PR Title**: Use the same format as commit messages
   ```
   feat: add retry mechanism for failed requests
   ```

4. **PR Description**: Include:
   - What changes you made and why
   - How you tested the changes
   - Any breaking changes
   - Related issues (use "Closes #123" to auto-close)
   - Screenshots/examples if relevant

5. **Ensure CI passes** (when implemented)

6. **Respond to feedback**: Be open to suggestions and iterate on your changes

### PR Review Process

- Maintainers will review your PR as soon as possible
- Address any requested changes
- Once approved, a maintainer will merge your PR
- Your contribution will be included in the next release!

## Release Process

This section is primarily for maintainers, but contributors should understand how releases work:

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features (backward compatible)
- **PATCH** (0.0.1): Bug fixes (backward compatible)

### Release Steps (Maintainers)

1. Update version in package.json:
   ```bash
   npm version patch  # or minor, or major
   ```

2. Update CHANGELOG.md (when created)

3. Create a git tag:
   ```bash
   git tag v1.0.1
   ```

4. Push changes and tags:
   ```bash
   git push origin main --tags
   ```

5. Publish to npm:
   ```bash
   npm publish --access public
   ```

6. Create a GitHub release with notes

## Questions or Need Help?

- Open an issue for questions about contributing
- Reach out to maintainers via GitHub discussions (when enabled)
- Check existing issues and PRs for similar questions

## Recognition

All contributors will be recognized in the project. Your contributions, whether code, documentation, or bug reports, are valuable and appreciated!

## License

By contributing to Refetch, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Refetch! 🚀
