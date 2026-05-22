# Icon Library

Curated SVG icons for use in Excalidraw diagrams, infographics, and Marp slides. Vendored from 4 upstream sources (MIT / Apache 2.0 / CC0). All icons recolored to the Theo Dark palette.

## Sources

| Lib | License | Stroke | Grid | Use for |
|---|---|---|---|---|
| `lucide/` | MIT | 2px | 24×24 | Primary motor — UI concepts, AI, flow, storage, actions |
| `tabler/` | MIT | 2px | 24×24 | Complement when Lucide misses a specific concept |
| `simple-icons/` | CC0 | monochrome | varied | Brand logos (GitHub, Anthropic, Python, Docker, …) |
| `phosphor-duotone/` | MIT | 2-tone | 256×256 | Hero elements only (use sparingly in infographics) |

Each library folder contains two layers:
- `<lib>/_raw/<name>.svg` — original upstream (with `currentColor`)
- `<lib>/<name>.svg` — recolored with Theo palette per `curated_icons.txt`

## Files

| File | Purpose |
|---|---|
| `curated_icons.txt` | Source of truth — `<lib>/<name> <category>` lines. Adding here pulls on next download. |
| `theo_palette_map.json` | Semantic category → hex color (mirrors `../color-palette.md`). |
| `download_icons.py` | Idempotent fetcher from upstream GitHub raw URLs. |
| `apply_theo_palette.py` | Recolors `_raw/*.svg` into `<lib>/*.svg` per category. |
| `icon_to_excalidraw.py` | Emits a JSON snippet (element + file entry) ready to merge into an `.excalidraw` scene. |

## Workflow

### Adding a new icon

1. Append a line to `curated_icons.txt`: `<lib>/<icon-name> <category>`
2. `python3 download_icons.py`
3. `python3 apply_theo_palette.py`

The icon now lives at `<lib>/<icon-name>.svg`, recolored.

### Using in an Excalidraw diagram

```bash
python3 icon_to_excalidraw.py lucide/brain --x 200 --y 150 --size 64
```

The output is a JSON object with two keys:
- `element` — push into `scene["elements"]`
- `file` — merge into `scene["files"]` (keyed by `file["id"]`)

Override the color when needed:
```bash
python3 icon_to_excalidraw.py lucide/database --color "#fbbf24"
```

### Using in a Marp slide

Inline `<svg>` (requires `html: true` in frontmatter):

```html
<style>
.icon { width: 1.2em; height: 1.2em; fill: currentColor; vertical-align: middle; }
</style>

# Memory Store <span style="color: #a855f7">
<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 18V5"/>
  ...
</svg></span>
```

Or as image:
```markdown
![w:32 h:32](../../.claude/skills/excalidraw/references/icons/lucide/brain.svg)
```

### Using in matplotlib (Python charts)

```python
import cairosvg
from PIL import Image
from io import BytesIO
from matplotlib.offsetbox import OffsetImage, AnnotationBbox

svg = Path("icons/lucide/brain.svg").read_text()
png = cairosvg.svg2png(bytestring=svg.encode(), output_width=128)
img = Image.open(BytesIO(png))
ab = AnnotationBbox(OffsetImage(img, zoom=0.5), (x, y), frameon=False)
ax.add_artist(ab)
```

## Categories (semantic colors)

See `theo_palette_map.json`. Quick reference:

| Category | Color | Use for |
|---|---|---|
| `primary` | `#a855f7` | Memory, brand purple, core |
| `secondary` | `#58a6ff` | Context, semantic recall |
| `accent` | `#fbbf24` | Attention, badges, key metrics |
| `success` | `#3fb950` | Confirmed, done |
| `warning` | `#f87171` | Error, blocked (use sparingly) |
| `ai` | `#d2a8ff` | Reflection, agent, LLM |
| `neutral` | `#c9d1d9` | Default text inside shapes |
| `muted` | `#8b949e` | Body, descriptions |
| `brand` | (neutral by default) | Simple Icons logos |

## License & Trademark

- Lucide / Tabler / Phosphor: MIT — commercial use OK, no attribution required.
- Simple Icons: CC0 (public domain SVG). **The underlying brand logos remain trademarks of their owners.** CC0 covers the SVG file artwork, not the right to imply endorsement. Editorial use (e.g., "we integrate with X") is fine; rebranding or competitor comparison pages need to check the brand's own logo guidelines.

## Notes on upstream changes

Lucide and Simple Icons rename icons periodically. When `download_icons.py` reports 404s, check upstream for the new name and update `curated_icons.txt`. Recent renames already applied:
- Lucide: `git-commit` → `git-commit-horizontal`, `edit` → `square-pen`, `unlock` → `lock-open`, `check-circle-2` → `circle-check`, `alert-*` → `*-alert`, `bar-chart-3` → `chart-bar`, `terminal-square` → `square-terminal`, `wand-2` → `wand-sparkles`, `function-square` → `square-function`, `help-circle` → `circle-question-mark`.
- Simple Icons: removed `openai`, `amazonwebservices`, `visualstudiocode` due to trademark requests. Use `vscodium` as VSCode substitute; for OpenAI/AWS, render the brand name as text instead.
