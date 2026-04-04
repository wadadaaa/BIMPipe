## **1. Goal**



Build a web-first MVP for plumbing design using a ready IFC file.



The MVP should let a user:

1. upload an IFC model,

2. choose a floor,

3. open that floor in a 2D/top-down viewer,

4. detect plumbing fixtures, especially WC,

5. suggest risers,

6. manually adjust risers,

7. generate draft routes,

8. validate the result,

9. export the session result.




### **Typical floor clarification**



The MVP operates on **one selected floor**, typically a **representative typical floor**.



This is intentional and correct, because in many buildings the typical floors are repeated. The goal of the MVP is to prove the workflow on one floor first.



In the **full product**, the validated solution should later be applicable to **all matching typical floors**, with support for:

- propagation from a reference floor,

- identifying non-matching floors,

- handling exceptions where a floor differs from the typical pattern.


---

## **2. Scope**



### **In Scope**

- IFC file upload

- Storey parsing and floor selection

- 2D/top-down viewer for a selected floor

- Fixture detection, especially WC

- Manual fixture correction

- Auto-suggested risers

- Manual riser add/move/delete

- Draft route generation from fixtures to risers

- Validation issues list and map highlighting

- Export session result to JSON




### **Out of Scope for MVP**

- Revit add-in

- Writing routes back into BIM authoring software

- Full engineering compliance across all code requirements

- Multi-floor execution and propagation

- Automatic detection of all typical-floor groups

- Collaboration, auth, billing, admin




### **Future Scope**

- Run the workflow on all matching typical floors

- Propagate a validated solution from one representative floor to repeated floors

- Identify floors that differ from the base typical-floor pattern

- Support review of exception floors before final acceptance


---

# **3. Product Workflow**



## **Step 1 — Upload IFC**



User uploads an IFC file.



### **Expected Result**



The system accepts the file, parses it, and prepares building/storey information.



### **Done when**



The user can see available floors or storeys.

---

## **Step 2 — Select Floor**



User selects one floor, ideally a representative typical floor.



### **Expected Result**



Only that floor becomes the active working floor.



### **Done when**



The selected floor is isolated and ready for display.

---

## **Step 3 — Open Floor in 2D Viewer**



The floor is shown in top-down mode.



### **Expected Result**



User can inspect the floor clearly using pan, zoom, and reset view.



### **Done when**



The floor is readable, centered, and isolated from irrelevant geometry.

---

## **Step 4 — Detect Fixtures**



System detects fixtures, especially WC.



### **Expected Result**



Detected fixtures appear both on the plan and in the sidebar.



### **Done when**



The user can understand which fixtures were found and inspect them individually.

---

## **Step 5 — Correct Fixtures Manually**



User can remove false positives and add missing fixtures manually.



### **Expected Result**



Detection errors are fixable in the UI.



### **Done when**



The user can trust the fixture set as the working input.

---

## **Step 6 — Suggest Risers**



System proposes risers based on fixture layout.



### **Expected Result**



Usable riser candidates appear on the map and in the sidebar.



### **Done when**



The user has an initial set of risers to work from.

---

## **Step 7 — Edit Risers**



User can add, move, and delete risers.



### **Expected Result**



The user can refine or override the automatic suggestion.



### **Done when**



The riser layout can be brought to a reasonable state manually.

---

## **Step 8 — Assign Fixtures to Risers**



System assigns fixtures to risers.



### **Expected Result**



Each fixture has a target riser or a clear issue if it cannot be assigned.



### **Done when**



The assignment state is stable and visible.

---

## **Step 9 — Generate Draft Routes**



System builds draft routes from fixtures to assigned risers.



### **Expected Result**



Visible routes are shown on the plan.



### **Done when**



Each assignable fixture has a route or a clear failure state.

---

## **Step 10 — Validate**



System validates generated routes.



### **MVP validations**

- reachability

- basic slope

- rough floor-fit / slab-depth fit

- route length / route complexity

- missing route for required fixture




### **Expected Result**



Validation issues are shown in a list and linked to locations on the plan.



### **Done when**



The user can understand what is wrong and where it is.

---

## **Step 11 — Review**



User clicks issues and inspects geometry.



### **Expected Result**



Issue review is easy and actionable.



### **Done when**



The user can jump from issue list to the problem area on the floor.

---

## **Step 12 — Export**



User exports the current session.



### **Expected Result**



The result can be saved as JSON for reuse or later integration.



### **Done when**



The session structure is serialized successfully.

---

# **4. Technical Work Breakdown**



## **Epic A — Project Foundation**



### **Task A1 — Bootstrap frontend app**

- Create React + TypeScript + Vite app

- Add pnpm scripts

- Define initial folder structure




#### **Expected Result**

A clean running frontend project exists.



#### **Tests**

- app starts

- lint passes

- typecheck passes

- tests run




#### **Why these tests matter**

These tests confirm the project is healthy before feature work begins. If this baseline is unstable, all later tasks become noisy and unreliable.

---

### **Task A2 — Engineering baseline**

- Add ESLint

- Add Prettier

- Add strict TypeScript

- Add Vitest and Testing Library




#### **Expected Result**

The repo has a quality gate from day one.



#### **Tests**

- pnpm lint

- pnpm typecheck

- pnpm test




#### **Why these tests matter**

They prevent low-quality foundations and catch structural mistakes early.

---

### **Task A3 — Architecture structure**

- Separate ui, application, domain, viewer, shared

- Keep domain logic outside components




#### **Expected Result**

A maintainable codebase with clean boundaries.



#### **Tests**

- architecture review

- import-path sanity checks

- no direct domain logic inside UI components for core rules




#### **Why these tests matter**

This is less about automated UI behavior and more about protecting the long-term health of the codebase.

---

## **Epic B — IFC Loading and Floor Extraction**



### **Task B1 — IFC upload**

- Add IFC upload control

- Validate file type

- Handle bad uploads gracefully




#### **Expected Result**

User can provide a file safely.



#### **Tests**

- upload valid IFC

- reject invalid file

- handle empty file

- handle broken IFC




#### **Why these tests matter**

File handling is the first user entry point. It must fail safely and predictably.

---

### **Task B2 — Storey parsing**

- Parse building/storey metadata

- Show floor list




#### **Expected Result**

The system knows which floors exist.



#### **Tests**

- parse one-floor file

- parse multi-floor file

- handle missing storey names

- handle weak or inconsistent metadata




#### **Why these tests matter**

Real IFC files are often inconsistent. This layer must be tolerant enough for MVP use.

---

### **Task B3 — Selected floor extraction**

- Extract only the selected floor subset

- Clear previous floor when switching




#### **Expected Result**

The active floor is isolated correctly.



#### **Tests**

- open one chosen floor

- switch floors

- clean previous geometry

- re-open same floor without corruption




#### **Why these tests matter**

Without correct floor isolation, the whole workflow becomes visually confusing and hard to trust.

---

## **Epic C — Viewer and UI Shell**



### **Task C1 — Top-down viewer**

- Add top-down camera

- Add fit-to-floor

- Add pan/zoom/reset




#### **Expected Result**

The floor is easy to inspect.



#### **Tests**

- initial fit works

- zoom works

- pan works

- reset works




#### **Why these tests matter**

Viewer usability is central to the product. If the user cannot comfortably read the floor, the rest of the workflow suffers.

---

### **Task C2 — Selection and hover system**

- Add hover state

- Add selected state

- Sync with sidebar selection




#### **Expected Result**

Map interactions feel understandable and responsive.



#### **Tests**

- hover object

- select object

- switch selection

- click empty space




#### **Why these tests matter**

Selection behavior is a core interaction pattern that will be reused by fixtures, risers, routes, and issues.

---

### **Task C3 — Sidebar shell**

- Add tabs for Fixtures, Risers, Routes, Validation

- Add empty states




#### **Expected Result**

A stable UI shell for all feature panels.



#### **Tests**

- tab switching

- empty states

- selection persistence across tabs




#### **Why these tests matter**

This is the main organizational UI of the product.

---

## **Epic D — Fixture Detection**



### **Task D1 — Fixture domain model**

- Define Fixture

- Add mapping from IFC entities




#### **Expected Result**

A consistent internal representation for fixtures.



#### **Tests**

- unit tests for fixture mapping

- required fields always exist

- invalid mapping is handled safely




#### **Why these tests matter**

Everything downstream depends on stable fixture data.

---

### **Task D2 — Detect WC**

- Detect WC by IFC class

- Detect WC by naming/properties

- Filter obvious false positives




#### **Expected Result**

Likely WC fixtures are identified on representative files.



#### **Tests**

- detect by class

- detect by name

- reject false positives

- ignore irrelevant objects




#### **Why these tests matter**

This is one of the highest-risk parts of the MVP because IFC naming quality varies a lot.

---

### **Task D3 — Show fixtures**

- Render fixtures on map

- Show fixture list

- Sync selection between list and map




#### **Expected Result**

Fixtures are visible and inspectable.



#### **Tests**

- select in list highlights on map

- select on map updates list

- no-fixtures state works




#### **Why these tests matter**

The feature is only useful if the user can understand and inspect what was detected.

---

### **Task D4 — Manual fixture correction**

- Remove false positives

- Add missing fixture

- Edit fixture state/type if needed




#### **Expected Result**

The user can fix imperfect detection.



#### **Tests**

- remove detected fixture

- add manual fixture

- edit corrected fixture

- corrections persist in session




#### **Why these tests matter**

Manual correction is the safety valve that makes a heuristic MVP practical.

---

## **Epic E — Risers**



### **Task E1 — Riser domain model**

- Define Riser

- Add source type and assigned fixtures




#### **Expected Result**

Stable internal riser representation.



#### **Tests**

- unit tests for riser model

- state transitions work correctly




#### **Why these tests matter**

Risers are a core planning object and need predictable behavior.

---

### **Task E2 — Auto-suggest risers**

- Suggest candidate risers

- Use simple clustering / heuristic logic




#### **Expected Result**

Reasonable default risers are produced.



#### **Tests**

- one fixture → one riser

- nearby fixtures → shared riser candidate

- distant groups → separate risers

- no fixtures → no risers




#### **Why these tests matter**

This proves the product can do useful work automatically, even with a simple first algorithm.

---

### **Task E3 — Manual riser editing**

- Add riser by click

- Move riser

- Delete riser




#### **Expected Result**

The user can refine the proposal.



#### **Tests**

- add riser

- move riser

- delete riser

- rerender state after edits




#### **Why these tests matter**

Editing is essential because auto-suggestion will never be perfect in MVP.

---

### **Task E4 — Fixture-to-riser assignment**

- Assign fixtures to active risers

- Recompute after edits




#### **Expected Result**

Each fixture has a clear target riser.



#### **Tests**

- nearest valid assignment

- reassign after riser move

- reassign after riser delete

- no orphan references




#### **Why these tests matter**

Route generation depends directly on assignment correctness.

---

## **Epic F — Routes**



### **Task F1 — Route model**

- Define Route

- Define PipeSegment

- Add export-friendly structure




#### **Expected Result**

Stable internal route representation.



#### **Tests**

- route creation unit tests

- serialization tests




#### **Why these tests matter**

The route model connects generation, rendering, validation, and export.

---

### **Task F2 — Draft route generation**

- Generate draft orthogonal/grid-based routes

- Return structured failures when impossible




#### **Expected Result**

The system can build usable draft routes.



#### **Tests**

- straight route

- L-shaped route

- impossible route

- reroute after riser move




#### **Why these tests matter**

This is the main planning engine of the MVP.

---

### **Task F3 — Render routes**

- Draw routes on map

- Highlight selected route




#### **Expected Result**

Routes are clearly visible in the viewer.



#### **Tests**

- route visible

- selected route highlighted

- route refreshes after recalculation




#### **Why these tests matter**

Generated routes must be inspectable visually, not only as data.

---

### **Task F4 — Route details panel**

- Show fixture, riser, route length, status, issue count




#### **Expected Result**

Structured route review is possible.



#### **Tests**

- route details update on selection

- empty state works

- issue count stays in sync




#### **Why these tests matter**

This turns raw geometry into something understandable for the user.

---

## **Epic G — Validation**



### **Task G1 — Validation issue model**

- Define ValidationIssue




#### **Expected Result**

All validations share one issue format.



#### **Tests**

- issue creation helpers

- all required fields present




#### **Why these tests matter**

A single issue format simplifies UI, export, and debugging.

---

### **Task G2 — Reachability validation**

- Check route reachability




#### **Expected Result**

Unroutable cases are flagged.



#### **Tests**

- reachable passes

- unreachable fails

- broken route after edit is flagged




#### **Why these tests matter**

This is the most basic route validity check.

---

### **Task G3 — Slope validation**

- Check minimum slope logic




#### **Expected Result**

Insufficient slope is reported.



#### **Tests**

- valid slope passes

- invalid slope fails

- missing slope inputs handled safely




#### **Why these tests matter**

Even rough plumbing validation should include this rule.

---

### **Task G4 — Floor-fit validation**

- Check whether route roughly fits in slab/floor depth




#### **Expected Result**

Potential slab-depth conflicts are reported.



#### **Tests**

- fits floor

- exceeds floor depth

- unknown slab data becomes warning




#### **Why these tests matter**

This is one of the most practical and understandable validations for MVP value.

---

### **Task G5 — Length / complexity validation**

- Check excessive length

- Check excessive bends or suspicious complexity




#### **Expected Result**

Suspicious routes are flagged.



#### **Tests**

- normal route passes

- long route warns/fails

- too many bends warns




#### **Why these tests matter**

This catches bad but technically possible draft routes.

---

### **Task G6 — Validation panel + map linking**

- Show all issues in sidebar

- Highlight issue location on map

- Focus related entity on click




#### **Expected Result**

Validation is actionable.



#### **Tests**

- click issue highlights map

- issue count updates after recomputation

- resolved issue disappears




#### **Why these tests matter**

Validation only becomes useful when the user can act on it.

---

## **Epic H — Export and Persistence**



### **Task H1 — Session state**

- Create exportable session structure




#### **Expected Result**

All major entities are captured in one session shape.



#### **Tests**

- state serialization

- state integrity checks




#### **Why these tests matter**

Export is only reliable if the state shape is stable.

---

### **Task H2 — Export JSON**

- Export current result to JSON




#### **Expected Result**

The user can save the session externally.



#### **Tests**

- export populated session

- export empty/default session

- exported shape matches schema




#### **Why these tests matter**

This makes the MVP demoable and reusable.

---

### **Task H3 — Optional import**

- Import saved session JSON




#### **Expected Result**

The user can continue prior work.



#### **Tests**

- import valid session

- reject invalid schema

- restore UI state correctly




#### **Why these tests matter**

Optional, but useful for repeated demos and development iteration.

---

## **Epic I — Product Polish**



### **Task I1 — Loading / error / empty states**

- Add clear messaging for parse failures, no fixtures, no routes




#### **Expected Result**

The app does not fail silently.



#### **Tests**

- loading state

- parse error state

- no-fixtures state

- no-routes state




#### **Why these tests matter**

A demo MVP must be understandable even when results are incomplete.

---

### **Task I2 — Onboarding hints**

- Add short guidance to the flow




#### **Expected Result**

The product is understandable without a long explanation.



#### **Tests**

- smoke UX review

- hints visible at the right step




#### **Why these tests matter**

This improves first-time usability significantly.

---

### **Task I3 — Performance pass**

- Check typical IFC size behavior

- Reduce unnecessary rerenders

- Keep floor-only rendering efficient




#### **Expected Result**

The app remains usable on representative files.



#### **Tests**

- medium IFC loading

- repeated floor switching

- repeated rerouting

- UI remains responsive




#### **Why these tests matter**

Viewer-heavy products can become frustrating quickly if performance is ignored.

---

# **5. Test Strategy**



## **Unit tests**



Use unit tests for:

- IFC mapping

- fixture detection rules

- riser suggestion logic

- fixture-to-riser assignment

- route generation logic

- validation rules

- export serialization




### **Why**



These are the highest-value tests because the product’s real intelligence lives in domain logic, not only in UI.

---

## **Integration tests**



Use integration tests for:

- upload IFC → choose floor → render floor

- detect fixtures → show in list and map

- edit riser → recompute assignment/route

- route changes → validation updates

- export produces expected JSON payload




### **Why**



These verify that multiple layers work together correctly.

---

## **UI tests**



Use UI tests for:

- clicking fixture in list selects map object

- clicking issue highlights problem location

- adding a riser via map interaction

- switching floors updates the scene




### **Why**



These protect the key interactions the user depends on.

---

## **Manual smoke tests**



Run manual smoke tests for:

- upload IFC

- select floor

- inspect floor

- detect fixtures

- correct fixtures

- suggest risers

- edit risers

- generate routes

- review validation

- export JSON




### **Why**



Viewer-heavy geometry workflows still need human verification, especially in MVP stage.

---

## **Edge-case manual tests**



Run targeted manual checks for:

- empty IFC

- broken IFC

- no WC found

- one WC only

- multiple nearby WC

- distant WC groups

- impossible route

- missing slab data

- repeated recalculation

- repeated floor switch




### **Why**



These expose where heuristics and assumptions break down.

---

# **6. Recommended Implementation Order**



## **Phase 1 — Foundation**

- A1 Bootstrap frontend

- A2 Engineering baseline

- A3 Architecture structure




## **Phase 2 — IFC and Viewer**

- B1 IFC upload

- B2 Storey parsing

- B3 Selected floor extraction

- C1 Top-down viewer

- C2 Selection system

- C3 Sidebar shell




## **Phase 3 — Fixtures**

- D1 Fixture model

- D2 Detect WC

- D3 Show fixtures

- D4 Manual fixture correction




## **Phase 4 — Risers**

- E1 Riser model

- E2 Auto-suggest risers

- E3 Manual riser editing

- E4 Fixture-to-riser assignment




## **Phase 5 — Routes**

- F1 Route model

- F2 Draft route generation

- F3 Render routes

- F4 Route details panel




## **Phase 6 — Validation**

- G1 Validation issue model

- G2 Reachability

- G3 Slope

- G4 Floor-fit

- G5 Length / complexity

- G6 Validation UI




## **Phase 7 — Export and Polish**

- H1 Session state

- H2 Export JSON

- H3 Optional import

- I1 Error/loading states

- I2 Onboarding hints

- I3 Performance pass


---

# **7. Definition of Done**



A task is done when:

1. implementation is complete,

2. typecheck passes,

3. lint passes,

4. relevant tests are added and passing,

5. user-facing behavior is manually verified,

6. domain logic remains outside React components where applicable.


---

# **8. MVP Acceptance Criteria**



The MVP is complete when:

1. User can upload an IFC file and select one floor.

2. The floor is displayed in top-down mode.

3. The system detects WC on representative files.

4. The user can manually correct fixtures.

5. The system suggests risers.

6. The user can manually edit risers.

7. The system generates draft routes.

8. The system shows validation issues.

9. Clicking an issue highlights the problem on the map.

10. The current session can be exported as JSON.

11. Core domain logic is covered by unit tests.

12. Main workflow passes smoke testing.
