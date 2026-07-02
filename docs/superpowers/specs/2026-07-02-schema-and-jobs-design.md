# Review Schema And Job State Design

## Scope

This document records decisions for future changes. It does not change runtime behavior.

## Review Schema Direction

The current schema remains active: findings use `P0|P1|P2|P3`, `title`, `file`, `line`, `detail`, and `summary`.

A future schema may add `verdict`, `next_steps`, `recommendation`, `confidence`, and line ranges. That migration must define:

- severity mapping: `P0 -> critical`, `P1 -> high`, `P2 -> medium`, `P3 -> low`
- Stop gate blocking rule: block on `P0` and `P1` equivalents
- renderer compatibility: accept old and new shapes during a transition period
- background result compatibility: parse old transcripts without data loss

## Job State Direction

The current job system remains active: state stores job metadata and uses `claude agents --json --all` plus transcript parsing to reconcile results.

A future job redesign must choose one of two strategies:

- additive: keep transcript parsing as the source of final output and add job log/phase metadata for observability
- replacement: make companion-owned job files the source of truth and use Claude transcript only as an import source

The additive path is preferred until Claude background jobs expose stable final output and cancellation metadata without transcript parsing.
