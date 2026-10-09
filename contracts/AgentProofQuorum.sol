// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title AgentProofQuorum
/// @notice Proof anchoring by a set of independent verifiers instead of one wallet.
///         - Each verifier recomputes the proof hash from the Monad receipt on its own and calls
///           attest (or anchorProof, the AgentProof-compatible name for the same call).
///         - The proof is anchored only when `threshold` verifiers attested the SAME hash.
///           ExecutionProofAnchored is emitted then, with the same signature as AgentProof, so
///           existing indexers and scripts/verify-proof.mjs read it unchanged.
///         - Two verifiers attesting different hashes for one execution is a conflict: the
///           execution is marked Disputed and can never be anchored by this contract.
///         - Anyone can challenge an execution with a counter-hash and an evidence URI (for example
///           the output of scripts/verify-proof.mjs). A challenge does not change the verdict by
///           itself; it is a public, onchain flag every reader sees next to the anchor.
///         - A verifier that finds it was wrong (or agrees with a challenge) withdraws its
///           attestation. If an anchored proof drops below the threshold it becomes Revoked.
///           History is never edited: every step is an event.
///         - The owner (meant to be a multisig) manages the verifier set and threshold.
/// @dev The proof hash is the same keccak256(abi.encode(chainId, agentId, firewallId, executionId,
///      executor, transactionHash, blockNumber, target, selector, value, calldataHash)) as AgentProof.
contract AgentProofQuorum {
    enum Status {
        None,
        Pending,
        Anchored,
        Disputed,
        Revoked
    }

    struct Anchor {
        bytes32 proofHash;
        bytes32 executionId;
        uint256 agentId;
        uint256 firewallId;
        bytes32 transactionHash;
        uint64 anchoredAt;
        address verifier;
    }

    struct Execution {
        Status status;
        bytes32 proofHash;
        uint256 agentId;
        uint256 firewallId;
        bytes32 transactionHash;
        uint64 anchoredAt;
        address lastVerifier;
        uint32 attestations;
        uint32 challenges;
    }

    address public owner;
    uint256 public threshold;
    uint256 public verifierCount;

    mapping(address => bool) public isVerifier;
    mapping(bytes32 executionId => Execution) private _executions;
    mapping(bytes32 executionId => mapping(address verifier => bytes32 proofHash)) private _attested;
    mapping(bytes32 proofHash => bytes32 executionId) private _byHash;

    error ZeroAddress();
    error ZeroValue();
    error Unauthorized(address caller);
    error InvalidThreshold(uint256 threshold, uint256 verifierCount);
    error AlreadyVerifier(address verifier);
    error NotVerifier(address verifier);
    error AlreadyAttested(bytes32 executionId, address verifier);
    error NotAttested(bytes32 executionId, address verifier);
    error ExecutionDisputed(bytes32 executionId);
    error ProofHashAlreadyUsed(bytes32 proofHash);
    error AnchorNotFound(bytes32 executionId);
    error UnknownExecution(bytes32 executionId);
    error EvidenceTooLong();

    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event VerifierAdded(address indexed verifier, uint64 at);
    event VerifierRemoved(address indexed verifier, uint64 at);
    event ThresholdUpdated(uint256 threshold, uint64 at);

    event ProofAttested(
        bytes32 indexed executionId,
        bytes32 indexed proofHash,
        address indexed verifier,
        uint32 attestations,
        uint256 threshold,
        uint64 at
    );

    /// @dev Same signature as AgentProof.ExecutionProofAnchored.
    event ExecutionProofAnchored(
        bytes32 indexed proofHash,
        bytes32 indexed executionId,
        uint256 indexed agentId,
        uint256 firewallId,
        bytes32 transactionHash,
        address verifier,
        uint64 anchoredAt
    );

    event ProofConflict(
        bytes32 indexed executionId,
        bytes32 existingHash,
        bytes32 conflictingHash,
        address indexed verifier,
        uint64 at
    );

    event ProofChallenged(
        bytes32 indexed executionId,
        address indexed challenger,
        bytes32 claimedProofHash,
        string evidenceURI,
        uint64 at
    );

    event AttestationWithdrawn(bytes32 indexed executionId, address indexed verifier, string reason, uint64 at);
    event ProofRevoked(bytes32 indexed executionId, bytes32 indexed proofHash, uint64 at);

    constructor(address[] memory verifiers_, uint256 threshold_) {
        owner = msg.sender;
        emit OwnerTransferred(address(0), msg.sender);
        for (uint256 i = 0; i < verifiers_.length; i++) _addVerifier(verifiers_[i]);
        _setThreshold(threshold_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    // --- Verifier set ---------------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addVerifier(address verifier) external onlyOwner {
        _addVerifier(verifier);
    }

    function removeVerifier(address verifier) external onlyOwner {
        if (!isVerifier[verifier]) revert NotVerifier(verifier);
        isVerifier[verifier] = false;
        verifierCount -= 1;
        if (threshold > verifierCount) revert InvalidThreshold(threshold, verifierCount);
        emit VerifierRemoved(verifier, uint64(block.timestamp));
    }

    function setThreshold(uint256 threshold_) external onlyOwner {
        _setThreshold(threshold_);
    }

    // --- Attestation ----------------------------------------------------------------------------

    /// @notice One verifier's independent verdict for one execution.
    function attest(
        bytes32 proofHash,
        bytes32 executionId,
        uint256 agentId,
        uint256 firewallId,
        bytes32 transactionHash
    ) public {
        if (!isVerifier[msg.sender]) revert Unauthorized(msg.sender);
        if (proofHash == bytes32(0) || executionId == bytes32(0) || transactionHash == bytes32(0)) revert ZeroValue();
        if (_attested[executionId][msg.sender] != bytes32(0)) revert AlreadyAttested(executionId, msg.sender);

        Execution storage row = _executions[executionId];
        if (row.status == Status.Disputed) revert ExecutionDisputed(executionId);

        bytes32 owned = _byHash[proofHash];
        if (owned != bytes32(0) && owned != executionId) revert ProofHashAlreadyUsed(proofHash);

        uint64 nowTs = uint64(block.timestamp);
        if (row.status == Status.None) {
            row.status = Status.Pending;
            row.proofHash = proofHash;
            row.agentId = agentId;
            row.firewallId = firewallId;
            row.transactionHash = transactionHash;
            _byHash[proofHash] = executionId;
        } else if (
            row.proofHash != proofHash ||
            row.agentId != agentId ||
            row.firewallId != firewallId ||
            row.transactionHash != transactionHash
        ) {
            // Two verifiers disagree on what happened. Nobody's hash wins.
            row.status = Status.Disputed;
            emit ProofConflict(executionId, row.proofHash, proofHash, msg.sender, nowTs);
            return;
        }

        _attested[executionId][msg.sender] = proofHash;
        row.attestations += 1;
        row.lastVerifier = msg.sender;
        emit ProofAttested(executionId, proofHash, msg.sender, row.attestations, threshold, nowTs);

        if (row.status != Status.Anchored && row.attestations >= threshold) {
            row.status = Status.Anchored;
            row.anchoredAt = nowTs;
            emit ExecutionProofAnchored(proofHash, executionId, agentId, firewallId, transactionHash, msg.sender, nowTs);
        }
    }

    /// @notice AgentProof-compatible name, so the existing AgentTrace server and SDK can point at
    ///         this contract unchanged: each verifier's anchorProof call is its attestation.
    function anchorProof(
        bytes32 proofHash,
        bytes32 executionId,
        uint256 agentId,
        uint256 firewallId,
        bytes32 transactionHash
    ) external {
        attest(proofHash, executionId, agentId, firewallId, transactionHash);
    }

    /// @notice A verifier takes its attestation back (it re-checked and was wrong, or it agrees
    ///         with a challenge). An anchored proof that falls below threshold is Revoked.
    function withdrawAttestation(bytes32 executionId, string calldata reason) external {
        if (!isVerifier[msg.sender]) revert Unauthorized(msg.sender);
        if (_attested[executionId][msg.sender] == bytes32(0)) revert NotAttested(executionId, msg.sender);
        if (bytes(reason).length > 280) revert EvidenceTooLong();
        delete _attested[executionId][msg.sender];
        Execution storage row = _executions[executionId];
        row.attestations -= 1;
        uint64 nowTs = uint64(block.timestamp);
        emit AttestationWithdrawn(executionId, msg.sender, reason, nowTs);
        if (row.status == Status.Anchored && row.attestations < threshold) {
            row.status = Status.Revoked;
            emit ProofRevoked(executionId, row.proofHash, nowTs);
        }
    }

    // --- Disputes -------------------------------------------------------------------------------

    /// @notice Anyone can flag an execution they believe was verified wrongly. claimedProofHash
    ///         is the hash the challenger recomputed (zero if they claim no valid proof exists);
    ///         evidenceURI points at the recomputation. Verifiers are expected to re-check and
    ///         either stand by their attestation or withdraw it.
    function challenge(bytes32 executionId, bytes32 claimedProofHash, string calldata evidenceURI) external {
        Execution storage row = _executions[executionId];
        if (row.status == Status.None) revert UnknownExecution(executionId);
        if (bytes(evidenceURI).length > 280) revert EvidenceTooLong();
        row.challenges += 1;
        emit ProofChallenged(executionId, msg.sender, claimedProofHash, evidenceURI, uint64(block.timestamp));
    }

    // --- Reads (AgentProof-compatible where the name matches) ------------------------------------

    function isAnchored(bytes32 executionId) external view returns (bool) {
        return _executions[executionId].status == Status.Anchored;
    }

    function getAnchor(bytes32 executionId) external view returns (Anchor memory) {
        Execution memory row = _executions[executionId];
        if (row.status != Status.Anchored) revert AnchorNotFound(executionId);
        return Anchor(row.proofHash, executionId, row.agentId, row.firewallId, row.transactionHash, row.anchoredAt, row.lastVerifier);
    }

    function getExecution(bytes32 executionId) external view returns (Execution memory) {
        return _executions[executionId];
    }

    function attestationOf(bytes32 executionId, address verifier) external view returns (bytes32) {
        return _attested[executionId][verifier];
    }

    /// @notice AgentProof exposes a single `verifier`; here it is the owner-managed set. Kept so
    ///         readers that call verifier() get a defined answer: the contract itself.
    function verifier() external view returns (address) {
        return address(this);
    }

    function _addVerifier(address verifier_) private {
        if (verifier_ == address(0)) revert ZeroAddress();
        if (isVerifier[verifier_]) revert AlreadyVerifier(verifier_);
        isVerifier[verifier_] = true;
        verifierCount += 1;
        emit VerifierAdded(verifier_, uint64(block.timestamp));
    }

    function _setThreshold(uint256 threshold_) private {
        if (threshold_ == 0 || threshold_ > verifierCount) revert InvalidThreshold(threshold_, verifierCount);
        threshold = threshold_;
        emit ThresholdUpdated(threshold_, uint64(block.timestamp));
    }
}
