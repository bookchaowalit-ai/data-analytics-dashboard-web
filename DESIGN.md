# Design direction — Signal Ledger

## World

A night-shift operations console assembled from ledger paper, amber instrument
light, and hard registration rules. The dashboard is a place to inspect a
signal, not a wall of decorative KPIs.

## First viewport

The first viewport leads with the operating question and immediately exposes
the connection state. A single telemetry window carries a labeled illustrative
trace while the adjacent ledger records that no real source is attached.

## Palette and material

- Ink navy `#101925` is the console ground.
- Calico `#e8e3d6` carries readable copy and the paper ledger.
- Safety orange `#f4a261` marks the active trace and attention.
- Faded blue `#75869a` is reserved for inactive grid and context.

## Type

`Space Grotesk` gives the operator headings a compact, technical voice.
`DM Mono` carries timestamps, ranges, and connection labels. Metrics use
tabular numerals and never imply live values when the source is absent.

## Interaction and states

The range control switches between three clearly labeled illustrative windows.
The disconnected state is persistent and prominent. Focus states use orange,
and motion is limited to a short trace reveal that disappears for reduced-motion
users.

## Responsive rules

The desktop console is a chart plus a narrow ledger rail. On mobile the ledger
comes first, then the chart becomes a wide scroll-free panel with a minimum
readable height.


---

## Storybook

Storybook 10 (`@storybook/nextjs-vite`) shows this design system with the app's real CSS, tokens and fonts.

```bash
npm run storybook        # http://localhost:6006
npm run build-storybook  # static build in storybook-static/ (CI: .github/workflows/storybook.yml)
```

- **Foundations/Tokens** reads every CSS custom property the app defines at runtime, so it never drifts from the code.
- **Design/DESIGN.md** renders this file.
- **Components/**, **Sections/** and **Pages/** show the UI with mock data only (no network, analytics off).
- Toolbar: locale, theme (light / dark, when the app has a dark theme), viewports 320 / 375 / 768 / 1440. The a11y panel runs axe (WCAG 2.2 AA).
- Rule: a new shared component or page section ships with a story in `stories/`.
