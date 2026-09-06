// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IPausable
 * @notice Minimal interface for pausable contracts used by governance.
 * @dev Lives in its own file so registries can inherit it (compile-time
 *      verification that every governable contract exposes pause/unpause)
 *      without importing QTrustGovernance, which imports the registries.
 *      Governance schedules calls via abi.encodeCall(IPausable.pause, ...),
 *      so this interface is the canonical governance-facing contract surface.
 */
interface IPausable {
    function pause() external;
    function unpause() external;
}
