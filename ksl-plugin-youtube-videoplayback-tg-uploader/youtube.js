import { finished } from "node:stream/promises";
import { Readable, Transform, PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import { config as dotenv } from "dotenv-flow";
import { Telegraf, Input } from "telegraf";
import cliProgress from "cli-progress";
import filenamify from "filenamify";

dotenv({ path: import.meta.dirname });

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

async function readLine() {
	return new Promise(resolve => rl.once("line", resolve));
}

function exit() {
	console.log("Press any key...");

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", () => process.exit(0));
}

function printErrorAndExit(error) {
	console.error(error.message);

	return exit();
}

function createProgressStream(onProgressCallback) {
	let downloadedBytesAmount = 0;

	return new Transform({
		transform(chunk, encoding, callback) {
			if (onProgressCallback) {
				downloadedBytesAmount += chunk.length;

				onProgressCallback(downloadedBytesAmount);
			}

			callback(null, chunk);
		}
	});
}

function formatNumber(x) {
	return Number((x / 1024 ** 2).toFixed(2));
}

async function run() {
	if (!process.env.FFMPEG_PATH || !fs.existsSync(process.env.FFMPEG_PATH)) return printErrorAndExit(new Error("Bad FFMPEG_PATH"));
	if (!process.env.TELEGRAM_BOT_TOKEN) return printErrorAndExit(new Error("Bad TELEGRAM_BOT_TOKEN"));
	if (!process.env.TELEGRAM_CHAT_ID || !Number.isFinite(Number(process.env.TELEGRAM_CHAT_ID))) return printErrorAndExit(new Error("Bad TELEGRAM_CHAT_ID"));

	let line;

	console.clear();

	const { name, version } = JSON.parse(fs.readFileSync("package.json"));
	console.log(`${name} v${version}`);
	console.log();

	console.log("Type video file link...");
	line = await readLine();

	let videoUrl;
	try {
		videoUrl = new URL(line);

		if (videoUrl.searchParams.get("mime") !== "video/mp4") throw new Error("Bad url video format, expected video/mp4");
	} catch (error) {
		return printErrorAndExit(error);
	}

	let response, totalBytesAmount;
	try {
		response = await fetch(videoUrl);

		totalBytesAmount = Number(response.headers.get("content-length"));
		if (!Number.isFinite(totalBytesAmount)) throw new Error("No file on this url");
	} catch (error) {
		return printErrorAndExit(error);
	}

	console.log(`Video file size is ${formatNumber(totalBytesAmount)} Mb`);

	console.log("Type video file name...");
	line = await readLine();
	let fileName = filenamify(line);

	console.log("Extract only audio? (y/n)");
	line = "";
	do line = (await readLine()).toLowerCase(); while (line !== "y" && line !== "n");
	const isExtractAudio = line === "y";

	const extension = isExtractAudio ? ".mp3" : ".mp4";
	if (path.extname(fileName).toLowerCase() !== extension) fileName += extension;

	console.log(`Downloading video file ${fileName}`);

	const downloadProgressBar = new cliProgress.SingleBar({
		format: "{bar} | {percentage}% || {value}/{total} Mb",
		barCompleteChar: "\u2588",
		barIncompleteChar: "\u2591",
		hideCursor: true
	});

	const responseBodyStream = Readable.fromWeb(response.body);

	let stream = responseBodyStream
		.once("data", () => {
			downloadProgressBar.start(formatNumber(totalBytesAmount), 0);
		})
		.once("close", () => {
			downloadProgressBar.update(formatNumber(totalBytesAmount));
			downloadProgressBar.stop();
		})
		.pipe(createProgressStream(downloadedBytesAmount => {
			downloadProgressBar.update(formatNumber(downloadedBytesAmount));
		}));

	const streamToUpload = new PassThrough()
		.once("data", () => {
		})
		.once("close", () => {
			console.log("Uploading finished");
		});

	const telegramBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
	const telegramSendMethod = (isExtractAudio ? telegramBot.telegram.sendAudio : telegramBot.telegram.sendDocument).bind(telegramBot.telegram);
	const telegramSendFilePromise = telegramSendMethod(Number(process.env.TELEGRAM_CHAT_ID), Input.fromReadableStream(streamToUpload, fileName));

	if (isExtractAudio) {
		const converterProcess = spawn(`"${process.env.FFMPEG_PATH}" -v quiet -i pipe:0 -b:a 160k -f mp3 pipe:1`, { shell: true });

		stream
			.pipe(converterProcess.stdin);

		stream = converterProcess.stdout
			.once("data", () => {
			})
			.once("close", () => {
				console.log("Conversion finished");
			});
	}

	stream = stream
		.pipe(streamToUpload);

	await Promise.all([
		finished(stream),
		telegramSendFilePromise
	]);

	console.log(`Finish uploading file ${fileName}`);

	process.exit(0);
}

run();
