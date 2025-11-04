# Instructions for Generating Tutorial Step YAML from MDX/MD Files

## Overview

You are extracting executable tutorial steps from MDX/MD tutorial files and converting them into a structured YAML format that follows the tutorial validator schema. The output must be valid YAML that can be executed deterministically.

## YAML File Structure

### Required Top-Level Fields

```yaml
# Schema reference for validation
# yaml-language-server: $schema=../../packages/tutorial-step-executor/src/dsl/schema.json

metadata:
  title: "Tutorial Title"
  description: "Brief description of the tutorial"
  version: "1.0.0"  # Optional but recommended

prerequisites:
  commands:
    - "command1"  # List all shell commands needed (cd, mkdir, npm, etc.)
    - "command2"
  envVars: []  # List environment variables required
  versions: {}  # Optional: specific tool versions needed

workingDirectory: "project-name"  # Optional: base directory for all steps

steps:
  # Array of step objects (see Step Types below)
```

## Step Types

### 1. Run Command Step

**When to use:** Any terminal/command-line instruction.

**Structure:**
```yaml
- id: "unique-step-id"
  type: "run-command"
  stepNumber: 1
  description: "Human-readable description of what this step does"
  command: "the actual command to run"
  workingDirectory: "optional-subdirectory"  # Only if different from base
  expectedExitCode: 0  # Optional: expected exit code
```

**Examples:**
- Package installations: `pnpm add package-name`
- File creation: `touch filename.ts`
- Directory creation: `mkdir -p src/directory`
- Navigation: `cd project-directory`
- Running scripts: `npm run build`

### 2. Change File Step

**When to use:** Any file modification instruction.

**Three subtypes:**

#### A. Replace Entire File (`type: "replace"`)

**When:** Tutorial shows a complete file or says "replace the file with:"

```yaml
- id: "step-id"
  type: "change-file"
  stepNumber: 2
  description: "Create or replace file with new content"
  workingDirectory: "optional-subdirectory"
  change:
    type: "replace"
    path: "relative/path/to/file.ts"
    contents: |
      // Full file contents here
      // Use | for multi-line strings
      export const example = "value";
```

#### B. Context-Based Change (`type: "context"`)

**When:** Tutorial shows a diff, "add after/before line X", or "update line containing Y"

**CRITICAL - YAML String Quoting Rules for `searchPattern`:**

The `searchPattern` must match EXACTLY what appears in the source file. YAML has strict escaping rules:

**Rule 1: Use SINGLE QUOTES for patterns containing `$`**
```yaml
# ❌ WRONG - Will cause "unknown escape sequence" error in double quotes:
searchPattern: "const todos$ = queryDb(() => tables.todos.select())"

# ✅ CORRECT - Use single quotes to avoid YAML parsing issues with $:
searchPattern: 'const todos$ = queryDb(() => tables.todos.select())'
```

**Rule 2: Use SINGLE QUOTES for patterns containing single quotes**
```yaml
# ❌ WRONG:
searchPattern: "import from '@package/name'"

# ✅ CORRECT - Double the inner single quotes:
searchPattern: 'import from ''@package/name'''
```

**Rule 3: Use DOUBLE QUOTES for patterns with `\n` escape sequences**
```yaml
# ✅ CORRECT:
searchPattern: "        </div>\n\n        <div className=\"space-y-3\">"
```

**Rule 4: Use DOUBLE QUOTES for patterns with parentheses or braces (no `$` or single quotes)**
```yaml
# ✅ CORRECT:
searchPattern: "tailwindcss(),"
```

**Rule 5: Patterns with BOTH single quotes AND braces/parentheses**
When a pattern contains BOTH literal single quotes (`'text'`) AND braces/parentheses (`{`, `}`, `(`, `)`, etc.), you MUST use DOUBLE QUOTES for the YAML string. This avoids YAML parsing issues since single-quoted YAML strings don't process escape sequences well and braces can cause parsing errors.

```yaml
# ❌ WRONG - This would need complex escaping in single quotes:
searchPattern: ''v1.TodoDeleted': ({ id }) => tables.todos.delete().where({ id: id }),'

# ✅ CORRECT - Double quotes handle both single quotes and braces cleanly:
searchPattern: "'v1.TodoDeleted': ({ id }) => tables.todos.delete().where({ id: id }),"
```

**Quick Decision Tree:**
1. Does pattern contain `\$`? → Use single quotes `'...'` (unless also has braces/parentheses - see Rule 5)
2. Does pattern contain BOTH single quotes AND braces/parentheses like `{`, `}`, `(`, `)`? → Use double quotes `"..."` (Rule 5)
3. Does pattern contain single quotes only (no braces/parentheses)? → Use single quotes and double inner quotes: `'text ''inner'' text'`
4. Does pattern contain `\n` newline escape? → Use double quotes `"..."`
5. Otherwise → Use double quotes `"..."`
6. For patterns with actual literal newlines (multiline), use double quotes with `\n`

**Structure:**
```yaml
- id: "step-id"
  type: "change-file"
  stepNumber: 3
  description: "Add import after existing imports"
  workingDirectory: "optional-subdirectory"
  change:
    type: "context"
    path: "src/file.ts"
    searchPattern: 'import { existing } from "package"'  # Must match EXACT text
    action: "after"  # or "before" or "replace"
    content: "import { newImport } from 'new-package'"
```

**Finding the Right `searchPattern`:**
- Look at the ACTUAL source code context shown in tutorial
- Match EXACTLY including whitespace, quotes, parentheses, braces, brackets
- **CRITICAL: NO ESCAPING NEEDED for pattern matching** - The executor uses literal string matching (`.includes()`), not regex, so copy the exact text from the source file
- Only handle YAML quoting rules (see Rules 1-5 above) - escaping is only for YAML syntax, not for the pattern itself
- For variable names with `$` like `todos$`, use `todos$` in the pattern (no escaping needed)

**Common Patterns (all show literal source text, no escaping):**
```yaml
# Function call - copy exactly as appears:
searchPattern: "makeWorker({ schema })"

# Object property - copy exactly:
searchPattern: "text: State.SQLite.text({ default: '' })"

# Import statement - copy exactly (handle YAML quotes):
searchPattern: 'import { name } from ''@package/name'''

# Variable with $ - copy exactly:
searchPattern: "const todos$ = queryDb(() => tables.todos.select())"

# JSX/TSX - copy exactly:
searchPattern: "onChange={(e) => setInput(e.target.value)}"

# Materializer function - copy exactly:
searchPattern: "'v1.TodoDeleted': ({ id }) => tables.todos.delete().where({ id: id }),"
```

**Important Reminder:**
- The `searchPattern` value is searched using JavaScript's `.includes()` method on each line
- It's **literal string matching**, not regex, so copy the source text exactly
- The only "escaping" you need to consider is YAML quoting rules (single vs double quotes for the YAML value itself)

#### C. Diff-Based Change (`type: "diff"`)

**When:** Tutorial shows explicit line numbers or line-based diffs

```yaml
- id: "step-id"
  type: "change-file"
  stepNumber: 4
  description: "Remove lines 10-15 and insert new content at line 10"
  change:
    type: "diff"
    path: "src/file.ts"
    removeLines:
      start: 10
      end: 15
    insertLines:
      at: 10
      lines:
        - "new line 1"
        - "new line 2"
```

### 3. Validate Step

**When to use:** Any instruction to verify/test something worked.

**Structure:**
```yaml
- id: "step-id"
  type: "validate"
  stepNumber: 5
  description: "Verify file exists"
  validation:
    type: "file-contents"  # or "cli-output" or "browser"
    path: "src/file.ts"  # for file-contents
    check:
      exists: true
      # OR
      contains: "expected text"
      # OR
      equals: "exact content"
      # OR
      matches: "regex pattern"
```

**Types:**

#### A. File Contents Validation
```yaml
validation:
  type: "file-contents"
  path: "src/file.ts"
  check:
    exists: true  # File must exist
    # OR one of:
    contains: "expected substring"
    equals: "exact match"
    matches: "regex.*pattern"
```

#### B. CLI Output Validation
```yaml
validation:
  type: "cli-output"
  command: "ls"
  workingDirectory: "optional"
  check:
    contains: "expected output"
    # OR
    containsError: "error message"
    # OR
    matches: "regex.*pattern"
    # OR
    exitCode: 0
```

#### C. Browser Validation
```yaml
validation:
  type: "browser"
  url: "http://localhost:3000"
  check:
    containsText: "Welcome"
    # OR
    selector: "h1"
    elementText: "Expected Title"
    # OR
    attribute:
      name: "href"
      value: "/path"
    # OR
    evaluate: "document.title === 'Expected'"
```

### 4. Browser Action Step

**When to use:** Any instruction that involves interacting with a web application in a browser (clicking, typing, navigating, etc.).

**Key Difference:**
- **Browser Action Step (`browser-action`)**: Performs interactions (clicks, typing, navigation)
- **Browser Validation (`validate` with `type: "browser"`)**: Only checks/reads state (doesn't interact)

**Structure:**
```yaml
- id: "step-id"
  type: "browser-action"
  stepNumber: 6
  description: "Interact with the application in browser"
  url: "http://localhost:5173"  # Starting URL
  timeout: 30000  # Optional: timeout in milliseconds (default: 30000)
  actions:
    # Array of actions to perform in sequence
```

**Available Action Types:**

#### A. Navigate
Navigate to a different URL.

```yaml
actions:
  - type: "navigate"
    url: "http://localhost:5173/about"
    waitUntil: "load"  # Optional: "load" | "domcontentloaded" | "networkidle"
```

#### B. Click
Click on an element.

```yaml
actions:
  - type: "click"
    selector: "button[type='submit']"
    waitForVisible: true  # Optional: wait for element to be visible (default: true)
    timeout: 5000  # Optional: timeout in milliseconds
```

#### C. Type
Type text into an input field.

```yaml
actions:
  - type: "type"
    selector: "input[placeholder='Enter todo']"
    text: "Buy groceries"
    clear: false  # Optional: clear field first (default: false)
```

#### D. Wait
Wait for an element to appear.

```yaml
actions:
  - type: "wait"
    selector: ".todo-item"
    visible: true  # Optional: wait for visible state (default: true)
    timeout: 10000  # Optional: timeout in milliseconds
```

#### E. Evaluate
Execute custom JavaScript in the page context.

```yaml
actions:
  - type: "evaluate"
    script: "window.localStorage.setItem('key', 'value')"
```

#### F. Screenshot
Take a screenshot (useful for debugging/verification).

```yaml
actions:
  - type: "screenshot"
    path: "screenshot.png"  # Optional: path to save screenshot
```

**Complete Example:**
```yaml
- id: "ch3-test-todo-app"
  type: "browser-action"
  stepNumber: 8
  description: "Test adding a todo item in the browser"
  url: "http://localhost:5173"
  actions:
    - type: "wait"
      selector: "body"
      visible: true
    - type: "click"
      selector: "input[placeholder*='todo']"
    - type: "type"
      selector: "input[placeholder*='todo']"
      text: "Test todo item"
    - type: "click"
      selector: "button[type='submit']"
    - type: "wait"
      selector: ".todo-item"
      visible: true
```

**Handling Ambiguous Tutorial Instructions:**

Tutorials often say things like "run the app" or "check the app" without specifying exact actions. You need to **infer useful actions** from context.

**Guidelines for Inferring Actions:**

1. **Analyze the Tutorial Context:**
   - What feature was just implemented? (e.g., "todo list", "search", "form")
   - What does the screenshot/visual show?
   - What text describes what the user should see or do?

2. **Common Patterns:**

   **After implementing a form:**
   ```yaml
   # Tutorial says: "Run the app and add a todo"
   actions:
     - type: "wait"
       selector: "input[type='text'], input[placeholder*='todo'], input[name*='todo']"
     - type: "type"
       selector: "input[type='text'], input[placeholder*='todo'], input[name*='todo']"
       text: "Test todo"  # Use generic but relevant text
     - type: "click"
       selector: "button[type='submit'], button:has-text('Add'), button:has-text('Submit')"
   ```

   **After implementing a feature that displays data:**
   ```yaml
   # Tutorial says: "Check the app, you should see your todos"
   actions:
     - type: "wait"
       selector: ".todo-list, [data-testid='todos'], ul, .items"
       visible: true
   ```

   **After implementing navigation/routing:**
   ```yaml
   # Tutorial says: "Navigate to the about page"
   actions:
     - type: "click"
       selector: "a[href*='about'], nav a:has-text('About')"
     # OR
     - type: "navigate"
       url: "http://localhost:5173/about"
   ```

3. **Selector Strategy:**

   Use **multiple selector strategies** to be resilient:
   - By element type: `input[type='text']`
   - By placeholder: `input[placeholder*='todo']`
   - By name attribute: `input[name='todo']`
   - By CSS classes: `.todo-input`
   - By text content (if supported): `button:has-text('Add')`
   - By data attributes: `[data-testid='add-button']`

   **However, use the most specific selector that matches the tutorial context.** If the tutorial shows specific CSS classes or IDs, use those.

4. **When Tutorial Shows Specific UI:**
   - If tutorial shows a screenshot: identify visible elements (buttons, inputs, headings)
   - If tutorial shows code with `className` or `id`: use those in selectors
   - If tutorial describes specific text: use text-based selectors

5. **When Tutorial is Vague:**
   - **Default action**: At minimum, wait for the page to load and verify main content is visible
   - **If it's a form**: Fill it with a test value and submit
   - **If it's a list/display**: Wait for the container element
   - **If it's navigation**: Click the most obvious navigation element or navigate directly

**Example: Handling Vague Instructions**

```yaml
# Tutorial says: "Run the development server and check the app"
# Context: Just created a todo app with an input and submit button

- id: "ch3-run-dev-server"
  type: "run-command"
  stepNumber: 7
  description: "Start development server"
  command: "pnpm dev"
  workingDirectory: "todo-app"

- id: "ch3-wait-server-ready"
  type: "run-command"
  stepNumber: 8
  description: "Wait for server to be ready"
  command: "sleep 5"

- id: "ch3-test-app"
  type: "browser-action"
  stepNumber: 9
  description: "Test the todo app by adding an item"
  url: "http://localhost:5173"
  actions:
    - type: "wait"
      selector: "body"
      visible: true
    - type: "click"
      selector: "input[type='text'], input[placeholder*='todo']"
    - type: "type"
      selector: "input[type='text'], input[placeholder*='todo']"
      text: "Learn LiveStore"
    - type: "click"
      selector: "button[type='submit'], button:has-text('Add')"
    - type: "wait"
      selector: ".todo-item, li, [data-testid='todo']"
      visible: true

- id: "ch3-validate-todo-added"
  type: "validate"
  stepNumber: 10
  description: "Verify todo item appears in the list"
  validation:
    type: "browser"
    url: "http://localhost:5173"
    check:
      containsText: "Learn LiveStore"
```

**Determining the URL:**

- Tutorial explicitly mentions URL: use that (e.g., "http://localhost:3000", "http://localhost:5173")
- Tutorial mentions port: infer `http://localhost:{port}`
- Common defaults:
  - Vite/React: `http://localhost:5173`
  - Next.js: `http://localhost:3000`
  - Create React App: `http://localhost:3000`
- If tutorial shows a terminal output with a URL, use that
- If completely unclear, use `http://localhost:3000` as default

**Best Practices:**

1. **Always start with a wait** for page load: `wait` for `body` or main container
2. **Use descriptive test data**: Use text that makes sense in context (e.g., "Test todo" for a todo app, not "asdf")
3. **Chain actions logically**: wait → interact → wait for result
4. **Be resilient with selectors**: Use multiple fallback selectors when tutorial doesn't specify
5. **Match tutorial intent**: If tutorial says "add a todo", actually add one - don't just check if the page loads
6. **Follow with validation**: After browser actions, often add a browser validation step to verify the result

## Step Extraction Guidelines

### From Tutorial Text

1. **Identify Command Steps:**
   - Look for code blocks with shell commands
   - Commands like `npm install`, `mkdir`, `touch`, etc.
   - Commands inside `<Tabs>` or similar UI components

2. **Identify File Changes:**
   - Look for code blocks with file paths as titles: ````ts title="path/to/file"`
   - Look for diff blocks: ````diff`
   - Look for phrases like "add this to", "update", "replace", "modify"
   - Track file state through tutorial to find exact context

3. **Identify Browser Action Steps:**

   ⚠️ **CRITICAL:** When tutorial says "run the app", "try it out", "test it", "check the app", or similar phrases, you MUST create browser-action steps that **actually interact with the feature** (fill forms, click buttons, navigate), not just validation that the page loads. Infer meaningful actions from the context of what was just implemented.
   
   - Look for instructions like "run the app", "open in browser", "test the app"
   - Phrases like "click the button", "fill in the form", "add a todo"
   - When tutorial shows screenshots or describes UI interactions
   - After implementing features that require user interaction
   - Often appears after starting a dev server

4. **Identify Validation Steps:**
   - Often implicit - add validation after important steps
   - "Verify that...", "Check that...", "Make sure..."
   - After file creation: verify it exists
   - After commands: verify expected output
   - After UI changes: verify in browser (use browser validation type)
   - After browser actions: verify the action had the expected effect

### Step Numbering

- Increment sequentially: 1, 2, 3, 4...
- Include validation steps in sequence
- Number ALL steps, even if tutorial doesn't explicitly number them

### ID Naming Convention

Use descriptive, unique IDs:
- Format: `chapter-number-step-description`
- Examples: `ch1-create-project`, `ch3-install-deps`, `ch5-add-feature`

### Working Directory Handling

- Set base `workingDirectory` if tutorial works in a specific project directory
- Only add `workingDirectory` to individual steps if they need a different directory
- Steps that create/navigate to project directory should NOT have `workingDirectory`

### Handling Tabs/Alternatives

If tutorial shows alternatives (e.g., bun vs pnpm):
- Choose one canonical option (usually the first mentioned)
- OR create separate steps for each option
- Note in description which option is used

### Command Extraction

- Extract EXACT commands as shown
- Preserve flags and options: `pnpm add -D package-name`
- Handle multi-line commands appropriately
- Include version pins if specified: `@package/name@1.2.3`

## Common Patterns

### Package Installation
```yaml
- id: "install-deps"
  type: "run-command"
  stepNumber: 1
  description: "Install project dependencies"
  command: "pnpm install"
  workingDirectory: "project-name"
```

### File Creation with Content
```yaml
- id: "create-config"
  type: "change-file"
  stepNumber: 2
  description: "Create configuration file"
  change:
    type: "replace"
    path: "config.json"
    contents: |
      {
        "setting": "value"
      }
```

### Adding Import After Existing Imports
```yaml
- id: "add-import"
  type: "change-file"
  stepNumber: 3
  description: "Add new import statement"
  change:
    type: "context"
    path: "src/main.ts"
    searchPattern: 'import { existing } from ''package'''
    action: "after"
    content: "import { newImport } from 'new-package'"
```

### Updating Function Call
```yaml
- id: "update-function"
  type: "change-file"
  stepNumber: 4
  description: "Update function call to include new parameter"
  change:
    type: "context"
    path: "src/file.ts"
    searchPattern: "oldFunction({ param: value })"
    action: "replace"
    content: "oldFunction({\n    param: value,\n    newParam: newValue\n  })"
```

### Testing Application in Browser
```yaml
- id: "test-app"
  type: "browser-action"
  stepNumber: 5
  description: "Test the application by adding a todo item"
  url: "http://localhost:5173"
  actions:
    - type: "wait"
      selector: "body"
    - type: "click"
      selector: "input[placeholder*='todo']"
    - type: "type"
      selector: "input[placeholder*='todo']"
      text: "Buy milk"
    - type: "click"
      selector: "button[type='submit']"
    - type: "wait"
      selector: ".todo-item"
      visible: true
```

## Quality Checklist

Before finalizing the YAML:

- [ ] All `searchPattern` values follow quoting rules (single quotes for `\$` and inner single quotes)
- [ ] All steps have unique IDs
- [ ] All steps have sequential stepNumbers
- [ ] All required fields are present (id, type, stepNumber)
- [ ] File paths are relative to workingDirectory
- [ ] Commands are exact matches to tutorial
- [ ] Browser action steps have meaningful actions inferred from context (not just "wait for body")
- [ ] Browser action URLs are correct (check tutorial for explicit URLs or port numbers)
- [ ] Selectors in browser actions are specific when possible, resilient when tutorial is vague
- [ ] Validation steps are added after important operations (including after browser actions)
- [ ] Prerequisites list all needed commands
- [ ] YAML is valid and indented correctly (2 spaces)

## Example: Complete Tutorial Step

```yaml
# yaml-language-server: $schema=../../packages/tutorial-step-executor/src/dsl/schema.json

metadata:
  title: "React Todo App Tutorial"
  description: "Build a todo app with React and LiveStore"
  version: "1.0.0"

prerequisites:
  commands:
    - "pnpm"
    - "cd"
    - "mkdir"
    - "touch"

workingDirectory: "todo-app"

steps:
  - id: "ch1-create-project"
    type: "run-command"
    stepNumber: 1
    description: "Create new project directory"
    command: "mkdir todo-app"

  - id: "ch1-validate-project"
    type: "validate"
    stepNumber: 2
    description: "Verify project directory was created"
    validation:
      type: "file-contents"
      path: "todo-app"
      check:
        exists: true

  - id: "ch2-install-deps"
    type: "run-command"
    stepNumber: 3
    description: "Install React dependencies"
    command: "pnpm add react react-dom"
    workingDirectory: "todo-app"

  - id: "ch3-create-component"
    type: "change-file"
    stepNumber: 4
    description: "Create main App component"
    change:
      type: "replace"
      path: "src/App.tsx"
      contents: |
        import { useState } from 'react';

        function App() {
          const [todos, setTodos] = useState([]);
          return <div>Todo App</div>;
        }

        export default App;

  - id: "ch4-update-component"
    type: "change-file"
    stepNumber: 5
    description: "Add LiveStore integration"
    change:
      type: "context"
      path: "src/App.tsx"
      searchPattern: "import { useState } from 'react';"
      action: "after"
      content: "import { useStore } from '@livestore/react';"

  - id: "ch4-update-hook"
    type: "change-file"
    stepNumber: 6
    description: "Replace useState with LiveStore query"
    change:
      type: "context"
      path: "src/App.tsx"
      searchPattern: 'const [todos, setTodos] = useState([]);'
      action: "replace"
      content: "  const { store } = useStore();\n  const todos = store.useQuery(todos$);"

  - id: "ch4-validate-update"
    type: "validate"
    stepNumber: 7
    description: "Verify App.tsx contains LiveStore imports"
    validation:
      type: "file-contents"
      path: "src/App.tsx"
      check:
        contains: "@livestore/react"
```

## Critical Reminders

1. **YAML Quoting is Critical:** The most common error is incorrect quoting of `searchPattern`. Always check if pattern contains `\$` or single quotes.

2. **Exact Matching:** `searchPattern` must match the EXACT text in the file, including whitespace and special characters.

3. **Escape Regex Special Chars:** In patterns, escape: `(`, `)`, `{`, `}`, `[`, `]`, `.`, `*`, `+`, `?`, `^`, `$`, `|`

4. **Sequential Validation:** Add validation steps after important operations to catch errors early.

5. **Be Comprehensive:** Extract ALL executable steps from tutorial, even if tutorial treats some as implicit.

6. **Infer Browser Actions:** When tutorials say "run the app" or "test it", infer meaningful actions based on what was just implemented. Don't just wait for page load - actually interact with the feature (fill forms, click buttons, etc.).

7. **Context is Key for Browser Steps:** Use the tutorial's context (recently implemented features, screenshots, code examples) to determine what selectors and actions make sense. If tutorial shows specific classNames or IDs in code, use those in selectors.