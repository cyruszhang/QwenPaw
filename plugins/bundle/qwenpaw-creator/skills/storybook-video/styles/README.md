# Style catalog

Curated visual aesthetic presets that any storybook-video project can
pick from. Each entry is a reusable text template + (eventually) a
canonical reference image — the v15 anchor-locking pipeline passes the
reference image to every per-scene generation call alongside character
and scene refs.

## Provenance

Seeded from [Fooocus's `sdxl_styles_fooocus.json`](https://github.com/lllyasviel/Fooocus/blob/main/sdxl_styles/sdxl_styles_fooocus.json)
(Apache 2.0), then re-tuned for the gpt-image-2 content policy and our
specific use cases. Original Fooocus prompts target SDXL; the wording
mostly transfers but we drop named-living-artist references that
gpt-image-2's safety filter rejects.

## How a project uses a style

In a project's YAML:

```yaml
project:
  style: ghibli_watercolor    # picks the catalog entry

# OR override the template:
project:
  style:
    inherits: ghibli_watercolor
    positive_addition: " with stronger golden-hour rim lighting"
```

The skill's Stage 0c resolves the style id, generates the
`sample_ref.png` if it doesn't yet exist (single gpt-image-2 call
using `positive_template` with a neutral subject), and stores it
in `samples/`. From then on, every Stage 02 frame-composition call
passes that image as one of its references.

## Adding a new style

1. Add an entry to `styles.yml`
2. Pick a unique `id` (snake_case)
3. Write `positive_template` with `{prompt}` placeholder for the
   scene-specific text
4. Note any safety caveats discovered during testing (which named
   references get rejected, etc.)
5. Sample image is generated lazily on first project that uses it

## Catalog overview

| Family | Entries |
|---|---|
| Watercolor / hand-painted | `ghibli_watercolor`, `watercolor_painting`, `pastel_storybook`, `oil_painting_classical`, `ink_wash_sumie` |
| Anime / animation | `anime_modern`, `anime_retro_80s`, `cinematic_3d_animation` |
| Stylized illustration | `comic_book`, `pixel_art` |
| Photo-real | `photoreal_documentary`, `photoreal_cinema` |

## Known safety filter caveats (gpt-image-2)

- **Named living artists** (Hayao Miyazaki, etc.) → reliable rejection
- **Specific studio names** (Studio Ghibli) → inconsistent rejection
- **Specific film titles** (Spirited Away, etc.) → inconsistent rejection
- **Violence/gore language** ("bloody", "carcass", "wound") →
  reliable rejection. Use softer language ("weathered", "great fish",
  "dim").

Working pattern: describe the *visible characteristics* of a style
rather than naming the source.
