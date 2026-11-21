# Operator workspace audit

Date: 22 November 2026 (IST)

This audit covers the hosted dashboard, its sensor/model display, human review,
local-control handoff, camera-route workspace, architecture guide and optional
simulation. It combines direct UI inspection with source review and automated
behavior checks. Physical motor performance is outside a cloud UI audit.

## Findings and implemented changes

| Area | Finding | Change |
| --- | --- | --- |
| Entry flow | Opening the application selected camera commissioning even though direct Wi-Fi is the installed working controller. | Direct Wi-Fi opens first, without connecting to the device. Camera routes have their own clearly named mode. |
| Clarity | No concise explanation of the next operator step. | A common Observe → Decide → Act and check summary links readings, review and local driving; telemetry, review access and controller-page presence are separate states. |
| Current versus historical | An expired review's old battery warning remained the main recommendation. | Main guidance shows current evidence. Captured advice moves to collapsed history with timestamp, source and sample identity. Expired results no longer say they are still waiting for follow-up. |
| Stale data | The new recommendation panel expired locally, but other readings and approval controls relied on another server update. | A shared monotonic browser clock expires calibrated model displays after two seconds and raw commissioning readings after five, including late-listener replays and cached repeated payloads. |
| Source consistency | Fresh raw commissioning data could coexist with a connection stage waiting for calibrated model samples. | Pipeline stages report raw telemetry, calibrated models, session subscription and stored data independently. |
| Optional setup | The connection drawer could look like a mandatory reflash/calibration step for the existing controller. | Current pipeline status comes first. The calibrated recorder and its setup are explicitly optional; existing forwarding and direct driving remain independent. |
| Simulation separation | Standalone physical pages exposed simulated availability, mission counts and accelerated session figures. | Physical workspaces hide stock-simulation KPIs and actions. The virtual stock simulation pauses off its own pages. Hidden practice tabs are skipped by keyboard navigation. |
| Preview/initialization | A standalone component exposed an obsolete broker-entry flow; waiting for Python could hide the whole workspace. | Standalone sensor views link to the full dashboard. Initial loading shows a readable notice while navigation remains available, with obsolete forms suppressed. |
| Architecture | The diagram omitted direct Wi-Fi and mixed current observation review with commissioned command delivery; route readiness used obsolete dimensions. | Added the actual direct-control journey and corrected conditional model/camera paths. Readiness uses server commissioning and valid scene dimensions rather than old hardcoded floor measurements. |
| Appearance | Small labels and dense explanations made operator decisions harder to scan. | Larger telemetry and review text, consistent action sizing, clear stale/priority styling, responsive status cards and readable mobile steps in both themes. |
| HTML quality | A literal escaped newline rendered at the top of the page. | Removed the stray text and refreshed changed asset versions. |
| Shortcut navigation | Changing workspaces reset the scroll after a review or connection shortcut selected its destination. | Shortcuts scroll after the workspace reset, with guards against later navigation. |
| Connection drawer | The embedded drawer did not request the status previously loaded by its standalone page. | Opening the drawer requests current pipeline status without starting the optional recorder. |
| Update cadence | A five-second host timeout could briefly report a stopped dashboard during a slow server refresh. | Host communication has its own thirty-second timeout; sensor and camera evidence keep their shorter validity limits. |

## State and action contract

- Freshness is based on received sample age plus local elapsed time. Repeating a
  cached sample cannot make it younger. Raw and calibrated channels age separately.
- A current broker subscription does not prove a fresh packet, model readiness or
  an applied motor command. A page-open state does not prove device connection.
- Human review records a response and later readings. Observation approval sends
  no motor command. The operator applies the response through direct Wi-Fi or a
  physical task. A later reading alone does not prove task completion.
- The native controller, release-to-stop behavior and device hold timeout remain
  independent of cloud display refresh. No action in the audit moved the robot.
- Historical records and captured decisions remain available and labelled as
  history. Generated examples cannot authorize physical actions.

## Validation

Automated checks cover navigation and keyboard traversal, source separation,
monotonic sample aging, repeated-payload expiry, frozen dashboard updates across
actual readouts/guidance/review controls, current versus captured recommendations,
source-aware connection stages and command-free operator shortcuts. Repository
checks cover local references, module delivery, unique HTML IDs, public download
consistency and the file-purpose catalog. The deployed interface is inspected
again after publishing.

The audit passed 325 Python tests and all 25 browser behavior scripts. Five
optional local PostgreSQL integration checks were skipped. The deployed direct
drive, sensor review, historical evidence and architecture views were inspected
in bright and dark appearance. No device movement was requested during inspection.

No new measured calibration, motor-current limit, obstacle-detection capability
or physical command acknowledgement is claimed. The installed controller still
requires the operator to apply a recorded response. This audit strengthens the
current interface and software contract; device motion and stopping must be
observed on the robot's local network.
