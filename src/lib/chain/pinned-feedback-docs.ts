/**
 * Feedback documents whose bytes are committed onchain and cannot be rebuilt from the database.
 *
 * `execution_outcomes` lives in the app database, and on a serverless host without Postgres that
 * database starts empty on every cold start. A feedback posted before document pinning existed
 * (0485857) therefore has no stored document and no outcome row to rebuild it from, so
 * `/outcomes/<executionId>` answers 404 and nobody can check the committed `feedbackHash`.
 *
 * The documents below are the exact bytes. Each one was checked: keccak256(utf8(document)) equals the
 * `feedbackHash` in the calldata of the transaction that posted the feedback. Nothing here is
 * stored data that can drift. A test recomputes every hash, so a wrong byte fails the build.
 *
 * Key order matters and matches `outcomeFeedbackJson`. Do not reformat.
 */
export type PinnedFeedbackDoc = {
  executionId: string;
  /** Hash committed in the giveFeedback calldata. */
  feedbackHash: `0x${string}`;
  /** The transaction that posted it, so the commitment can be read independently. */
  postedIn: `0x${string}`;
  document: string;
};

export const PINNED_FEEDBACK_DOCS: readonly PinnedFeedbackDoc[] = [
  {
    // Mainnet agent 10315, feedback 1: demo protocol Deposit.
    executionId: "0x30985cb60afd8d37b5edfad48312f32ecffa3e34366d31b7f9ec94ef574a9552",
    feedbackHash: "0xed3bfb0af95e3c5de0e31280ab980ceb30ead6a464284ca09f821b4528646068",
    postedIn: "0x8d0e94ff2bc34017d01b504166c5e83a0c92cb097f3db0aba9288e137930dd11",
    document:
      '{"executionId":"0x30985cb60afd8d37b5edfad48312f32ecffa3e34366d31b7f9ec94ef574a9552","status":"verified","observed":"{\\"arg0\\":\\"0x694178a2396b54bFF6a25caa0aA9Cca6Eb079441\\",\\"arg1\\":\\"10000000000000000\\"}","evidence":"0x17ec0160c8929c55a53165e833a8ebb7afb6cfe8a3547b13c8bd962df46a37d3"}',
  },
  {
    // Mainnet agent 10315, feedback 2: demo protocol Transfer.
    executionId: "0x55b2e18ff7e0995159672f4624451510079632662086fa3a65d3896ecced1862",
    feedbackHash: "0x4b569ebdd223c07b867cc9c2d3c60153ac5445b8a9707a5e8104764680d5e998",
    postedIn: "0xfc8a59aad7cc3bdee5ddf40aea67bb20d38fb81242ac84cc985d1ee512c74210",
    document:
      '{"executionId":"0x55b2e18ff7e0995159672f4624451510079632662086fa3a65d3896ecced1862","status":"verified","observed":"{\\"arg0\\":\\"0x694178a2396b54bFF6a25caa0aA9Cca6Eb079441\\",\\"arg1\\":\\"0xB925D44d52815D19C2f91c30f6aBD3B4D0546D4E\\",\\"arg2\\":\\"10000000000000000\\"}","evidence":"0x9ad6de14a8c4c19944b28dc0d676a20460a167cef5883dd3824f9cc1b26b99b1"}',
  },
  {
    // Mainnet agent 10280 (AgentTrace agent #001), feedback 1: demo protocol Deposited(agentId 1, amount 100).
    executionId: "0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e",
    feedbackHash: "0x76d54b9174ffda566e04424bb76ba8385915c567ecd13ae76cf0cffb5c6ed833",
    postedIn: "0x3c05024ac5e0f78972734ee68cce1a4bb7126b375d3500a4e6be405f4a81aef6",
    document:
      '{"executionId":"0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e","status":"verified","observed":"{\\"agentId\\":\\"1\\",\\"amount\\":\\"100\\"}","evidence":"0x7db78e779216bc5d55dd1a957871122ed0d23357e0c5acda7ddbe6401fc4c0c8"}',
  },
];

/** The pinned document for an execution, or null. Case-insensitive on the execution id. */
export function pinnedFeedbackDocument(executionId: string): string | null {
  const id = executionId.trim().toLowerCase();
  return PINNED_FEEDBACK_DOCS.find((d) => d.executionId.toLowerCase() === id)?.document ?? null;
}
