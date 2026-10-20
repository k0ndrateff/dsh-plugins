/**
 * One named fact about an issue.
 *
 * A fact without a value renders nothing, so a caller can list every field it
 * knows about without branching on each one.
 */

import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";

interface Props {
	/** The field's name, as Sentry words it ("Assignee", "Last seen"). */
	label: string;
	value?: string | number;
}

export const Fact = ({ label, value }: Props) => {
	if (value === undefined || value === "") return null;

	return <Tag tone="neutral">{`${label}: ${value}`}</Tag>;
};
