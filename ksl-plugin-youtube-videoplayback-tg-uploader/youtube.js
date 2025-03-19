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

const TELEGRAM_MAXIMUM_FILE_SIZE_IN_BYTES = 50 * 1024 ** 2;

dotenv({ path: import.meta.dirname });

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

async function readLine() {
	return new Promise(resolve => rl.once("line", resolve));
}

async function readAnswer() {
	let line;
	do {
		line = (await readLine()).toLowerCase();
	} while (line !== "y" &&
		line !== "n");

	return line === "y";
}

function exit() {
	console.log("Press any key...");

	process.stdin
		.setRawMode(true)
		.resume()
		.on("data", () => process.exit(0));
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
	return Number(x.toFixed(2));
}

function formatSizeInBytes(x) {
	return formatNumber(x / 1024 ** 2);
}

async function run() {
	if (!process.env.FFMPEG_PATH || !fs.existsSync(process.env.FFMPEG_PATH)) return printErrorAndExit(new Error("Bad FFMPEG_PATH"));
	if (!process.env.TELEGRAM_BOT_TOKEN) return printErrorAndExit(new Error("Bad TELEGRAM_BOT_TOKEN"));
	if (!process.env.TELEGRAM_CHAT_ID || !Number.isFinite(Number(process.env.TELEGRAM_CHAT_ID))) return printErrorAndExit(new Error("Bad TELEGRAM_CHAT_ID"));
	if (!process.env.LOCAL_DIRECTORY || !fs.existsSync(process.env.LOCAL_DIRECTORY)) return printErrorAndExit(new Error("Bad LOCAL_DIRECTORY"));

	let line;

	console.clear();

	const { name, version } = JSON.parse(fs.readFileSync("package.json"));
	console.log(`${name} v${version}`);
	console.log();

	console.log("Type video file link...");
	line = await readLine();

	let videoUrl, durationInSeconds;
	try {
		videoUrl = new URL(line);

		if (videoUrl.searchParams.get("mime") !== "video/mp4") throw new Error("Bad url video format, expected video/mp4");
		durationInSeconds = Number(videoUrl.searchParams.get("dur"));
		if (!Number.isFinite(durationInSeconds)) throw new Error("No video duration on this url");
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

	console.log(`Video file size is ${formatSizeInBytes(totalBytesAmount)} Mb`);
	console.log(`Video file duration is ${formatNumber(durationInSeconds / 60)} minutes`);

	console.log("Type video file name...");
	line = await readLine();
	let fileName = filenamify(line);

	console.log("Extract only audio? (y/n)");
	const isExtractAudio = await readAnswer();

	console.log("Keep file on disk? (y/n)");
	let isKeepFileOnDisk = await readAnswer();

	const extension = isExtractAudio ? ".mp3" : ".mp4";
	if (path.extname(fileName).toLowerCase() !== extension) fileName += extension;

	const downloadProgressBar = new cliProgress.SingleBar({
		format: "{bar} | {percentage}% || {value}/{total} Mb",
		barCompleteChar: "\u2588",
		barIncompleteChar: "\u2591",
		hideCursor: true
	});

	const responseBodyStream = Readable.fromWeb(response.body);

	let stream = responseBodyStream
		.pipe(
			createProgressStream(downloadedBytesAmount => {
				downloadProgressBar.update(formatSizeInBytes(downloadedBytesAmount));
			})
				.once("data", () => {
					console.log(`Downloading video file ${fileName}`);

					downloadProgressBar.start(formatSizeInBytes(totalBytesAmount), 0);
				})
				.once("close", () => {
					downloadProgressBar.update(formatSizeInBytes(totalBytesAmount));
					downloadProgressBar.stop();

					console.log("Downloading finished");
				})
		);

	const streamToUpload = new PassThrough()
		.once("data", () => {
		})
		.once("close", () => {
			console.log("Uploading finished");
		});

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

	const fileLocalPath = path.resolve(process.env.LOCAL_DIRECTORY, fileName);
	await finished(stream
		.pipe(fs.createWriteStream(fileLocalPath))
	);

	if (fs.statSync(fileLocalPath).size < TELEGRAM_MAXIMUM_FILE_SIZE_IN_BYTES) {
		const telegramBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
		const telegramSendMethod = (isExtractAudio ? telegramBot.telegram.sendAudio : telegramBot.telegram.sendDocument).bind(telegramBot.telegram);

		console.log(`Start uploading file ${fileName}`);

		await telegramSendMethod(Number(process.env.TELEGRAM_CHAT_ID), Input.fromReadableStream(streamToUpload, fileName));

		console.log(`Finish uploading file ${fileName}`);
	} else {
		isKeepFileOnDisk = true;
	}

	if (isKeepFileOnDisk) spawn("explorer", [process.env.LOCAL_DIRECTORY.replaceAll("/", "\\")]);
	else fs.unlinkSync(fileName);

	return exit();
}

run();
