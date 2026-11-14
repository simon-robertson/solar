# Project instructions

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
