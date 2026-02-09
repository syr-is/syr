# Syr Project Style Guide

# Introduction
This style guide outlines the coding conventions for the code written for the Syr Project
It's inspired from both, the Google TypeScript Style Guide and the TsDev Style Guide and
would mostly follow the same rulesets, deviations and points of more concern are listed below

# Key Principles
* **Readability:** Code should be easy to understand for all team members.
* **Maintainability:** Code should be easy to modify and extend.
* **Consistency:** Adhering to a consistent style across all projects improves
  collaboration and reduces errors.
* **Performance:** While readability is paramount, code should be efficient.
* **Having FUN:** While this repo is a budding project, fun features are encouraged provided the code quality is present to back it up, shitty comments are allowed but shitty coded isn't.

## Comments
* **Write clear and concise comments:** Explain the "why" behind the code, not just the "what".
* **Comment sparingly:** Well-written code should be self-documenting where possible.
* **Use complete sentences:** Start comments with a capital letter and use proper punctuation.

## Error Handling
* **Use specific exceptions:** Avoid using broad exceptions like `Exception`.
* **Handle exceptions gracefully:** Provide informative error messages and avoid crashing the program.

# Tooling
* **Code formatter:**  Prettier - Enforces consistent formatting automatically.
* **Linter:**  ESLint - Identifies potential issues and style violations.
