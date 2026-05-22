# Color Palette & Brand Style

**This is the single source of truth for all colors and brand-specific styles.** Derived from the [Theo Website](../../../../../usetheo/theo-website/) brand identity.

**Mode:** This project defaults to **dark mode** (`#0d1117`). Set `viewBackgroundColor` in the `.excalidraw` JSON to switch mode.

---

## Brand Colors (Theo)

| Token | Light Mode | Dark Mode | Semantic |
|-------|-----------|-----------|----------|
| **Primary** | `#8C3DED` | `#a855f7` | Brand purple — CTAs, highlights |
| **Accent** | `#FFBF00` | `#fbbf24` | Yellow — attention, badges |
| **Success** | `#22c55e` | `#3fb950` | Green — positive, done |
| **Destructive** | `#F54444` | `#f87171` | Red — error, blocked |
| **Foreground** | `#000000` | `#c9d1d9` | Primary text |
| **Muted** | `#4B465F` | `#8b949e` | Secondary text |
| **Background** | `#EDEFED` | `#0d1117` | Canvas / slide bg |
| **Surface** | `#FFFFFF` | `#161b22` | Cards, shape fills |
| **Border** | `#000000` | `#30363d` | Borders, structural lines |

---

## Dark Mode (Default)

### Background

| Property | Value |
|----------|-------|
| Canvas background | `#0d1117` |

### Shape Colors (Semantic)

| Semantic Purpose | Fill | Stroke |
|------------------|------|--------|
| Primary | `#2d1b69` | `#a855f7` |
| Secondary | `#1e3a5f` | `#58a6ff` |
| Accent/Attention | `#3d2b00` | `#fbbf24` |
| Success | `#0d3320` | `#3fb950` |
| Warning | `#3d1010` | `#f87171` |
| AI/LLM | `#2d1b69` | `#d2a8ff` |
| Inactive | `#161b22` | `#484f58` (dashed) |
| Error | `#4a0e0e` | `#ff6b6b` |

### Text Colors

| Level | Color | Use For |
|-------|-------|---------|
| Title | `#a855f7` | Section headings, major labels |
| Subtitle | `#c4b5fd` | Subheadings, secondary labels |
| Body | `#8b949e` | Descriptions, annotations |
| Inside shapes | `#c9d1d9` | Text inside filled shapes |
| Emphasis | `#fbbf24` | Key terms, highlights (accent yellow) |
| Positive | `#3fb950` | Success, done |
| Negative | `#f87171` | Error, blocked |

### Evidence Artifacts

| Artifact | Background | Text Color |
|----------|-----------|------------|
| Code snippet | `#161b22` | Syntax-colored |
| JSON/data | `#161b22` | `#3fb950` (green) |

### Strokes & Lines

| Element | Color |
|---------|-------|
| Arrows | Stroke color of source element |
| Structural lines | `#30363d` or `#484f58` |
| Marker dots | `#a855f7` (primary) |

---

## Light Mode (Optional)

Set `viewBackgroundColor: "#EDEFED"` to use light mode.

### Shape Colors (Semantic)

| Semantic Purpose | Fill | Stroke |
|------------------|------|--------|
| Primary | `#ede9fe` | `#8C3DED` |
| Secondary | `#dbeafe` | `#2563eb` |
| Accent/Attention | `#fef3c7` | `#d97706` |
| Success | `#dcfce7` | `#16a34a` |
| Warning | `#fee2e2` | `#dc2626` |
| AI/LLM | `#f3e8ff` | `#7c3aed` |
| Inactive | `#f1f5f9` | `#94a3b8` (dashed) |
| Error | `#fecaca` | `#b91c1c` |

### Text Colors

| Level | Color | Use For |
|-------|-------|---------|
| Title | `#6d28d9` | Section headings |
| Subtitle | `#7c3aed` | Subheadings |
| Body | `#4B465F` | Descriptions |
| Inside shapes | `#1e1e1e` | Text inside shapes |
| Emphasis | `#d97706` | Key terms (accent) |

### Strokes & Lines

| Element | Color |
|---------|-------|
| Arrows | Stroke color of source element |
| Structural lines | `#000000` |
| Marker dots | `#8C3DED` (primary) |
| Shadows | `4px 4px 0px rgba(0,0,0,1)` (brutal) |

---

## Consistency with Marp Slides

Diagrams and slides share the **same visual language**:

| Element | In Slide (dark) | In Diagram (dark) |
|---------|-----------------|-------------------|
| Background | `#0d1117` | `#0d1117` |
| Title | `#a855f7` (h1) | `#a855f7` (title text) |
| Body text | `#c9d1d9` | `#c9d1d9` (inside shapes) |
| Highlight | `#fbbf24` (bold) | `#fbbf24` (accent stroke) |
| Subtle | `#8b949e` (blockquote) | `#8b949e` (body text) |
| Positive | `#3fb950` | `#3fb950` (success stroke) |
| AI/LLM | `#d2a8ff` (italic) | `#d2a8ff` (AI stroke) |
| Borders | `#30363d` | `#30363d` (structural lines) |

---

## Fonts (from Theo Brand)

| Purpose | Font | Weights |
|---------|------|---------|
| Display | Space Grotesk | 400-800 |
| Body | Inter | 400-700 |
| Code | JetBrains Mono | 400-700 |
