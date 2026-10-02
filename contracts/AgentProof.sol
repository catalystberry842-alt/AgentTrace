// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title AgentProof
/// @notice Immutable anchors for execution proofs that an off-chain verifier already checked.
/// @dev This contract cannot read historical receipts. It stores a proof hash the verifier
///      computed as keccak256(abi.encode(agentId, firewallId, executionId, executor,
///      transactionHash, blockNumber, target, selector, value, calldataHash)).
///      Anchors cannot be edited. A wrong proof is a new verification off-chain, not a rewrite.
contract AgentProof {
    struct Anchor {
        bytes32 proofHash;
        bytes32 executionId;
        uint256 agentId;
        uint256 firewallId;
        bytes32 transactionHash;
        uint64 anchoredAt;
        address verifier;
    }

    address public owner;
    address public verifier;

    mapping(bytes32 executionId => Anchor) private _anchors;
    mapping(bytes32 proofHash => bytes32 executionId) private _byHash;

    error ZeroAddress();
    error Unauthorized(address caller);
    error ProofAlreadyAnchored(bytes32 executionId);
    error ProofHashAlreadyUsed(bytes32 proofHash);
    error AnchorNotFound(bytes32 executionId);

    event VerifierUpdated(address indexed verifier, uint64 updatedAt);

    event ExecutionProofAnchored(
        bytes32 indexed proofHash,
        bytes32 indexed executionId,
        uint256 indexed agentId,
        uint256 firewallId,
        bytes32 transactionHash,
        address verifier,
        uint64 anchoredAt
    );

    constructor(address verifier_) {
        if (verifier_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        verifier = verifier_;
    }

    function setVerifier(address verifier_) external {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        if (verifier_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
        emit VerifierUpdated(verifier_, uint64(block.timestamp));
    }

    function anchorProof(
        bytes32 proofHash,
        bytes32 executionId,
        uint256 agentId,
        uint256 firewallId,
        bytes32 transactionHash
    ) external {
        if (msg.sender != verifier) revert Unauthorized(msg.sender);
        if (proofHash == bytes32(0) || executionId == bytes32(0) || transactionHash == bytes32(0)) {
            revert ZeroAddress();
        }
        if (_anchors[executionId].anchoredAt != 0) revert ProofAlreadyAnchored(executionId);
        if (_byHash[proofHash] != bytes32(0)) revert ProofHashAlreadyUsed(proofHash);

        Anchor storage row = _anchors[executionId];
        row.proofHash = proofHash;
        row.executionId = executionId;
        row.agentId = agentId;
        row.firewallId = firewallId;
        row.transactionHash = transactionHash;
        row.anchoredAt = uint64(block.timestamp);
        row.verifier = msg.sender;
        _byHash[proofHash] = executionId;

        emit ExecutionProofAnchored(
            proofHash,
            executionId,
            agentId,
            firewallId,
            transactionHash,
            msg.sender,
            row.anchoredAt
        );
    }

    function getAnchor(bytes32 executionId) external view returns (Anchor memory) {
        Anchor memory row = _anchors[executionId];
        if (row.anchoredAt == 0) revert AnchorNotFound(executionId);
        return row;
    }

    function isAnchored(bytes32 executionId) external view returns (bool) {
        return _anchors[executionId].anchoredAt != 0;
    }
}
