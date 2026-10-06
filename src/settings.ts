import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type LatextifierPlugin from "./main";
import type { LatextifierSettings } from "./types";

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
  liveLatexByDefault: true,
  autoCloseEnvironment: true,
  autoContinueItems: true,
  enableTexlab: true,
  texlabPath: "",
  allowShellEscape: false
};

type SettingKey = keyof LatextifierSettings;

export class LatextifierSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly latextifier: LatextifierPlugin) {
    super(app, latextifier);
  }

  getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return [
      {
        type: "group",
        heading: "Rendering",
        items: [
          {
            name: "Compile while typing",
            desc: "Save and request a coalesced build after the typing debounce.",
            control: { type: "toggle", key: "autoCompile", defaultValue: true }
          },
          {
            name: "Compile debounce",
            desc: "Delay after the latest edit before saving and compiling.",
            control: {
              type: "slider",
              key: "compileDebounceMs",
              min: 100,
              max: 2000,
              step: 50,
              defaultValue: 400
            }
          },
          {
            name: "Default project engine",
            control: {
              type: "dropdown",
              key: "defaultEngine",
              defaultValue: "pdflatex",
              options: {
                pdflatex: "pdfLaTeX",
                xelatex: "XeLaTeX",
                lualatex: "LuaLaTeX"
              }
            }
          },
          {
            name: "Markdown fragment engine",
            control: {
              type: "dropdown",
              key: "fragmentEngine",
              defaultValue: "pdflatex",
              options: {
                pdflatex: "pdfLaTeX",
                xelatex: "XeLaTeX",
                lualatex: "LuaLaTeX"
              }
            }
          },
          {
            name: "TeX binary directory",
            desc: "Optional directory prepended to PATH, for example /Library/TeX/texbin.",
            aliases: ["PATH", "MacTeX", "TeX Live"],
            control: {
              type: "text",
              key: "texBinDir",
              placeholder: "Use system PATH",
              defaultValue: ""
            }
          },
          {
            name: "latexmk executable",
            desc: "Leave blank to resolve latexmk from PATH.",
            control: { type: "text", key: "latexmkPath", placeholder: "Use PATH", defaultValue: "" }
          },
          {
            name: "SyncTeX executable",
            desc: "Leave blank to resolve SyncTeX from PATH.",
            control: { type: "text", key: "synctexPath", placeholder: "Use PATH", defaultValue: "" }
          },
          {
            name: "dvisvgm executable",
            desc: "Optional converter used for crisp SVG fragment output.",
            control: { type: "text", key: "dvisvgmPath", placeholder: "Use PATH", defaultValue: "" }
          },
          {
            name: "Fragment preamble",
            desc: "Extra packages and macros inserted into compiled Markdown LaTeX blocks.",
            control: {
              type: "textarea",
              key: "fragmentPreamble",
              placeholder: "\\usepackage{physics}",
              rows: 6,
              defaultValue: ""
            }
          },
          {
            name: "Show PDF preview by default",
            control: { type: "toggle", key: "previewVisibleByDefault", defaultValue: true }
          }
        ]
      },
      {
        type: "group",
        heading: "Editing intelligence",
        items: [
          {
            name: "Continuous source and PDF sync",
            desc: "Keep source and PDF panes synchronized while scrolling using SyncTeX.",
            control: { type: "toggle", key: "continuousSyncByDefault", defaultValue: true }
          },
          {
            name: "Show project navigator by default",
            desc: "Show structure, TODOs, project files, references, and citations beside the editor.",
            control: { type: "toggle", key: "navigatorVisibleByDefault", defaultValue: true }
          },
          {
            name: "Live LaTeX reading",
            desc: "Render visible math, theorem blocks, references, TikZ, and tables until the cursor enters them.",
            control: { type: "toggle", key: "liveLatexByDefault", defaultValue: true }
          },
          {
            name: "Auto-close environments",
            desc: "Insert a matching end environment when completing or entering a begin environment.",
            control: { type: "toggle", key: "autoCloseEnvironment", defaultValue: true }
          },
          {
            name: "Continue list items",
            desc: "Press Enter after an item to insert the next item with matching indentation.",
            control: { type: "toggle", key: "autoContinueItems", defaultValue: true }
          }
        ]
      },
      {
        type: "group",
        heading: "Language server",
        items: [
          {
            name: "Enable TexLab",
            desc: "Use TexLab when installed for LSP completion, snippets, hover, and diagnostics. Built-in project intelligence remains available without it.",
            aliases: ["LSP", "language server"],
            control: { type: "toggle", key: "enableTexlab", defaultValue: true }
          },
          {
            name: "TexLab executable",
            desc: "Leave blank to resolve TexLab from PATH.",
            aliases: ["LSP"],
            visible: () => this.latextifier.settings.enableTexlab,
            control: { type: "text", key: "texlabPath", placeholder: "Use PATH", defaultValue: "" }
          }
        ]
      },
      {
        type: "group",
        heading: "Security",
        items: [
          {
            name: "Allow TeX shell escape",
            desc: "Off by default. Enabling this lets trusted TeX documents execute external commands.",
            control: { type: "toggle", key: "allowShellEscape", defaultValue: false }
          }
        ]
      }
    ];
  }

  override getControlValue(key: SettingKey): unknown {
    return this.latextifier.settings[key];
  }

  override async setControlValue(key: SettingKey, value: unknown): Promise<void> {
    const settings = this.latextifier.settings as unknown as Record<SettingKey, unknown>;
    settings[key] = value;
    await this.latextifier.saveSettings();

    if (
      key === "fragmentEngine"
      || key === "texBinDir"
      || key === "dvisvgmPath"
      || key === "fragmentPreamble"
      || key === "allowShellEscape"
    ) {
      this.latextifier.onFragmentSettingsChanged();
    }
  }
}
