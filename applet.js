/**
 * Claude Usage — Cinnamon panel applet
 *
 * Shows how much of the Claude Code 5-hour rolling window and weekly budget
 * has been used, by parsing ~/.claude/projects/**\/*.jsonl through the bundled
 * Python helper at scripts/usage.py.
 */

const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;

const UUID = "claude-usage@jakob";
const HOME_DIR = GLib.get_home_dir();
const APPLET_DIR = `${HOME_DIR}/.local/share/cinnamon/applets/${UUID}`;
const HELPER = `${APPLET_DIR}/scripts/usage.py`;

function MyApplet(orientation, panelHeight, instanceId) {
    this._init(orientation, panelHeight, instanceId);
}

MyApplet.prototype = {
    __proto__: Applet.TextApplet.prototype,

    _init: function (orientation, panelHeight, instanceId) {
        Applet.TextApplet.prototype._init.call(this, orientation, panelHeight, instanceId);

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind("refresh-interval", "refreshInterval", () => this._restartTimer());
        this.settings.bind("limit-5h", "limit5h", () => this._refresh());
        this.settings.bind("limit-week", "limitWeek", () => this._refresh());

        this.set_applet_label("Claude …");
        this.set_applet_tooltip("Claude Usage — loading");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._buildMenuSkeleton();

        this._timerId = 0;
        this._proc = null;
        this._refresh();
        this._restartTimer();
    },

    _buildMenuSkeleton: function () {
        this._blockHeader = new PopupMenu.PopupMenuItem("5h window", { reactive: false });
        this._blockHeader.label.set_style("font-weight: bold;");
        this.menu.addMenuItem(this._blockHeader);
        this._blockLine1 = new PopupMenu.PopupMenuItem("…", { reactive: false });
        this._blockLine2 = new PopupMenu.PopupMenuItem("…", { reactive: false });
        this._blockLine3 = new PopupMenu.PopupMenuItem("…", { reactive: false });
        this.menu.addMenuItem(this._blockLine1);
        this.menu.addMenuItem(this._blockLine2);
        this.menu.addMenuItem(this._blockLine3);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._weekHeader = new PopupMenu.PopupMenuItem("This week", { reactive: false });
        this._weekHeader.label.set_style("font-weight: bold;");
        this.menu.addMenuItem(this._weekHeader);
        this._weekLine1 = new PopupMenu.PopupMenuItem("…", { reactive: false });
        this._weekLine2 = new PopupMenu.PopupMenuItem("…", { reactive: false });
        this.menu.addMenuItem(this._weekLine1);
        this.menu.addMenuItem(this._weekLine2);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._modelsHeader = new PopupMenu.PopupMenuItem("Per-model (this block)", { reactive: false });
        this._modelsHeader.label.set_style("font-weight: bold;");
        this.menu.addMenuItem(this._modelsHeader);
        this._modelItems = [];

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem("Refresh now");
        refreshItem.connect("activate", () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        const settingsItem = new PopupMenu.PopupMenuItem("Settings…");
        settingsItem.connect("activate", () => {
            Util.spawnCommandLine(`cinnamon-settings applets ${UUID}`);
        });
        this.menu.addMenuItem(settingsItem);
    },

    _restartTimer: function () {
        if (this._timerId) {
            Mainloop.source_remove(this._timerId);
            this._timerId = 0;
        }
        const interval = Math.max(15, Number(this.refreshInterval) || 60);
        this._timerId = Mainloop.timeout_add_seconds(interval, () => {
            this._refresh();
            return true;
        });
    },

    _refresh: function () {
        const env = [
            `CLAUDE_LIMIT_5H=${Math.max(1, Number(this.limit5h) || 0)}`,
            `CLAUDE_LIMIT_WEEK=${Math.max(1, Number(this.limitWeek) || 0)}`,
        ];

        try {
            const proc = Gio.Subprocess.new(
                ["/usr/bin/env", ...env, "python3", HELPER],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout, stderr] = p.communicate_utf8_finish(res);
                    if (!p.get_successful()) {
                        this._renderError(stderr || "helper exited non-zero");
                        return;
                    }
                    let data;
                    try {
                        data = JSON.parse(stdout);
                    } catch (e) {
                        this._renderError(`bad JSON: ${e.message}`);
                        return;
                    }
                    this._render(data);
                } catch (e) {
                    this._renderError(e.message);
                }
            });
        } catch (e) {
            this._renderError(e.message);
        }
    },

    _renderError: function (msg) {
        this.set_applet_label("Claude ⚠");
        this.set_applet_tooltip(`Claude Usage error: ${msg}`);
    },

    _render: function (data) {
        const block = data.block || {};
        const week = data.week || {};
        const limit5h = Number(data.limit_5h) || 1;
        const limitWeek = Number(data.limit_week) || 1;

        const blockWeighted = Number(block.weighted) || 0;
        const blockPct = Math.round((blockWeighted / limit5h) * 100);

        let label;
        let timeLeft = "";
        if (block.active && block.reset_at) {
            const resetMs = Date.parse(block.reset_at);
            const nowMs = Date.now();
            const remainingMs = Math.max(0, resetMs - nowMs);
            timeLeft = formatDuration(remainingMs);
            label = `Claude ${blockPct}% · ${timeLeft}`;
        } else {
            label = "Claude idle";
        }
        this.set_applet_label(label);

        const weekWeighted = Number(week.weighted) || 0;
        const weekPct = Math.round((weekWeighted / limitWeek) * 100);

        this.set_applet_tooltip(
            `5h: ${formatTokens(blockWeighted)} / ${formatTokens(limit5h)} (${blockPct}%)` +
            (block.active ? `, ${timeLeft} left` : ", idle") +
            `\nWeek: ${formatTokens(weekWeighted)} / ${formatTokens(limitWeek)} (${weekPct}%)`
        );

        if (block.active) {
            this._blockLine1.label.set_text(
                `Used: ${formatTokens(blockWeighted)} / ${formatTokens(limit5h)}  (${blockPct}%)`
            );
            this._blockLine2.label.set_text(
                `Raw tokens: ${formatTokens(Number(block.raw) || 0)}`
            );
            this._blockLine3.label.set_text(
                `Resets at ${formatLocalTime(block.reset_at)}  (in ${timeLeft})`
            );
        } else {
            this._blockLine1.label.set_text("No active block (idle ≥ 5h).");
            this._blockLine2.label.set_text("");
            this._blockLine3.label.set_text("");
        }

        this._weekLine1.label.set_text(
            `Used: ${formatTokens(weekWeighted)} / ${formatTokens(limitWeek)}  (${weekPct}%)`
        );
        this._weekLine2.label.set_text(
            `Raw tokens: ${formatTokens(Number(week.raw) || 0)}`
        );

        for (const it of this._modelItems) it.destroy();
        this._modelItems = [];
        const byModel = block.by_model || {};
        const models = Object.keys(byModel).sort((a, b) =>
            (byModel[b].weighted || 0) - (byModel[a].weighted || 0)
        );
        if (models.length === 0) {
            const item = new PopupMenu.PopupMenuItem("(no usage)", { reactive: false });
            this.menu.addMenuItem(item, this._menuIndexAfter(this._modelsHeader));
            this._modelItems.push(item);
        } else {
            for (let i = 0; i < models.length; i++) {
                const m = models[i];
                const v = byModel[m];
                const item = new PopupMenu.PopupMenuItem(
                    `${m}: ${formatTokens(v.weighted)} weighted  (raw ${formatTokens(v.raw)})`,
                    { reactive: false }
                );
                this.menu.addMenuItem(item, this._menuIndexAfter(this._modelsHeader) + i);
                this._modelItems.push(item);
            }
        }
    },

    _menuIndexAfter: function (item) {
        const children = this.menu.box.get_children();
        for (let i = 0; i < children.length; i++) {
            if (children[i] === item.actor) return i + 1;
        }
        return children.length;
    },

    on_applet_clicked: function () {
        this.menu.toggle();
    },

    on_applet_removed_from_panel: function () {
        if (this._timerId) {
            Mainloop.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this.settings) this.settings.finalize();
    },
};

function formatTokens(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
    return `${m}m`;
}

function formatLocalTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new MyApplet(orientation, panelHeight, instanceId);
}
