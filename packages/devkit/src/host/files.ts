/**
 * The project directory one session works in.
 *
 * Both the recipe book and the `/checks init` draft read files from it, through
 * the harness's filesystem seam rather than node's, so a session whose workspace
 * is not this process's own disk still finds its own project.
 */

import type { Context } from "@deepseek-ai/cordis";

export class ProjectDirectory {
	/**
	 * @param ctx - host context carrying the filesystem seam.
	 * @param cwd - the directory the session works in.
	 */
	constructor(
		private readonly ctx: Context,
		readonly cwd: string,
	) {}

	/**
	 * Read one file of the project.
	 * @param name - the file's path, relative to the project directory.
	 * @returns its text, or undefined when there is no such readable file.
	 */
	async read(name: string): Promise<string | undefined> {
		if (!(await this.has(name))) return undefined;

		try {
			return await this.ctx.fs.readText(
				await this.ctx.fs.resolve(name, { cwd: this.cwd }),
			);
		} catch {
			return undefined;
		}
	}

	/**
	 * Whether one file of the project is there.
	 * @param name - the file's path, relative to the project directory.
	 */
	async has(name: string): Promise<boolean> {
		try {
			const target = await this.ctx.fs.resolve(name, { cwd: this.cwd });

			return (await this.ctx.fs.stat(target)) !== undefined;
		} catch {
			return false;
		}
	}
}
