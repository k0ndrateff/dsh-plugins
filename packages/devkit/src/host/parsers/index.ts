/**
 * The parser registry: one reader per name a recipe may write.
 *
 * The names are the shared vocabulary (`ParserName`), so a config the host
 * accepts is a config the card can label, and adding a format is adding one
 * entry here and one file beside it.
 */

import type { ParserName } from "../../shared/checks";
import { parseBiome } from "./biome";
import { parseEslint } from "./eslint";
import { parseGeneric } from "./generic";
import type { Parser } from "./parsed";
import { parsePytest } from "./pytest";
import { parseJest, parseVitest } from "./tests";
import { parseTsc } from "./tsc";

export type { ParsedOutput, Parser } from "./parsed";

const PARSERS: Readonly<Record<ParserName, Parser>> = {
	tsc: parseTsc,
	biome: parseBiome,
	eslint: parseEslint,
	vitest: parseVitest,
	jest: parseJest,
	pytest: parsePytest,
	generic: parseGeneric,
};

/** The reader for one recipe's `parse` name. */
export function parserNamed(name: ParserName): Parser {
	return PARSERS[name];
}
