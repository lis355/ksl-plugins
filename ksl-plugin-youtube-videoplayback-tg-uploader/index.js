import { spawn } from "node:child_process";
import path from "node:path";

const COMMAND = "yvid";

export default class KslPluginYoutubeVideoplaybackTgUploader {
	async load(pluginsManager) {
		this.pluginsManager = pluginsManager;
	}

	async unload() { }

	query(query, queryOptionsReceiver) {
		if (query.text.toLowerCase().startsWith(COMMAND)) {
			queryOptionsReceiver(this, {
				query,
				text: "Run youtube downloader and converter",
				meta: {
					match: 1
				}
			});
		}
	}

	execute(queryOption) {
		spawn("node", [path.resolve(import.meta.dirname, "youtube.js")], {
			shell: true,
			detached: true,
			stdio: "ignore",
			env: { NODE_NO_WARNINGS: "1" },
			cwd: import.meta.dirname
		}).unref();
	}
};
