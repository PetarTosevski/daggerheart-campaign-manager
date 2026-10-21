# Autopilot implementation plan (design port D2.5–D11)
See .omc/autopilot/spec.md. One phase per commit, in order; each phase follows the D1/D2 pattern
(docs/tasks/TASK-103, TASK-104). Executors may be used in parallel inside a phase for independent
parts (data extraction from boards, separate components); the lead integrates, tests and commits.
Validation per phase: architect + security-reviewer + code-reviewer at the end of D2.5 (auth) and
at the end of the run; architect per phase otherwise.
