# Project instructions

## Documentation

`docs/` is the deployed public web root, not a documentation directory. Keep
development Markdown, implementation notes, reviews, benchmark results and agent
handoffs in root `notes/`. Start with [notes/README.md](notes/README.md) for context
and keep that index current when adding notes. This applies to all agents and
subagents. Keep the project README and these instructions at the repository root.

Visitor-facing texture credits remain in the site's About dialog; the detailed
attribution record is in `notes/TEXTURE-ATTRIBUTION.md`.

## Visual consistency

Keep equivalent UI elements visually consistent. Reuse shared typography, casing,
spacing, colours and interaction styles rather than introducing separate variants.
Planet and moon name labels must share the same label typography and styling;
keep their common styles in one CSS rule so future changes apply to both.
Only introduce visual differences when the user requests them or the element's
function requires them.

## Testing

Run only tests and checks likely to be affected by the changes being made.
Choose coverage from the changed behaviour and its dependencies; do not run the
full suite by default. Broaden testing only when shared code changes, failures,
or a specific unresolved concern justify it. Leave unrelated test groups out,
and briefly report which relevant checks were run.

## Rendering

Keep steady-frame render draws below ten. Prefer measured batching and bounded
geometry over putting every effect in a full-screen pixel loop. Local LOD must
affect only its own entities, never unrelated planet paths. Validate orbital
rendering at low/coplanar angles and in planetary close-ups as well as overview.
