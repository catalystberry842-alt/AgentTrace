/**
 * The ERC-8004 outcome feedback document.
 *
 * `feedbackHash = keccak256(utf8(outcomeFeedbackJson(...)))` is committed onchain and the
 * same bytes are served at `feedbackURI = <base>/outcomes/<executionId>` so anyone can
 * fetch the preimage and recompute the hash. Key order matters: do not reorder.
 */
export function outcomeFeedbackJson(
  executionId: string,
  outcome: { status: string; observed: unknown; evidence: unknown },
): string {
  return JSON.stringify({ executionId, status: outcome.status, observed: outcome.observed, evidence: outcome.evidence });
}

/** True when the client did not ask for HTML (browsers always send text/html). */
export function wantsFeedbackJson(request: Request): boolean {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format === "json") return true;
  if (format === "html") return false;
  const accept = request.headers.get("accept") || "";
  return !/(^|,)\s*text\/html/i.test(accept);
}
