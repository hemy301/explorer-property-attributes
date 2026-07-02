/* Explorer Property Attributes
   Exposes frontmatter properties as data attributes on file-explorer items,
   so CSS snippets can style notes by property values.

   For a note with `status: done` in its frontmatter (and "status" listed in
   the plugin settings), the file-explorer title element gets:
       data-link-status="done"
   The attribute format is compatible with Supercharged Links, so existing
   CSS snippets written for it keep working — but unlike Supercharged Links,
   the explorer is updated instantly when a property changes, not only when
   the explorer DOM happens to be rebuilt. */

const { Plugin, PluginSettingTab, Setting, debounce } = require('obsidian');

const ATTR_PREFIX = 'data-link-';

const DEFAULT_SETTINGS = {
	properties: [],
};

module.exports = class ExplorerPropertyAttributes extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// Attribute names ever applied in this session, so settings changes
		// and unload can clean up attributes that are no longer configured.
		this.appliedAttrs = new Set();
		this.observers = [];

		this.addSettingTab(new ExplorerPropertyAttributesSettingTab(this.app, this));

		this.decorateAllDebounced = debounce(() => this.decorateAll(), 100, true);

		this.app.workspace.onLayoutReady(() => {
			this.decorateAll();
			this.watchExplorers();
		});

		// Instant reaction to property edits (properties pane, plugins, external sync)
		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.decorateOne(file.path)));
		// Startup indexing can finish after the first paint
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.decorateAllDebounced()));
		this.registerEvent(this.app.vault.on('rename', () => this.decorateAllDebounced()));
		// New explorer leaves can appear (e.g. moved to another split)
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.watchExplorers();
			this.decorateAllDebounced();
		}));
	}

	onunload() {
		this.disconnectObservers();
		this.clearAll();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.clearAll();
		this.decorateAll();
	}

	attrFor(property) {
		// Attribute names cannot contain whitespace; mirror Supercharged Links
		// (spaces → hyphens). Non-ASCII property names are valid in HTML.
		return ATTR_PREFIX + property.replace(/\s/g, '-');
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
		return String(value);
	}

	decorateEl(el) {
		const path = el.getAttribute('data-path');
		if (!path || !path.endsWith('.md')) return;
		const target = el.querySelector('.nav-file-title-content');
		if (!target) return;
		const file = this.app.vault.getFileByPath(path);
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		for (const property of this.settings.properties) {
			const attr = this.attrFor(property);
			const value = this.formatValue(frontmatter ? frontmatter[property] : undefined);
			try {
				if (value === undefined) target.removeAttribute(attr);
				else if (target.getAttribute(attr) !== value) target.setAttribute(attr, value);
				this.appliedAttrs.add(attr);
			} catch (e) {
				// Property name not expressible as an attribute name — skip it
			}
		}
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
			const target = el.querySelector('.nav-file-title-content');
			if (!target) return;
			this.appliedAttrs.forEach((attr) => target.removeAttribute(attr));
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
			.setName('Properties')
			.setDesc(
				'Comma-separated list of frontmatter properties to expose. ' +
				'Each property "x" becomes a data-link-x attribute on file-explorer items, ' +
				'which you can target from a CSS snippet.'
			)
			.addText((text) =>
				text
					.setPlaceholder('status, priority')
					.setValue(this.plugin.settings.properties.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.properties = value
							.split(',')
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
					})
			);
	}
}
