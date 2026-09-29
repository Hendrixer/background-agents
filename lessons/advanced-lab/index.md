# Advanced lab · Evaluate an incident agent

This lab is for teams that finish early or want a deeper capstone. Work in pairs if it helps you compare model behavior. Start a fresh checkout process for each trial, then keep the Inngest trace, the per-run feed on `/activity`, and the service events on `/events` open.

Before a trial, write down the target state, actions allowed without approval, actions that require approval, acceptable human questions, the maximum decision count, and the terminal outcome you expect. Then run four drills:

1. A feature fault with three alerts. Explain why they join one active incident and verify that disabling the feature changes subsequent checkout observations.
2. A faulty release. Deny one rollback request, then restart checkout and try again with approval. Verify the approved action is bound to the state version the agent saw.
3. A feature fault with `--lose-next-action-response`. Compare the failed HTTP attempt, Inngest retry, stable action ID, and one recorded effect.
4. A dependency fault with delayed recovery. Answer the help request; verify the answer alone does not certify recovery, while the service's later event wakes the same run for a fresh observation.

Score **world outcome**, **action trajectory**, and **human boundary** separately. Find one failure that calls for a better tool contract or harness policy rather than a stronger prompt. Consider a production design with two checkout regions: what key would group related events, and when should a second incident open? Also identify what would have to persist if the checkout process could crash between changing state and publishing an alert.
