/**
 * The frame's picture in the panel.
 *
 * The document the host serves carries a URL rather than bytes, so the page
 * fetches the picture itself. Fetching it instead of pointing an `<img>` at it is
 * what makes a failure explainable: the route answers a 502 with the reason —
 * often "start the Figma desktop app" — and the panel can show that reason and
 * offer the retry, where an `<img>` would only leave its broken-image mark.
 *
 * The picture is also the thing being compared against an implementation, so it
 * is clickable: one click switches between fit-to-width and actual size, and the
 * original opens in its own tab.
 */

import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import * as styles from "../styles/styles.css";

/** What the picture knows about itself. */
type Load =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly url: string }
	| {
			readonly status: "error";
			readonly reason: string;
			readonly retryable: boolean;
	  };

interface Props {
	/** The route the picture is fetched from, or null when there is none. */
	readonly src: string | null;
	/** What the picture shows, for a reader who cannot see it. */
	readonly alt: string;
}

/** The reason inside a failed picture response, as one sentence. */
async function failureOf(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	let reason = text.trim();

	try {
		const parsed: unknown = JSON.parse(text);

		if (
			parsed !== null &&
			typeof parsed === "object" &&
			typeof (parsed as { error?: unknown }).error === "string"
		)
			reason = (parsed as { error: string }).error;
	} catch {
		// Not JSON: the body itself is what the route said.
	}

	return reason === ""
		? `The Figma server answered ${response.status} and gave no reason.`
		: reason;
}

/** One node's picture, with zoom, its own failure state, and a way back. */
export const FrameImage = ({ src, alt }: Props): ReactNode => {
	const [attempt, setAttempt] = useState(0);
	const [zoomed, setZoomed] = useState(false);
	const [load, setLoad] = useState<Load>({ status: "loading" });

	useEffect(() => {
		if (src === null) {
			setLoad({
				status: "error",
				reason: "The Figma server sent no picture for this node.",
				retryable: false,
			});

			return;
		}

		let url: string | undefined;
		let cancelled = false;
		const controller = new AbortController();
		const request =
			attempt === 0
				? src
				: `${src}${src.includes("?") ? "&" : "?"}attempt=${attempt}`;

		setLoad({ status: "loading" });

		void fetch(request, { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(await failureOf(response));

				return await response.blob();
			})
			.then((blob) => {
				if (cancelled) return;

				url = URL.createObjectURL(blob);
				setLoad({ status: "ready", url });
			})
			.catch((error: unknown) => {
				if (cancelled) return;

				setLoad({
					status: "error",
					reason: error instanceof Error ? error.message : String(error),
					retryable: true,
				});
			});

		return () => {
			cancelled = true;
			controller.abort();
			if (url !== undefined) URL.revokeObjectURL(url);
		};
	}, [src, attempt]);

	if (load.status === "loading")
		return (
			<span className={styles.caption} role="status">
				Loading the Figma picture…
			</span>
		);

	if (load.status === "error")
		return (
			<div className={styles.frameMissing}>
				<span className={styles.frameMissingText}>{load.reason}</span>

				{load.retryable ? (
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							setAttempt((value) => value + 1);
						}}
					>
						Try again
					</Button>
				) : null}
			</div>
		);

	return (
		<div
			className={
				zoomed
					? `${styles.frameStage} ${styles.frameStageZoomed}`
					: styles.frameStage
			}
		>
			<button
				type="button"
				className={styles.frameButton}
				onClick={() => {
					setZoomed((value) => !value);
				}}
				aria-label={
					zoomed ? `Fit ${alt} to the panel` : `Show ${alt} at full size`
				}
			>
				<img
					className={
						zoomed
							? `${styles.frameImage} ${styles.frameImageZoomed}`
							: styles.frameImage
					}
					src={load.url}
					alt={alt}
				/>
			</button>

			<div className={styles.frameActions}>
				<span className={styles.caption}>
					{zoomed
						? "At full size — click the picture to fit it again."
						: "Click the picture for its actual size; a frame wider than the panel stays readable that way."}
				</span>

				{src === null ? null : (
					<a
						className={styles.link}
						href={src}
						target="_blank"
						rel="noreferrer"
					>
						Open original
					</a>
				)}
			</div>
		</div>
	);
};
