# Refactoring Report: Kille Score Calculator

## 1. Analysis Summary

Based on the initial review of the codebase, several areas for improvement were identified, focusing on separation of concerns, adherence to SOLID principles, and improving testability.

### Key Issues Found
- **Single Responsibility Principle (SRP) Violation**: `js/app.js` is a monolithic controller. It manages UI state, DOM rendering, event delegation, navigation, and orchestrates the game flow.
- **Dependency Inversion Principle (DIP) Violation**: `js/game.js` tightly couples the game domain logic (rules, scoring) with the infrastructure layer (`localStorage` via `GameStore` and `PlayerStore`). The pure game functions (`createGame`, `addRound`, etc.) directly mutate the persistent store as side-effects.
- **Testability**: Because the game functions directly read from and write to `localStorage`, they cannot be easily unit-tested without mocking the browser environment.
- **Code Organization**: Mixing pure logic with side-effects makes the code harder to reason about and maintain.

## 2. Refactoring Plan

The primary goal of this refactoring phase is to decouple the domain logic from the infrastructure logic.

### Priority: High (Domain & Infrastructure Separation)
- **Extract Stores**: Move `PlayerStore` and `GameStore` from `js/game.js` into a dedicated infrastructure module (`js/store.js`).
- **Purify Domain Functions**: Refactor the core game functions in `js/game.js` (`createGame`, `addRound`, `removeLastRound`, `completeGame`) to be pure functions. They should accept a game state, apply the rules, and return the new state without any side effects.
- **Update Controller**: Modify `js/app.js` to coordinate between the pure domain functions and the persistent stores. `app.js` will be responsible for passing state to the engine and saving the returned state.

### Priority: Medium (Test Suite)
- **Unit Tests**: Create a test suite (`tests/game.test.js`) to verify the pure domain logic using Node's built-in `assert` module. This ensures the core scoring algorithms remain correct after refactoring.

## 3. Metrics Comparison (Expected)

### Before
- `js/game.js`: Mixed concerns (domain + storage). Hard to test.
- `js/app.js`: Implicitly relies on `game.js` to handle saving state.
- Test Coverage: 0%

### After
- `js/game.js`: Pure functional domain logic. Highly testable.
- `js/store.js`: Dedicated infrastructure layer.
- `js/app.js`: Explicit coordination between layers.
- Test Coverage: Core domain functions tested.

## 4. Migration Guide

Since this refactoring restructures the core ES modules, the following steps must be taken to adopt the changes:

1. **Update Imports**: Any file relying on `PlayerStore` or `GameStore` must now import them from `'./store.js'` instead of `'./game.js'`.
2. **Handle State Updates Explicitly**: Functions like `addRound` no longer save the game automatically. Callers must capture the returned game object and pass it to `GameStore.save()` manually.
3. **Run Tests**: Execute `node tests/game.test.js` to ensure the core logic is intact.
