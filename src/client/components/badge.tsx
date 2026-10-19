import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import type { CardTone } from "../../shared/tone";

interface Props {
	/** The field's name, when the value needs one ("Priority: P2"). */
	label?: string;
	value?: string;
	/** Which palette the fact earns; a card tone is structurally a tag tone. */
	tone?: CardTone;
}

/**
 * One fact about an item.
 *
 * With a `label` it reads as a named field; without one it is the value itself,
 * which is how a type becomes a coloured chip instead of another "Type: …".
 */
export const Badge = ({ label, value, tone = "outline" }: Props) => {
	if (value === undefined || value === "") return null;

	return (
		<Tag tone={tone}>{label === undefined ? value : `${label}: ${value}`}</Tag>
	);
};
