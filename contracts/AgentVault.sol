// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title AgentVault
/// @notice The per-firewall account an AgentFirewallV3 calls through. Targets see the vault as
///         msg.sender, so tokens a protocol pays to the caller land here, owned by one agent,
///         instead of in a contract every agent shares.
/// @dev Deployed by the firewall with CREATE2 (salt = firewallId), so its address is known
///      before the firewall exists. Two entry points only:
///      - forward: the firewall, after every policy check has passed.
///      - ownerCall: the agent's current registry owner, to withdraw or rescue assets.
///      No delegated calls, no upgrade, no admin.
interface IAgentVaultFirewall {
    function vaultOwner(uint256 firewallId) external view returns (address);
}

contract AgentVault {
    address public immutable firewall;
    uint256 public immutable firewallId;

    error OnlyFirewall(address caller);
    error OnlyOwner(address caller);

    event OwnerCall(address indexed owner, address indexed target, uint256 value, bytes4 selector);

    constructor(uint256 firewallId_) {
        firewall = msg.sender;
        firewallId = firewallId_;
    }

    receive() external payable {}

    function forward(address target, bytes calldata data) external payable returns (bytes memory) {
        if (msg.sender != firewall) revert OnlyFirewall(msg.sender);
        return _call(target, msg.value, data);
    }

    /// @notice The agent owner moves assets out of the vault (or calls anything as the vault).
    ///         The owner is read live from the registry through the firewall, so a transferred
    ///         agent identity moves vault control with it.
    function ownerCall(address target, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        address owner = IAgentVaultFirewall(firewall).vaultOwner(firewallId);
        if (msg.sender != owner) revert OnlyOwner(msg.sender);
        emit OwnerCall(owner, target, value, data.length >= 4 ? bytes4(data[:4]) : bytes4(0));
        return _call(target, value, data);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function _call(address target, uint256 value, bytes calldata data) private returns (bytes memory ret) {
        bool ok;
        (ok, ret) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
