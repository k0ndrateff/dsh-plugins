# dsh-correlation-plugin

One chain across the installed integrations: an error, the commit behind it, the
merge request that commit belongs to, and the ticket it names.

`correlate` takes the integration to start from and one of its own identifiers — a
Sentry short id or issue link, a commit sha, a merge request as `group/project!12`,
or a tracker key such as `DEV-5977` — and walks from there. It reads only.

The seam is a registry, like the digest's but with a different contract:
`dsh-integration-host` declares what a fact and a reference are (an error, a
commit, a change request, a task), this plugin provides `ctx.correlationSources`,
and each integration registers what it can answer for. A provider answers about
the reference it was asked about with a fact, and that fact carries the references
onward — so the walk knows nothing about what a merge request is, and no provider
knows another's identifiers.

Where the chain stopped is part of the answer: "no installed integration resolves
this", "GitLab refused the request (403)" and "nothing found" are three different
lines on the card.
