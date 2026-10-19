import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";

interface Props {
	label: string;
	value?: string;
}

export const Badge = ({ label, value }: Props) => {
	if (value === undefined || value === "") return null;

	return <Tag tone="outline">{`${label}: ${value}`}</Tag>;
};
