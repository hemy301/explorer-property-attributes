/* Mark as Read (formerly Explorer Property Attributes; the plugin id is
   unchanged: explorer-property-attributes)
   Exposes frontmatter properties as data attributes on file-explorer items,
   so CSS snippets can style notes by property values.

   For a note with `status: done` in its frontmatter, the file-explorer title
   element gets:
       data-link-status="done"
   The attribute format is compatible with Supercharged Links, so existing
   CSS snippets written for it keep working — but unlike Supercharged Links,
   the explorer is updated instantly when a property changes, not only when
   the explorer DOM happens to be rebuilt.

   Out of the box (no configuration needed):
   - every frontmatter property is exposed as an attribute;
   - every checkbox (boolean) property gets a toggle in the note footer bar;
   - EVERY note gets a footer toggle for the done-marker properties
     (read/done/finished/complete/archived/прочитано) used in the vault, or
     for `read` when none is used yet — clicking creates the property, so
     nothing has to be configured per note;
   - notes whose done-marker property is true are grayed out in the explorer
     with a green checkmark.
   Each of these can be narrowed or turned off in the settings. */

const { Notice, Plugin, PluginSettingTab, Setting, debounce } = require('obsidian');

const ATTR_PREFIX = 'data-link-';
const DONE_CLASS = 'epa-done';

const DEFAULT_SETTINGS = {
	// Expose every frontmatter property; when false, only `properties`.
	allProperties: true,
	properties: [],
	// Footer shows a toggle for every boolean property; when false, only
	// `footerProperties`.
	footerAllBooleans: true,
	footerProperties: [],
	// Footer offers the done-marker properties (see `doneProperties`) that
	// are used somewhere in the vault — or the first of them when none is —
	// in every note, even before the note has the property; clicking the
	// toggle creates it.
	footerEverywhere: true,
	// Built-in styling: gray out a note when any of these boolean properties
	// is true (matched case-insensitively). Cleared = no built-in styling.
	doneProperties: ['read', 'done', 'finished', 'complete', 'archived', 'прочитано'],
};

module.exports = class ExplorerPropertyAttributes extends Plugin {
	async onload() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// Settings saved by pre-1.2.0 versions keep their exact behavior:
		// only the listed properties, no built-in styling.
		if (data && data.allProperties === undefined) {
			this.settings.allProperties = false;
			this.settings.footerAllBooleans = false;
			this.settings.footerEverywhere = false;
			this.settings.doneProperties = [];
		}
		this.observers = [];

		this.addSettingTab(new ExplorerPropertyAttributesSettingTab(this.app, this));

		this.decorateAllDebounced = debounce(() => this.decorateAll(), 100, true);

		this.app.workspace.onLayoutReady(() => {
			this.decorateAll();
			this.watchExplorers();
			this.updateFooters();
		});

		// Instant reaction to property edits (properties pane, plugins, external sync)
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			this.decorateOne(file.path);
			this.updateFooters();
		}));
		// Startup indexing can finish after the first paint (the footer's
		// choice of done-markers depends on the vault-wide property index too)
		this.updateFootersDebounced = debounce(() => this.updateFooters(), 100, true);
		this.registerEvent(this.app.metadataCache.on('resolved', () => {
			this.decorateAllDebounced();
			this.updateFootersDebounced();
		}));
		this.registerEvent(this.app.vault.on('rename', () => this.decorateAllDebounced()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.updateFooters()));
		// New explorer leaves can appear (e.g. moved to another split)
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.watchExplorers();
			this.decorateAllDebounced();
			this.updateFooters();
		}));
	}

	onunload() {
		// A pending debounced call would redecorate right after the cleanup
		this.decorateAllDebounced?.cancel();
		this.updateFootersDebounced?.cancel();
		this.disconnectObservers();
		this.clearAll();
		this.removeFooters();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.clearAll();
		this.decorateAll();
		this.removeFooters();
		this.updateFooters();
	}

	attrFor(property) {
		// Attribute names cannot contain whitespace; mirror Supercharged Links
		// (spaces → hyphens). Non-ASCII property names are valid in HTML.
		// setAttribute lowercases ASCII letters, so lowercase up front to keep
		// our bookkeeping in sync with what the DOM stores.
		return (ATTR_PREFIX + property.replace(/\s/g, '-')).toLowerCase();
	}

	explorerEls() {
		const els = [];
		this.app.workspace.getLeavesOfType('file-explorer').forEach((leaf) => {
			leaf.view.containerEl
				.querySelectorAll('.nav-file-title[data-path]')
				.forEach((el) => els.push(el));
		});
		return els;
	}

	disconnectObservers() {
		this.observers.forEach((o) => o.disconnect());
		this.observers = [];
	}

	// The explorer virtualizes/rebuilds rows; newly created rows need decorating
	watchExplorers() {
		this.disconnectObservers();
		this.app.workspace.getLeavesOfType('file-explorer').forEach((leaf) => {
			const obs = new MutationObserver(() => this.decorateAllDebounced());
			obs.observe(leaf.view.containerEl, { subtree: true, childList: true });
			this.observers.push(obs);
		});
	}

	formatValue(value) {
		if (value === null || value === undefined) return undefined;
		if (Array.isArray(value)) return value.map((v) => String(v)).join(' ');
		if (typeof value === 'object') return undefined; // no useful string form
		return String(value);
	}

	propertiesFor(frontmatter) {
		if (!this.settings.allProperties) return this.settings.properties;
		const all = frontmatter ? Object.keys(frontmatter) : [];
		for (const p of this.settings.properties) if (!all.includes(p)) all.push(p);
		return all;
	}

	isDone(frontmatter) {
		if (!frontmatter) return false;
		const done = this.settings.doneProperties.map((p) => p.toLowerCase());
		return Object.keys(frontmatter).some(
			(key) => frontmatter[key] === true && done.includes(key.toLowerCase())
		);
	}

	decorateEl(el) {
		const path = el.getAttribute('data-path');
		if (!path || !path.endsWith('.md')) return;
		const target = el.querySelector('.nav-file-title-content');
		if (!target) return;
		// getCache by path rather than Vault.getFileByPath, which needs 1.5.7
		const frontmatter = this.app.metadataCache.getCache(path)?.frontmatter;
		const attrs = {};
		for (const property of this.propertiesFor(frontmatter)) {
			const value = this.formatValue(frontmatter ? frontmatter[property] : undefined);
			if (value !== undefined) attrs[this.attrFor(property)] = value;
		}
		// Remove attributes for properties that are gone from the note
		for (const attr of Array.from(target.attributes)) {
			if (attr.name.startsWith(ATTR_PREFIX) && !(attr.name in attrs)) {
				target.removeAttribute(attr.name);
			}
		}
		for (const [attr, value] of Object.entries(attrs)) {
			try {
				if (target.getAttribute(attr) !== value) target.setAttribute(attr, value);
			} catch (e) {
				// Property name not expressible as an attribute name — skip it
			}
		}
		el.classList.toggle(DONE_CLASS, this.isDone(frontmatter));
	}

	decorateOne(path) {
		this.explorerEls().forEach((el) => {
			if (el.getAttribute('data-path') === path) this.decorateEl(el);
		});
	}

	decorateAll() {
		this.explorerEls().forEach((el) => this.decorateEl(el));
	}

	clearAll() {
		this.explorerEls().forEach((el) => {
			el.classList.remove(DONE_CLASS);
			const target = el.querySelector('.nav-file-title-content');
			if (!target) return;
			for (const attr of Array.from(target.attributes)) {
				if (attr.name.startsWith(ATTR_PREFIX)) target.removeAttribute(attr.name);
			}
		});
	}

	/* --- Note footer toggles ---------------------------------------------
	   A bar pinned to the bottom of each note pane with a checkbox per
	   boolean property, so a note can be marked done/read without opening
	   the properties panel. Shown in every note while "Offer marking in
	   every note" is on; otherwise only when the note's frontmatter already
	   has a property with a true/false value. */

	// Properties known to the vault (lowercased name → { name, type }), so a
	// done-marker can be offered in notes that do not have the property yet.
	// The type is undefined when none is assigned/inferred: it may simply
	// not be registered (e.g. the property was written by a script).
	vaultProperties() {
		// Current builds keep the index on the (undocumented)
		// metadataTypeManager; the older metadataCache.getAllPropertyInfos is
		// deprecated there and logs an error on every call.
		const manager = this.app.metadataTypeManager;
		const infos = (manager?.getAllProperties
			? manager.getAllProperties()
			: this.app.metadataCache.getAllPropertyInfos?.()) || {};
		const props = new Map();
		for (const [key, info] of Object.entries(infos)) {
			if (!info) continue;
			// The shape differs across Obsidian versions: { name, type, count },
			// then { name, widget, occurrences }, now { name, widget } with no
			// count — every entry is then a property in use or with an
			// assigned type.
			const count = info.count ?? info.occurrences;
			if (typeof count === 'number' && count <= 0) continue;
			props.set(key.toLowerCase(), { name: info.name || key, type: info.type ?? info.widget });
		}
		return props;
	}

	footerTogglesFor(frontmatter) {
		const fm = frontmatter || {};
		const seen = new Set();
		const toggles = [];
		const add = (property, value) => {
			const key = property.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			toggles.push([property, value]);
		};
		if (this.settings.footerAllBooleans) {
			for (const [property, value] of Object.entries(fm)) {
				if (typeof value === 'boolean') add(property, value);
			}
		} else {
			for (const property of this.settings.footerProperties) {
				const key = frontmatterKey(fm, property);
				if (key !== undefined && typeof fm[key] === 'boolean') add(key, fm[key]);
			}
		}
		// Done-markers used in the vault are offered even when the note does
		// not have the property yet; the first click creates it. In a vault
		// where none is used yet, the first marker that is not taken by a
		// non-checkbox property is offered, so every note has a toggle right
		// after install.
		if (this.settings.footerEverywhere) {
			const vault = this.vaultProperties();
			let offered = this.settings.doneProperties.filter((p) => {
				const info = vault.get(p.toLowerCase());
				return info && (!info.type || info.type === 'checkbox');
			});
			if (offered.length === 0) {
				offered = this.settings.doneProperties.filter((p) => !vault.has(p.toLowerCase())).slice(0, 1);
			}
			for (const marker of offered) {
				// Keep the spelling the note (or else the vault) already uses,
				// so a click never adds a second `Read` next to `read`
				const property = frontmatterKey(fm, marker) ?? vault.get(marker.toLowerCase())?.name ?? marker;
				add(property, fm[property] === true);
			}
		}
		return toggles;
	}

	updateFooters() {
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => this.updateFooter(leaf.view));
	}

	updateFooter(view) {
		const container = view.contentEl;
		if (!container) return;
		let footer = container.querySelector(':scope > .epa-footer');
		const file = view.file;
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		const toggles = file ? this.footerTogglesFor(frontmatter) : [];
		if (toggles.length === 0) {
			if (footer) footer.remove();
			return;
		}
		// Metadata updates arrive while typing in any note: when the note and
		// its set of toggles are unchanged, only sync the checkboxes instead
		// of rebuilding, so the footer keeps its focus and hover state.
		const key = JSON.stringify([file.path, toggles.map(([property]) => property)]);
		if (footer && footer.dataset.key === key) {
			footer.querySelectorAll('input').forEach((checkbox, i) => {
				checkbox.checked = toggles[i][1];
			});
			return;
		}
		if (!footer) footer = container.createDiv({ cls: 'epa-footer' });
		footer.empty();
		footer.dataset.key = key;
		for (const [property, value] of toggles) {
			const label = footer.createEl('label', { cls: 'epa-footer-toggle' });
			const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
			checkbox.checked = value;
			label.createSpan({ text: property });
			checkbox.addEventListener('change', async () => {
				const checked = checkbox.checked;
				try {
					await this.app.fileManager.processFrontMatter(file, (fm) => {
						fm[property] = checked;
					});
				} catch (e) {
					// E.g. malformed YAML: show the real state, not the click
					checkbox.checked = !checked;
					new Notice(`Mark as Read: could not update "${property}" in ${file.basename}: ${e.message}`);
				}
			});
		}
	}

	removeFooters() {
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			leaf.view.contentEl?.querySelector(':scope > .epa-footer')?.remove();
		});
	}
};

class ExplorerPropertyAttributesSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Gray out finished notes')
			.setDesc(
				'Comma-separated list of checkbox properties. A note is grayed out ' +
				'in the file explorer (with a green checkmark) while any of them ' +
				'is true. Clear the list to turn the built-in styling off.'
			)
			.addText((text) =>
				text
					.setPlaceholder('read, done')
					.setValue(this.plugin.settings.doneProperties.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.doneProperties = splitList(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Expose all properties')
			.setDesc(
				'Every frontmatter property becomes a data-link-<name> attribute on ' +
				'file-explorer items, which you can target from a CSS snippet. ' +
				'Turn off to expose only the properties listed below.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allProperties).onChange(async (value) => {
					this.plugin.settings.allProperties = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Properties')
			.setDesc(
				'Comma-separated list of frontmatter properties to expose when ' +
				'"Expose all properties" is off.'
			)
			.addText((text) =>
				text
					.setPlaceholder('status, priority')
					.setValue(this.plugin.settings.properties.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.properties = splitList(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Offer marking in every note')
			.setDesc(
				'Every note gets a footer toggle for the finished-note properties ' +
				'above that are used in the vault (or for the first of them when ' +
				'none is used yet), even before the note has the property — the ' +
				'first click creates it.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.footerEverywhere).onChange(async (value) => {
					this.plugin.settings.footerEverywhere = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Footer toggle for every checkbox property')
			.setDesc(
				'Notes with a true/false property get a bar at the bottom of the ' +
				'pane with a checkbox per property — mark a note read or done ' +
				'without scrolling to the top. Clicking writes straight to the ' +
				'frontmatter. Turn off to show only the properties listed below.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.footerAllBooleans).onChange(async (value) => {
					this.plugin.settings.footerAllBooleans = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Note footer toggles')
			.setDesc(
				'Comma-separated list of true/false properties to show in the ' +
				'footer bar when the toggle above is off.'
			)
			.addText((text) =>
				text
					.setPlaceholder('read, done')
					.setValue(this.plugin.settings.footerProperties.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.footerProperties = splitList(value);
						await this.plugin.saveSettings();
					})
			);
	}
}

// The note's own key for `property`: an exact match, else a case-insensitive
// one (Obsidian treats property names case-insensitively, YAML does not).
function frontmatterKey(frontmatter, property) {
	if (Object.prototype.hasOwnProperty.call(frontmatter, property)) return property;
	const lower = property.toLowerCase();
	return Object.keys(frontmatter).find((key) => key.toLowerCase() === lower);
}

function splitList(value) {
	return value
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}
