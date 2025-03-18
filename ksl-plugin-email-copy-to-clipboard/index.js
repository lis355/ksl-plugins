import { config as dotenv } from "dotenv-flow";

dotenv({ path: import.meta.dirname });

const EMAILS = process.env.EMAILS.split(",").filter(Boolean);

export default class KslPluginEmailCopyToClipboard {
	async load(pluginsManager) {
		this.pluginsManager = pluginsManager;
	}

	async unload() { }

	query(query, queryOptionsReceiver) {
		const queryTextLower = query.text.toLowerCase();
		if (queryTextLower.startsWith("email")) {
			EMAILS.forEach(email => {
				queryOptionsReceiver(this, {
					query,
					text: email,
					meta: {
						description: "copy to clipboard",
						match: 1
					}
				});
			});
		}
	}

	execute(queryOption) {
		this.pluginsManager.electron.clipboard.writeText(queryOption.text);
	}
};
