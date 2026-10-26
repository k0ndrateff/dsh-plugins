import { expect, test } from "bun:test";
import {
	jobFailureReasonLabel,
	jobStatusLabel,
	mergeStatusLabel,
	mrStateLabel,
} from "../src/shared/tone";

test("GitLab states and statuses are drawn as words", () => {
	expect(mrStateLabel("opened")).toBe("Open");
	expect(mrStateLabel("merged")).toBe("Merged");
	expect(mergeStatusLabel("cannot_be_merged")).toBe("Conflicts");
	expect(mergeStatusLabel("mergeable")).toBe("Mergeable");
	expect(jobStatusLabel("success")).toBe("Passed");
	expect(jobStatusLabel("failed")).toBe("Failed");
	expect(jobStatusLabel("waiting_for_resource")).toBe("waiting for resource");
});

test("a job's failure reason is read as a sentence, not an enum", () => {
	expect(jobFailureReasonLabel("script_failure")).toBe("the job script failed");
	expect(jobFailureReasonLabel("stuck_or_timeout_failure")).toBe(
		"the job got stuck or timed out",
	);
	expect(jobFailureReasonLabel("something_new")).toBe("something new");
});
