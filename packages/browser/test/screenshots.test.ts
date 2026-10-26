/**
 * The bridge from the CLI's file to the model's image.
 *
 * The CLI writes a file and answers with its path; the harness keeps images in
 * its own store. Everything between those two is this seam: the bytes are read,
 * checked against the deployment's limit, committed, and the temporary file is
 * removed — except when there is no store, when the file is the answer.
 *
 *   bun run test/screenshots.ts
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ImageStore, ScreenshotFiles } from "../src/host/screenshots";

/** A directory that goes away with the test. */
const workspace = mkdtempSync(join(tmpdir(), "dsh-browser-shots-"));

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** One file with those exact bytes. */
const fileOf = (name: string, bytes: number): string => {
	const path = join(workspace, name);

	writeFileSync(path, Buffer.alloc(bytes, 7));

	return path;
};

/** A store that records what was committed and answers a fixed reference. */
const scriptedStore = (maxImageBytes = 1_000) => {
	const saved: {
		mediaType: string;
		bytes: number;
		name: string | undefined;
	}[] = [];
	const store: ImageStore = {
		imageLimits: { maxImageBytes },
		saveImage: async (input) => {
			saved.push({
				mediaType: input.mediaType,
				bytes: input.data.length,
				name: input.name,
			});

			return {
				attachmentId: "sha256-image",
				mediaType: input.mediaType,
				bytes: input.data.length,
				width: 1_280,
				height: 633,
				name: input.name,
			};
		},
	};

	return { store, saved };
};

test("a file becomes a durable image", async () => {
	const { store, saved } = scriptedStore();
	const shot = fileOf("one.png", 300);
	const bridge = new ScreenshotFiles({ store: () => store });
	const result = await bridge.commit(shot, "png");

	expect(result.image?.width === 1_280, "the reference comes back").toBe(true);
	expect(result.path === "", "and no file path is left in the answer").toBe(
		true,
	);
	expect(
		saved[0]?.mediaType === "image/png" && saved[0]?.bytes === 300,
		"the bytes and their format reach the store",
	).toBe(true);
	expect(
		Bun.file(shot).size === 0 || !(await Bun.file(shot).exists()),
		"and the temporary file is removed",
	).toBe(true);
});

test("a picture too large for the deployment", async () => {
	const { store } = scriptedStore(100);
	const shot = fileOf("big.png", 400);
	const bridge = new ScreenshotFiles({ store: () => store });

	const reason = await bridge
		.commit(shot, "png")
		.then(() => "")
		.catch((error: unknown) => (error instanceof Error ? error.message : ""));

	expect(reason.includes("larger than"), "the refusal names the limit").toBe(
		true,
	);
	expect(reason.includes("jpeg"), "and what to do about it").toBe(true);
});

test("no store, no picture: the file is the answer", async () => {
	const shot = fileOf("kept.png", 40);
	const bridge = new ScreenshotFiles({ store: () => undefined });
	const result = await bridge.commit(shot, "png");

	expect(result.image === undefined, "there is no image reference").toBe(true);
	expect(result.path === shot, "the file path is carried instead").toBe(true);
	expect(await Bun.file(shot).exists(), "and the file is kept").toBe(true);
});

test("a file that is not there", async () => {
	const bridge = new ScreenshotFiles({ store: () => undefined });
	const reason = await bridge
		.commit(join(workspace, "missing.png"), "png")
		.then(() => "")
		.catch((error: unknown) => (error instanceof Error ? error.message : ""));

	expect(
		reason.includes("could not be read"),
		"a picture that never reached disk says so",
	).toBe(true);
});

test("the file a screenshot is written to", async () => {
	const bridge = new ScreenshotFiles({ store: () => undefined });
	const png = bridge.pathFor("png");
	const jpeg = bridge.pathFor("jpeg");

	expect(
		png.endsWith(".png") && jpeg.endsWith(".jpg"),
		"each format has its extension",
	).toBe(true);
	expect(png !== jpeg, "and every screenshot gets its own file").toBe(true);
	expect(png.includes(tmpdir()), "outside the project being inspected").toBe(
		true,
	);
});
