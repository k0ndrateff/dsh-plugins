/**
 * One named fact about an item.
 *
 * A fact without a value renders nothing, so a caller can list every field it
 * knows about without branching on each one. Every integration shows facts this
 * way — an issue's status, a merge request's author — so the component is shared
 * rather than copied per plugin.
 */

import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";

interface Props {
	/** The field's name, as the provider words it ("Assignee", "Last seen"). */
	label: string;
	value?: string | number;
}

export const Fact = ({ label, value }: Props) => {
	if (value === undefined || value === "") return null;

	return <Tag tone="neutral">{`${label}: ${value}`}</Tag>;
};
