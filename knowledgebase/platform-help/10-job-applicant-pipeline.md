# Job Applicant pipeline (prebuilt)

## Overview

Optional hiring/job-search automation: Discovery → Fit scoring → Resume tailoring → Application, tracked on Kanban.

This is **not** the freeform Workflows canvas (though a Job Applicant **template** may exist under Workflows). Day-to-day control is under **Prebuilt Workflows**.

## Job profiles (`/job-profiles`)

1. Create a profile with preferences, portals, and resume context.
2. Keep intake accurate — agents use this as ground truth.
3. Enable/disable pipeline participation as offered in the UI.

## Job workflows (`/job-workflows`)

1. View imperative pipeline run history and status.
2. Trigger or monitor stages according to the UI.
3. Review candidates and applications when the pipeline finds matches.
4. CEO review gates may appear on **Kanban**.

## Agents involved (typical)

Job Discovery, Fit Scorer, Resume Tailor, Application Agent — provisioned when the job-applicant setup is run for the environment. Chat them for stage-specific work; prefer profile + pipeline for end-to-end runs.

## Vs custom Workflows

Use **Job workflows** for the productized applicant path. Use **Workflows** when you need arbitrary triggers, MCP, A2A, Brain, approvals, etc.

Operator setup detail: `knowledgebase/JOB-APPLICANT-WORKFLOW.md`.
