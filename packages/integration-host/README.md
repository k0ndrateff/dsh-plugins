# dsh-integration-host

The host-half shell every integration plugin here shares: normalizing the endpoint
patch, holding the sign-in state and the operations that change it, answering the
settings route, running the slash command, and owning the two registries
integrations contribute to. A plugin supplies its provider profile, how its server
names the account, and the paths its own panel uses.

| Entry | What it is |
|---|---|
| `dsh-integration-host` | all of the above, as node code |
| `dsh-integration-host/digest` | the digest-source contract, and the registry |
| `dsh-integration-host/correlation` | the fact-and-reference contract, and the registry |
| `dsh-integration-host/status` | the status document a browser half reads |

The entries exist because a browser half must not pull node code into its program:
it reads a contract, which is client-safe on its own.

Used by Atlassian, Sentry, GitLab, Figma, devkit, the digest plugin and the
correlation plugin.
