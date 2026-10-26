/**
 * What is Atlassian's rather than the library's about signing in.
 *
 * The sign-in operations themselves belong to `dsh-integration-host`, which
 * serves the `/atlassian` command, the settings card's HTTP calls, and the
 * automatic connect after a successful attempt from one implementation. All
 * Atlassian supplies is its own name, the log tag, how its site list is read,
 * and the field it adds to the shared status document.
 */

import type { AuthSpec } from "dsh-integration-host";
import type { AtlassianStatus } from "../shared/status";
import { type SiteFacts, siteFacts } from "./store/site";

/** The provider's own half of the shared sign-in implementation. */
export const atlassianAuthSpec: AuthSpec<AtlassianStatus, SiteFacts> = {
	label: "Atlassian",
	logTag: "[atlassian]",
	facts: siteFacts,
	status: (base, facts) => ({
		...base,
		siteUrl: facts?.siteUrl ?? null,
		cloudId: facts?.cloudId ?? null,
		sites: facts?.sites ?? [],
	}),
};
