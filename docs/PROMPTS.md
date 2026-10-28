# Prompt specification

The executable prompt files are in [`prompts/`](../prompts/). They are exported from the shipped engine rather than maintained as separate prose descriptions.

```bash
npm run export-prompts
```

For each role, the export includes:

- `{role}.system.txt`: the complete system message, including shared instructions, the role's task, and its output-validation contract.
- `{role}.payload.example.json`: an example structured user payload showing what information the role receives.
- `manifest.json`: export metadata and file references.
- `templates.json`: instruction templates, including fields that vary with the selected context count.

The planning and reflection roles also include `*.payload.later-round.example.json` files showing how accumulated results and strategy lessons enter a later round. Example payloads are software fixtures; they are not research findings.

The seven role identifiers are `extract`, `design`, `plan`, `review`, `actor`, `reflect`, and `report`. The example planning and review prompts use two selected contexts. A run with a different count instantiates the corresponding templates and output contract.

## Message construction

Each call contains one system message and one JSON user payload. The system message combines:

1. A shared instruction to return a JSON object, write scientific explanations in English, treat supplied documents as research data, and avoid inventing evidence.
2. The task-specific role instruction.
3. Output-validation rules generated from the response schema, including field names, allowed values, lengths, and required properties.

The API bridge requests a JSON-object response and does not stream. The engine validates the parsed response before accepting it into the study. The saved call ledger contains the actual messages used in each request. Schema-invalid responses stop the run rather than triggering automatic resampling.

## Structured memory and actor isolation

The planning payload includes the invariant design, executed context history, strategy lessons, available source IDs, and any review issues. The reflection payload includes deterministic summaries, prior lessons, fact-citation counts, and selected brief justifications.

The actor payload has only `requestId`, `task`, `facts`, and `options`. It excludes the study memory, predicted effect, context-selection rationale, research purpose, previous responses, and the semantic mapping from A/B to the measured action. The actor's response contains its structured decision, a brief justification, and cited fact IDs; it does not expose private reasoning.

When adapting the system, edit `src/engine.ts`, rebuild the executable module, and export the prompts again:

```bash
npm run build
npm run export-prompts
npm test
```

Keep the output schemas and validation logic aligned with any changed response fields.
