/**
 * What is Sentry's rather than the library's about signing in.
 *
 * The sign-in operations themselves belong to `dsh-integration-host`, which
 * serves the `/sentry` command, the settings card's HTTP calls, and the
 * automatic connect after a successful attempt from one implementation. All
 * Sentry supplies is its own name, the log tag, how its organization list is
 * read, and the two fields it adds to the shared status document.
 */

import type { AuthSpec } from "dsh-integration-host";
import type { SentryStatus } from "../shared/status";
import {
	type OrganizationFacts,
	organizationFacts,
} from "./store/organization";

/** The provider's own half of the shared sign-in implementation. */
export const sentryAuthSpec: AuthSpec<SentryStatus, OrganizationFacts> = {
	label: "Sentry",
	logTag: "[sentry]",
	facts: organizationFacts,
	status: (base, facts) => ({
		...base,
		organization: facts?.slug ?? null,
		organizationUrl: facts?.webUrl ?? null,
		organizations: facts?.organizations ?? [],
	}),
};
