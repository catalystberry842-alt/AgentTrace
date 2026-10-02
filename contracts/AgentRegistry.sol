// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title AgentRegistry
/// @notice Persistent identities for AI agents. IDs start at 1 and are never reused or deleted.
/// @dev Capability bits: Trading 1<<0, Yield 1<<1, DeFi 1<<2, Payments 1<<3,
///      Research 1<<4, Data 1<<5, Social 1<<6, Gaming 1<<7, Other 1<<8.
///      Ownership is msg.sender. There is no admin and the contract is not upgradeable.
contract AgentRegistry {
    uint256 internal constant CAPABILITY_MASK = (uint256(1) << 9) - 1;

    struct Agent {
        uint256 agentId;
        address owner;
        string name;
        string description;
        string metadataURI;
        uint256 capabilities;
        uint64 registeredAt;
        bool active;
    }

    uint256 public nextAgentId = 1;

    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256[]) private _owned;

    error EmptyName();
    error NameTooLong();
    error DescriptionTooLong();
    error MetadataTooLong();
    error InvalidCapabilities();
    error AgentNotFound(uint256 agentId);
    error NotOwner(uint256 agentId, address caller);
    error InactiveAgent(uint256 agentId);

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string name,
        string description,
        string metadataURI,
        uint256 capabilities,
        uint64 registeredAt
    );

    event AgentUpdated(
        uint256 indexed agentId,
        address indexed owner,
        string name,
        string description,
        string metadataURI,
        uint256 capabilities,
        uint64 updatedAt
    );

    event AgentDeactivated(uint256 indexed agentId, address indexed owner, uint64 deactivatedAt);

    function registerAgent(
        string calldata name,
        string calldata description,
        string calldata metadataURI,
        uint256 capabilities
    ) external returns (uint256 agentId) {
        _validate(name, description, metadataURI, capabilities);
        agentId = nextAgentId;
        nextAgentId = agentId + 1;

        Agent storage agent = _agents[agentId];
        agent.agentId = agentId;
        agent.owner = msg.sender;
        agent.name = name;
        agent.description = description;
        agent.metadataURI = metadataURI;
        agent.capabilities = capabilities;
        agent.registeredAt = uint64(block.timestamp);
        agent.active = true;
        _owned[msg.sender].push(agentId);

        emit AgentRegistered(
            agentId,
            msg.sender,
            name,
            description,
            metadataURI,
            capabilities,
            agent.registeredAt
        );
    }

    function updateAgentMetadata(
        uint256 agentId,
        string calldata name,
        string calldata description,
        string calldata metadataURI,
        uint256 capabilities
    ) external {
        Agent storage agent = _activeOwned(agentId);
        _validate(name, description, metadataURI, capabilities);
        agent.name = name;
        agent.description = description;
        agent.metadataURI = metadataURI;
        agent.capabilities = capabilities;
        emit AgentUpdated(
            agentId,
            agent.owner,
            name,
            description,
            metadataURI,
            capabilities,
            uint64(block.timestamp)
        );
    }

    function deactivateAgent(uint256 agentId) external {
        Agent storage agent = _activeOwned(agentId);
        agent.active = false;
        emit AgentDeactivated(agentId, agent.owner, uint64(block.timestamp));
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (!_exists(agentId)) revert AgentNotFound(agentId);
        return _agents[agentId];
    }

    function getAgentCount() external view returns (uint256) {
        return nextAgentId - 1;
    }

    function getAgentsByOwner(address owner) external view returns (uint256[] memory) {
        return _owned[owner];
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return _exists(agentId);
    }

    function getAgentOwner(uint256 agentId) external view returns (address) {
        if (!_exists(agentId)) revert AgentNotFound(agentId);
        return _agents[agentId].owner;
    }

    function _exists(uint256 agentId) private view returns (bool) {
        return agentId != 0 && agentId < nextAgentId && _agents[agentId].owner != address(0);
    }

    function _activeOwned(uint256 agentId) private view returns (Agent storage agent) {
        if (!_exists(agentId)) revert AgentNotFound(agentId);
        agent = _agents[agentId];
        if (agent.owner != msg.sender) revert NotOwner(agentId, msg.sender);
        if (!agent.active) revert InactiveAgent(agentId);
    }

    function _validate(
        string calldata name,
        string calldata description,
        string calldata metadataURI,
        uint256 capabilities
    ) private pure {
        uint256 nameLen = bytes(name).length;
        if (nameLen == 0) revert EmptyName();
        if (nameLen > 64) revert NameTooLong();
        if (bytes(description).length > 280) revert DescriptionTooLong();
        if (bytes(metadataURI).length > 200) revert MetadataTooLong();
        if (capabilities == 0 || (capabilities & ~CAPABILITY_MASK) != 0) revert InvalidCapabilities();
    }
}
