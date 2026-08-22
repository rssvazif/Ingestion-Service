# Operating Principles

These principles define the expected behavior of the Hermes Agent when working on this repository.

## 1. Dependency Management

Do **not** add, remove, upgrade, or replace dependencies without explicit approval from the administrator.

This includes:

* Package managers
* Third-party libraries
* Lock files
* Build tools
* Runtime dependencies

---

## 2. Understand Before Acting

Before starting any task:

* Inspect the repository structure.
* Understand the existing architecture.
* Review relevant documentation.
* Identify related modules and dependencies.

If any requirement is ambiguous or information is missing, stop and ask clarifying questions before making changes.

---

## 3. Retry Before Failing

If an operation fails because of a temporary issue:

* Retry using a reasonable approach.
* Investigate the root cause.
* Do not abandon the task after a single failure.

---

## 4. Explore Alternative Solutions

If one implementation approach fails:

* Analyze why it failed.
* Try another compatible solution.
* Continue until a reasonable solution is found or a blocker is confirmed.

---

## 5. Ensure Rollback Capability

Implement changes in a way that allows them to be safely reverted.

Avoid irreversible modifications whenever possible.

If a change introduces regressions, restore the previous working state.

---

## 6. Never Hallucinate

Do not invent:

* APIs
* Configurations
* Business logic
* File locations
* Project structure
* Requirements

If information is unavailable, explicitly state the uncertainty and ask for clarification.

---

## 7. Validate Before and After Changes

Run all relevant tests:

* Before making changes (to establish a baseline)
* After completing the implementation (to verify correctness)

Do not consider a task complete if tests fail.

---

## 8. Respect the Existing Architecture

Ensure every change is compatible with the project's:

* Architecture
* Coding standards
* Design patterns
* Naming conventions
* Module boundaries

Avoid unnecessary refactoring.

---

## 9. Keep Documentation Up-to-Date

Whenever code changes affect:

* Behavior
* APIs
* Configuration
* Workflows
* Developer experience

Update the corresponding documentation as part of the same task.

---

## 10. Maintain an Implementation Log

After completing each significant step:

Record a short summary containing:

* What was changed
* Why it was changed
* Important observations
* Potential follow-up work

The log should help future developers understand the implementation history.

---

## 11. Minimize the Scope of Changes

Modify only the files necessary to complete the requested task.

Avoid unrelated refactoring or cleanup unless explicitly requested.

---

## 12. Preserve Backward Compatibility

Whenever possible:

* Avoid breaking existing APIs.
* Preserve current behavior.
* Maintain compatibility with existing integrations.

Any breaking change must be explicitly approved.

---

## 13. Do Not Commit Without Approval

Never:

* Commit
* Push
* Merge
* Create Pull Requests
* Modify Git history

unless explicitly instructed by the administrator.

---

## 14. Reuse Existing Project Components

Before creating new code:

* Search for existing utilities.
* Reuse existing abstractions.
* Follow established project patterns.

Avoid introducing duplicate implementations.

---

## 15. Avoid Code Duplication

Prefer extending or reusing existing modules over copying logic.

Keep the codebase DRY (Don't Repeat Yourself).

---

## 16. Prioritize Quality

Before considering a task complete, evaluate the implementation for:

* Security
* Performance
* Maintainability
* Readability
* Reliability

Choose the simplest solution that satisfies all requirements.

---

## 17. Add or Update Tests

Whenever practical:

* Add tests for new functionality.
* Update existing tests when behavior changes.
* Ensure the implementation is adequately covered.

---

## 18. State Assumptions Explicitly

If implementation requires assumptions:

* List them clearly.
* Ask for confirmation when necessary.
* Do not silently assume business requirements.

---

## 19. Protect Sensitive Configuration

Never modify:

* Environment variables
* Secrets
* Credentials
* Production configuration
* Infrastructure configuration

without explicit approval.

---

## 20. Provide a Completion Summary

Before finishing a task, provide a concise summary including:

* Completed work
* Validation performed
* Tests executed
* Documentation updated
* Remaining risks
* Recommended next steps