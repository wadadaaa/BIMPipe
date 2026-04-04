# BIMPipe

Web-first MVP for plumbing design from IFC floor models.

BIMPipe helps a user load an IFC model, open a selected floor in a 2D/top-down viewer, detect plumbing fixtures, suggest risers, generate draft routes, validate the result, and export the working session.

## Status

Early MVP scaffold.

Current focus:

* IFC upload
* floor selection
* 2D floor viewer
* fixture detection, especially WC
* riser suggestion and editing
* draft route generation
* validation issues
* session export

## Why single floor first?

The MVP works on **one selected floor**, usually a **representative typical floor**.

This is intentional:

* typical floors are often repeated
* proving the workflow on one floor is the fastest way to validate the product
* the hardest part is getting the core logic right on a single floor first

In the full product, the same validated workflow should later be applicable to **all matching typical floors**, with support for propagation and exception handling.

## MVP workflow

1. Upload an IFC file
2. Parse available storeys / floors
3. Select one floor
4. Open that floor in a 2D/top-down viewer
5. Detect fixtures, especially WC
6. Review and correct fixtures manually if needed
7. Suggest risers
8. Add, move, or delete risers manually
9. Generate draft routes from fixtures to risers
10. Validate the result
11. Review issues on the map and in the sidebar
12. Export the session as JSON

## Tech stack

* React
* TypeScript
* Vite
* pnpm
* TanStack Query
* Zod
* Vitest
* Three.js

Planned / likely:

* web-ifc / IFC.js for IFC parsing and viewer integration
* React Testing Library for UI testing

## Project structure

```text
src/
  app/
  pages/
  widgets/
  features/
  entities/
  domain/
  shared/
  viewer/
docs/
  plans/
```

### Architecture principles

* Keep domain logic outside React components
* Separate UI, application orchestration, domain rules, and viewer concerns
* Prefer pure functions for routing and validation rules
* Keep IFC parsing adapters isolated from domain models

## Getting started

### Prerequisites

* Node.js 20+
* pnpm

### Install

```bash
pnpm install
```

### Run development server

```bash
pnpm dev
```

### Run checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Development plan

The MVP plan lives here:

```text
docs/plans/bimpipe-mvp-plan.md
```

## Initial development priorities

1. IFC upload
2. storey parsing
3. single-floor top-down viewer
4. fixture detection
5. riser suggestion and editing
6. draft routing
7. validation
8. export

## Testing strategy

We use several layers of testing:

### Unit tests

For domain logic:

* fixture detection rules
* riser suggestion logic
* fixture-to-riser assignment
* route generation
* validation rules
* export serialization

### Integration tests

For full feature flows:

* upload IFC -> choose floor -> render floor
* detect fixtures -> show in list and on map
* edit riser -> recompute assignments and routes
* update route -> update validation results

### Manual smoke tests

For geometry-heavy workflows:

* upload file
* select floor
* inspect floor
* review fixtures
* edit risers
* generate routes
* inspect validation issues
* export result

## Roadmap

### MVP

* one-floor workflow
* representative typical floor
* exportable session result

### Post-MVP

* propagate validated solution to all matching typical floors
* identify exception floors
* improve fixture coverage beyond WC
* stronger routing and validation logic
* Revit integration


