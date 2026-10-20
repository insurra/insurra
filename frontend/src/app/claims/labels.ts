import type { components } from "@/lib/api/types.gen";

type ClaimStatus = components["schemas"]["ClaimCaseStatus"];

const labels: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  NEEDS_EVIDENCE: "Evidence needed",
  READY_FOR_REVIEW: "Ready for review",
  AWAITING_APPROVAL: "Awaiting approval",
  READY_FOR_SUBMISSION: "Ready for submission",
  SUBMITTED: "Submitted (source status needs verification)",
  SUBMITTED_SANDBOX: "Submitted to sandbox",
  PROCESSING: "Processing (source status needs verification)",
  ADDITIONAL_INFORMATION_REQUIRED: "Additional information required",
  APPROVED: "Approved (source status needs verification)",
  REJECTED: "Rejected (source status needs verification)",
  SANDBOX_APPROVED: "Approved in sandbox, not by an insurer",
  SANDBOX_REJECTED: "Rejected in sandbox",
  CANCELLED: "Cancelled",
};

export function claimStatusLabel(status: ClaimStatus): string {
  return labels[status];
}
