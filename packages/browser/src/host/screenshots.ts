/**
 * A screenshot as a durable image the model can look at.
 *
 * The CLI's `screenshot` command writes a file and answers with its path; the
 * model needs the picture itself, and the harness keeps pictures in its own
 * immutable attachment store. This is the seam between the two: the tool asks
 * for a fresh path, the CLI fills it, and this reads the bytes, checks them
 * against the deployment's image policy and commits them, so what the tool
 * returns is an `ImageBlock`'s worth of reference rather than base64 text the
 * context budget would cut.
 *
 * The file is removed whether the commit worked or not: a screenshot is a
 * by-product, not something to leave in the temporary directory.
 */

import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The two formats this plugin asks the CLI for. */
export type ScreenshotFormat = "png" | "jpeg";

/** The image format on the wire, as the attachment store names it. */
const MEDIA_TYPE: Readonly<Record<ScreenshotFormat, string>> = {
	png: "image/png",
	jpeg: "image/jpeg",
};

/** The extension the CLI derives the encoder from. */
const EXTENSION: Readonly<Record<ScreenshotFormat, string>> = {
	png: "png",
	jpeg: "jpg",
};

/**
 * The part of `ctx.attachments` this plugin uses.
 *
 * Spelled structurally rather than imported so the host bundle never carries a
 * second copy of the attachment service; the service instance the harness hands
 * over satisfies this shape.
 */
export interface ImageStore {
	/** The deployment's image policy, used to refuse an oversized picture early. */
	readonly imageLimits: { readonly maxImageBytes: number };
	/**
	 * Validate and durably commit one image.
	 * @returns the stored reference, with the normalized dimensions.
	 */
	saveImage(input: {
		readonly data: Uint8Array;
		readonly mediaType: string;
		readonly name?: string;
	}): Promise<StoredImageRef>;
}

/** One stored image, as much of its reference as an answer needs. */
export interface StoredImageRef {
	readonly attachmentId: string;
	readonly mediaType: string;
	readonly bytes: number;
	readonly width: number;
	readonly height: number;
	readonly name?: string;
}

/** What one screenshot left behind. */
export interface ScreenshotSaved {
	/** The durable image, or undefined when this deployment has no store. */
	readonly image: StoredImageRef | undefined;
	/** The file on disk, when it had to be kept because there is no store. */
	readonly path: string;
	readonly bytes: number;
}

/** A count of bytes as a person reads it. */
const bytesText = (bytes: number): string =>
	bytes < 1_024 ? `${bytes} bytes` : `${Math.round(bytes / 1_024)} KB`;

/** What the screenshot tool needs from the file-and-store bridge. */
export interface ScreenshotSink {
	/** A fresh temporary file for one screenshot. */
	pathFor(format: ScreenshotFormat): string;
	/** Read the CLI's file, store it as an image, and remove the file. */
	commit(path: string, format: ScreenshotFormat): Promise<ScreenshotSaved>;
}

/**
 * The bridge from the CLI's output file to the model's image content.
 *
 * @param deps.store - the attachment service, looked up when a screenshot is
 *   taken rather than at activation: a deployment without one still drives the
 *   browser, and then the answer is the path instead of the picture.
 */
export class ScreenshotFiles implements ScreenshotSink {
	/** @param deps - how to reach the deployment's image store. */
	constructor(
		private readonly deps: {
			readonly store: () => ImageStore | undefined;
		},
	) {}

	/**
	 * A fresh temporary file for one screenshot.
	 *
	 * The name is unique and lies in the system temporary directory, so two
	 * conversations taking a picture at the same moment cannot overwrite each
	 * other and nothing lands in the project being inspected.
	 * @param format - the encoder the CLI will use.
	 */
	pathFor(format: ScreenshotFormat): string {
		return join(tmpdir(), `dsh-browser-${randomUUID()}.${EXTENSION[format]}`);
	}

	/**
	 * Read the CLI's file, store it as an image, and remove the file.
	 * @param path - the file the CLI wrote.
	 * @param format - the format it was asked for.
	 * @returns the stored reference, or the kept path when there is no store.
	 */
	async commit(
		path: string,
		format: ScreenshotFormat,
	): Promise<ScreenshotSaved> {
		let data: Uint8Array;

		try {
			data = await readFile(path);
		} catch (error) {
			throw new Error(
				`The screenshot was taken but its file could not be read: ${reasonOf(error)}`,
			);
		}

		try {
			const saved = await this.store(path, data, format);

			// A kept path is kept for a reason: without an image store the file is
			// the only way a person can open the picture, so it stays.
			if (saved.image !== undefined) await unlink(path).catch(() => undefined);

			return saved;
		} catch (error) {
			await unlink(path).catch(() => undefined);

			throw error;
		}
	}

	/** Store one read picture, or explain why it cannot be one. */
	private async store(
		path: string,
		data: Uint8Array,
		format: ScreenshotFormat,
	): Promise<ScreenshotSaved> {
		const store = this.deps.store();

		if (store === undefined)
			return { image: undefined, path, bytes: data.length };

		const max = store.imageLimits.maxImageBytes;

		if (data.length > max)
			throw new Error(
				`The screenshot is ${bytesText(data.length)}, larger than the ${bytesText(max)} image limit. Retake it smaller: a viewport screenshot rather than a full page, the jpeg format, or a narrower page size.`,
			);

		try {
			const image = await store.saveImage({
				data,
				mediaType: MEDIA_TYPE[format],
				name: `screenshot.${EXTENSION[format]}`,
			});

			return { image, path: "", bytes: image.bytes };
		} catch (error) {
			throw new Error(
				`The screenshot could not be stored as an image: ${reasonOf(error)}`,
			);
		}
	}
}

/** A thrown value as a sentence. */
const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
