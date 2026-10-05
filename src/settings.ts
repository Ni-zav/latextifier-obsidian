import { App, PluginSettingTab, Setting } from "obsidian";
import type LatextifierPlugin from "./main";
import type { Engine, LatextifierSettings } from "./types";

export const DEFAULT_SETTINGS: LatextifierSettings = {
  compileDebounceMs: 400,
  autoCompile: true,
  defaultEngine: "pdflatex",
  fragmentEngine: "pdflatex",
  texBinDir: "",
  latexmkPath: "",
  synctexPath: "",
  dvisvgmPath: "",
  fragmentPreamble: "",
  previewVisibleByDefault: true,
  continuousSyncByDefault: true,
  navigatorVisibleByDefault: true,
  autoCloseEnvironment: true,
  autoContinueItems: true,
  enableTexlab: true,
  texlabPath: "",
  allowShellEscape: false
};

export class LatextifierSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: LatextifierPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Rendering").setHeading();

    new Setting(containerEl)
      .setName("Compile while typing")
      .setDesc("Save and request a coalesced TeX build after the typing debounce.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoCompile)
        .onChange(async (value) => {
          this.plugin.settings.autoCompile = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Compile debounce")
      .setDesc("Delay after the latest edit before saving and compiling.")
      .addSlider((slider) => slider
        .setLimits(100, 2000, 50)
        .setValue(this.plugin.settings.compileDebounceMs)
        .onChange(async (value) => {
          this.plugin.settings.compileDebounceMs = value;
          await this.plugin.saveSettings();
        }));

    engineSetting(containerEl, "Default project engine", this.plugin.settings.defaultEngine, async (value) => {
      this.plugin.settings.defaultEngine = value;
      await this.plugin.saveSettings();
    });

    engineSetting(containerEl, "Markdown fragment engine", this.plugin.settings.fragmentEngine, async (value) => {
      this.plugin.settings.fragmentEngine = value;
      await this.plugin.saveSettings();
      this.plugin.onFragmentSettingsChanged();
    });

    new Setting(containerEl)
      .setName("TeX binary directory")
      .setDesc("Optional directory prepended to PATH, for example /Library/TeX/texbin.")
      .addText((text) => text
        .setPlaceholder("Use system PATH")
        .setValue(this.plugin.settings.texBinDir)
        .onChange(async (value) => {
          this.plugin.settings.texBinDir = value.trim();
          await this.plugin.saveSettings();
          this.plugin.onFragmentSettingsChanged();
        }));

    pathSetting(containerEl, "latexmk executable", this.plugin.settings.latexmkPath, async (value) => {
      this.plugin.settings.latexmkPath = value;
      await this.plugin.saveSettings();
    });

    pathSetting(containerEl, "SyncTeX executable", this.plugin.settings.synctexPath, async (value) => {
      this.plugin.settings.synctexPath = value;
      await this.plugin.saveSettings();
    });

    pathSetting(containerEl, "dvisvgm executable", this.plugin.settings.dvisvgmPath, async (value) => {
      this.plugin.settings.dvisvgmPath = value;
      await this.plugin.saveSettings();
      this.plugin.onFragmentSettingsChanged();
    });

    new Setting(containerEl)
      .setName("Fragment preamble")
      .setDesc("Extra packages/macros inserted into compiled Markdown LaTeX blocks.")
      .addTextArea((text) => text
        .setPlaceholder("\\usepackage{physics}")
        .setValue(this.plugin.settings.fragmentPreamble)
        .onChange(async (value) => {
          this.plugin.settings.fragmentPreamble = value;
          await this.plugin.saveSettings();
          this.plugin.onFragmentSettingsChanged();
        }));

    new Setting(containerEl)
      .setName("Show PDF preview by default")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.previewVisibleByDefault)
        .onChange(async (value) => {
          this.plugin.settings.previewVisibleByDefault = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("Editing intelligence").setHeading();

    new Setting(containerEl)
      .setName("Continuous source and PDF sync")
      .setDesc("Keep the source and PDF panes synchronized while scrolling using SyncTeX.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.continuousSyncByDefault)
        .onChange(async (value) => {
          this.plugin.settings.continuousSyncByDefault = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Show project navigator by default")
      .setDesc("Show structure, TODOs, project files, references, and citations beside the editor.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.navigatorVisibleByDefault)
        .onChange(async (value) => {
          this.plugin.settings.navigatorVisibleByDefault = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Auto-close environments")
      .setDesc("Insert a matching end environment when completing a begin environment.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoCloseEnvironment)
        .onChange(async (value) => {
          this.plugin.settings.autoCloseEnvironment = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Continue list items")
      .setDesc("Press Enter after an item to insert the next item with matching indentation.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoContinueItems)
        .onChange(async (value) => {
          this.plugin.settings.autoContinueItems = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("TexLab").setHeading();

    new Setting(containerEl)
      .setName("Enable TexLab")
      .setDesc("Use TexLab when installed for language-server completions, hover, and diagnostics. Built-in project intelligence remains available without it.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableTexlab)
        .onChange(async (value) => {
          this.plugin.settings.enableTexlab = value;
          await this.plugin.saveSettings();
        }));

    pathSetting(containerEl, "TexLab executable", this.plugin.settings.texlabPath, async (value) => {
      this.plugin.settings.texlabPath = value;
      await this.plugin.saveSettings();
    });

    new Setting(containerEl).setName("Security").setHeading();

    new Setting(containerEl)
      .setName("Allow TeX shell escape")
      .setDesc("Off by default. Enabling this lets trusted TeX documents execute external commands.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.allowShellEscape)
        .onChange(async (value) => {
          this.plugin.settings.allowShellEscape = value;
          await this.plugin.saveSettings();
          this.plugin.onFragmentSettingsChanged();
        }));
  }
}

function engineSetting(
  container: HTMLElement,
  name: string,
  value: Engine,
  change: (value: Engine) => Promise<void>
): void {
  new Setting(container)
    .setName(name)
    .addDropdown((dropdown) => dropdown
      .addOption("pdflatex", "pdfLaTeX")
      .addOption("xelatex", "XeLaTeX")
      .addOption("lualatex", "LuaLaTeX")
      .setValue(value)
      .onChange(async (next) => {
        await change(next as Engine);
      }));
}

function pathSetting(
  container: HTMLElement,
  name: string,
  value: string,
  change: (value: string) => Promise<void>
): void {
  new Setting(container)
    .setName(name)
    .setDesc("Leave blank to resolve it from PATH.")
    .addText((text) => text
      .setPlaceholder("Use PATH")
      .setValue(value)
      .onChange(async (next) => {
        await change(next.trim());
      }));
}
