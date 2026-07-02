# Explorer Property Attributes

Style files in Obsidian's file explorer **by their frontmatter properties** — with plain CSS snippets.

CSS alone can't see frontmatter. This plugin bridges the gap: it exposes the properties you choose as `data-` attributes on file-explorer items, and keeps them **updated instantly** when a property changes.

## Example: a reading tracker

Notes have a `status` property. Mark a note `status: done` and it turns gray with a checkmark in the file explorer — no need to open it to see where you left off.

**1.** In the plugin settings, set **Properties** to `status`.

**2.** Add a CSS snippet (Settings → Appearance → CSS snippets):

```css
.nav-file-title-content[data-link-status="done"] {
  color: var(--text-faint);
}

.nav-file-title-content[data-link-status="done"]::before {
  content: "✓ ";
  color: var(--color-green);
  font-weight: 700;
}
```

**3.** Toggle `status` in any note's properties — the explorer restyles immediately.

Works with any property and any value: `priority`, `type`, `archived`, non-ASCII names too. List values are joined with spaces, so `[data-link-tags~="project"]`-style selectors work.

## How it compares to Supercharged Links

[Supercharged Links](https://github.com/mdelobelle/obsidian_supercharged_links) pioneered this attribute format and also decorates editor links, tab headers and more. This plugin does **one thing**: the file explorer — and fixes the pain point that motivated it: Supercharged Links repaints the explorer only when its DOM is rebuilt (e.g. collapsing a folder), so after editing a property the explorer can show a stale value even across an app reload.

The attribute format is identical (`data-link-<property>`), so CSS snippets written for Supercharged Links keep working unchanged. If you only used Supercharged Links to style the file explorer, this plugin is a drop-in replacement; if you use its other features, both can run side by side.

## Install

**From the community catalog:** Settings → Community plugins → Browse → search for **Explorer Property Attributes**, or use [this link](https://obsidian.md/plugins?id=explorer-property-attributes).

**Manually:** download `main.js` and `manifest.json` from the [latest release](https://github.com/hemy301/explorer-property-attributes/releases/latest) into `<vault>/.obsidian/plugins/explorer-property-attributes/` and enable the plugin.

## Notes

- Only markdown files are decorated (they are the only files with frontmatter).
- Attributes live on `.nav-file-title-content` inside `.nav-file-title[data-path]` elements.
- The plugin cleans up after itself: attributes are removed when a property is removed from settings or the plugin is disabled.

## License

MIT
