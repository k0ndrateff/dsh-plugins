/**
 * `browser_screenshot` — the page as a picture the model can look at.
 *
 * The accessibility tree says what a page *is*; it cannot say whether two
 * buttons overlap, whether the spacing collapsed, or whether the colour is
 * readable. A screenshot is that missing half, and it is the one thing a model
 * can only use as an image: base64 in JSON would be cut by the answer limit and
 * cost the context more than the picture is worth. So the bytes go through the
 * attachment store and come back as an `ImageBlock`, with the page's address in
 * the text beside it.
 *
 * The picture is asked for explicitly and never sent on its own: every
 * screenshot is a deliberate cost, and a model that has one has seen the page.
 */

import type {
	ImageAttachmentRef,
	ImageMediaType,
} from "@deepseek-ai/dsh-attachment";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { BROWSER_SCREENSHOT_TOOL } from "../../shared/tools";
import { fieldOf, isText, modelData } from "../envelope";
import type { ScreenshotFormat, StoredImageRef } from "../screenshots";
import { type BrowserToolDeps, runForSession } from "./deps";
import { failureOf } from "./failure";

/** The two formats a model may ask for. */
const FORMATS: readonly ScreenshotFormat[] = ["png", "jpeg"];

/** The arguments the model may send, after validation. */
interface ScreenshotArgs {
	readonly format: ScreenshotFormat;
	readonly full: boolean;
	readonly selector: string | undefined;
	readonly quality: number | undefined;
}

/** The JPEG quality used when the model asks for jpeg and no quality. */
const DEFAULT_QUALITY = 80;

/** A count of bytes as a person reads it. */
const bytesText = (bytes: number): string =>
	bytes < 1_024 ? `${bytes} bytes` : `${Math.round(bytes / 1_024)} KB`;

/** One stored image as the durable reference an `ImageBlock` carries. */
const refOf = (image: StoredImageRef): ImageAttachmentRef => ({
	attachmentId: image.attachmentId as ImageAttachmentRef["attachmentId"],
	mediaType: image.mediaType as ImageMediaType,
	bytes: image.bytes,
	width: image.width,
	height: image.height,
	...(image.name === undefined ? {} : { name: image.name }),
});

/** One block the answer is made of: the sentence, then the picture when there is one. */
type ShotBlock =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "image"; readonly attachment: ImageAttachmentRef };

/** The canonical value one call answers with. */
interface ScreenshotValue {
	readonly url: string;
	readonly format: ScreenshotFormat;
	readonly bytes: number;
	readonly path: string;
	readonly image?: StoredImageRef;
}

class ScreenshotTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = BROWSER_SCREENSHOT_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the runner, the session scope, and the image bridge.
	 */
	create = (deps: BrowserToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Take a screenshot of the page and look at it. Use it to check what the " +
			"accessibility tree cannot say: overlapping elements, broken spacing, unreadable colours, " +
			"the visual state of a chart or a canvas. The answer is the picture plus the page's " +
			"address; a picture is a real cost, so ask for one when the visual result matters " +
			"rather than after every change.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				format: {
					type: "string",
					enum: [...FORMATS],
					description:
						"`png` (the default) is lossless and clearest for text; `jpeg` is much " +
						"smaller and usually enough for layout.",
				},
				full: {
					type: "boolean",
					description:
						"Capture the whole page instead of the visible viewport. Defaults to false.",
				},
				selector: {
					type: "string",
					description:
						"Capture one element instead of the page: an `@eN` reference a snapshot " +
						"gave you, or a CSS selector.",
				},
				quality: {
					type: "number",
					description:
						"JPEG quality, 1 to 100; only used for jpeg, defaults to 80.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					url: { type: "string" },
					format: { type: "string" },
					bytes: { type: "number" },
					path: { type: "string" },
					image: {
						type: "object",
						additionalProperties: false,
						properties: {
							attachmentId: { type: "string" },
							mediaType: { type: "string" },
							bytes: { type: "number" },
							width: { type: "number" },
							height: { type: "number" },
							name: { type: "string" },
						},
						required: ["attachmentId", "mediaType", "bytes", "width", "height"],
					},
				},
				required: ["url", "format", "bytes", "path"],
			},
			render: (args, value) => {
				const shot = value as unknown as ScreenshotValue;
				const what =
					(args as { full?: boolean }).full === true
						? "the full page"
						: "the viewport";
				const where = shot.url === "" ? "" : ` of ${shot.url}`;
				const blocks: ShotBlock[] = [
					{
						type: "text",
						text:
							shot.image === undefined
								? `Took a ${shot.format.toUpperCase()} screenshot of ${what}${where} (${bytesText(shot.bytes)}) and saved it to ${shot.path}. This deployment has no image store, so open that file with the read_image tool to see it.`
								: `Took a ${shot.format.toUpperCase()} screenshot of ${what}${where} (${bytesText(shot.image.bytes)}, ${shot.image.width}×${shot.image.height}).`,
					},
				];

				if (shot.image !== undefined)
					blocks.push({ type: "image", attachment: refOf(shot.image) });

				return blocks;
			},
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const path = deps.images.pathFor(args.format);
			const { session, outcome } = await runForSession(
				deps,
				exec,
				this.argv(args, path),
			);

			if (!outcome.ok) throw failureOf(outcome);

			const saved = await deps.images.commit(path, args.format);
			// The CLI answers with the file it wrote; the address comes from what the
			// live view last saw, and is asked for directly when no panel has ever
			// watched this browser.
			const url = await this.pageUrl(deps, exec, session.name);

			return {
				url,
				format: args.format,
				bytes: saved.bytes,
				path: saved.path,
				...(saved.image === undefined ? {} : { image: saved.image }),
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): ScreenshotArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const format = args.format ?? "png";

		if (!FORMATS.includes(format as ScreenshotFormat))
			throw new Error(
				`browser_screenshot takes a format of: ${FORMATS.join(", ")}`,
			);

		const quality = args.quality;

		if (
			quality !== undefined &&
			(typeof quality !== "number" || quality < 1 || quality > 100)
		)
			throw new Error("browser_screenshot takes a jpeg quality from 1 to 100");

		return {
			format: format as ScreenshotFormat,
			full: args.full === true,
			selector:
				typeof args.selector === "string" && args.selector.trim() !== ""
					? args.selector.trim()
					: undefined,
			quality: typeof quality === "number" ? Math.round(quality) : undefined,
		};
	}

	/**
	 * The address of the page that was photographed.
	 *
	 * The live view knows it, but a browser driven with the panel closed has
	 * nobody listening to its address messages; then one `get url` is the honest
	 * answer, and an address that cannot be read leaves the sentence wordless
	 * rather than inventing one.
	 */
	private async pageUrl(
		deps: BrowserToolDeps,
		exec: Parameters<typeof runForSession>[1],
		session: string,
	): Promise<string> {
		const known = deps.hubs.state(session).url;

		if (known !== "") return known;

		const { outcome } = await runForSession(deps, exec, ["get", "url"]);

		return outcome.ok
			? (fieldOf(modelData(outcome.data), "url", isText) ?? "")
			: "";
	}

	/** The CLI arguments one screenshot is taken with. */
	private argv(args: ScreenshotArgs, path: string): readonly string[] {
		return [
			"screenshot",
			...(args.selector === undefined ? [] : [args.selector]),
			path,
			...(args.full ? ["--full"] : []),
			"--screenshot-format",
			args.format,
			...(args.format === "jpeg"
				? ["--screenshot-quality", String(args.quality ?? DEFAULT_QUALITY)]
				: []),
		];
	}
}

export const screenshotTool = new ScreenshotTool();
