/**
 * Refresh a pending registration or firewall record, re-creating it from the transaction when
 * the server no longer has it. On a host without a shared database (serverless instances with
 * in-memory storage) the record can live on another instance; the transaction on Monad is the
 * source of truth, so submitting the same hash again rebuilds the record from chain data.
 */
export async function refreshOrResubmit<T>(
  refresh: () => Promise<T>,
  resubmit: (() => Promise<T>) | null,
): Promise<T> {
  try {
    return await refresh();
  } catch (err) {
    if (resubmit && err instanceof Error && /record not found/i.test(err.message))
      return resubmit();
    throw err;
  }
}
