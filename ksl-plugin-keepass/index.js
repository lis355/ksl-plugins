import fs from "node:fs";

import { config as dotenv } from "dotenv-flow";
import kdbxweb from "kdbxweb";

dotenv({ path: import.meta.dirname });

export default class KslPluginKeepass {
	async load(pluginsManager) {
		this.pluginsManager = pluginsManager;

		const credentials = new kdbxweb.Credentials();
		await credentials.setPassword(kdbxweb.ProtectedValue.fromString(process.env.DB_MASTER_PASSWORD));
		// await credentials.setKeyFile(fs.readFileSync(DB_KEY_FILE_PATH));

		const kdbxFileData = fs.readFileSync(process.env.DB_FILE_PATH);
		this.db = await kdbxweb.Kdbx.load(new Uint8Array(kdbxFileData).buffer, credentials);
	}

	async unload() { }

	query(query, queryOptionsReceiver) {
		const queryTextLower = query.text.toLowerCase();
		if (queryTextLower.startsWith("kee ")) {
			const pattern = queryTextLower.substring("kee ".length).trim();
			this.searchEntries(pattern)
				.entries
				.slice(0, Number(process.env.MAX_ENTRIES_COUNT))
				.forEach(entry => {
					const title = `${entry.fields.get("Title")} (${entry.parentGroup.name})`;
					const username = entry.fields.get("UserName");

					queryOptionsReceiver(this, {
						query,
						text: `[${title}] ${username}`,
						meta: {
							description: "copy username to clipboard",
							match: 1,
							copyText: username
						}
					});

					const passwordField = entry.fields.get("Password");
					const password = passwordField.getText ? passwordField.getText() : passwordField;

					queryOptionsReceiver(this, {
						query,
						text: `[${title}] ${password}`,
						meta: {
							description: "copy password to clipboard",
							match: 1,
							copyText: password
						}
					});
				});
		}
	}

	execute(queryOption) {
		const parts = queryOption.text.split(" ");

		this.pluginsManager.electron.clipboard.writeText(parts[parts.length - 1]);
	}

	recursiveVisitGroup(group, visitor) {
		const result = visitor(group);
		if (result &&
			result.stop) return;

		for (const childGroup of group.groups) {
			if (childGroup.uuid.equals(this.db.meta.recycleBinUuid)) continue;

			this.recursiveVisitGroup(childGroup, visitor);
		}
	}

	searchEntries(pattern) {
		const patternsInLowerCase = pattern.split(" ")
			.map(s => s.trim().toLowerCase())

			.map(s =>
				s.startsWith("(") &&
					s.endsWith(")")
					? s.substring(1, s.length - 1)
					: s
			)
			.filter(Boolean);

		const searchEntriesResult = {
			entries: []
		};

		this.recursiveVisitGroup(this.db.getDefaultGroup(), group => {
			const groupNameInLowerCase = group.name.toLowerCase();

			for (const entry of group.entries) {
				const titleInLowerCase = entry.fields.get("Title").toLowerCase();

				const isMatch = patternsInLowerCase
					.every(patternInLowerCase => {
						if (groupNameInLowerCase.includes(patternInLowerCase)) return true;

						if (titleInLowerCase.includes(patternInLowerCase)) return true;

						return false;
					});

				if (isMatch) searchEntriesResult.entries.push(entry);
			}
		});

		return searchEntriesResult;
	}
};
