// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPausable} from "../src/interfaces/IPausable.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {AuditRegistry} from "../src/AuditRegistry.sol";
import {ComplianceAttestation} from "../src/ComplianceAttestation.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";
import {MigrationRegistry} from "../src/MigrationRegistry.sol";
import {PolicyCommitment} from "../src/PolicyCommitment.sol";
import {RevocationAnchor} from "../src/RevocationAnchor.sol";
import {SchemaRegistry} from "../src/SchemaRegistry.sol";
import {TrustAnchorRegistry} from "../src/TrustAnchorRegistry.sol";
import {VendorRegistry} from "../src/VendorRegistry.sol";

/**
 * @title PausabilityInvariantTest
 * @notice QTrustGovernance schedules pause/unpause via
 *         abi.encodeCall(IPausable.pause, ...). If any governable contract
 *         drifts away from that interface, governance calls would revert at
 *         execution time — long after scheduling. These compile-time-checked
 *         assignments pin every registry to IPausable so drift fails the
 *         build instead of governance.
 */
contract PausabilityInvariantTest is Test {
    function test_all_governable_contracts_implement_IPausable() public pure {
        IPausable a = AssetRegistry(address(1));
        IPausable au = AuditRegistry(address(1));
        IPausable c = ComplianceAttestation(address(1));
        IPausable e = EvidenceRegistry(address(1));
        IPausable m = MigrationRegistry(address(1));
        IPausable p = PolicyCommitment(address(1));
        IPausable r = RevocationAnchor(address(1));
        IPausable s = SchemaRegistry(address(1));
        IPausable t = TrustAnchorRegistry(address(1));
        IPausable v = VendorRegistry(address(1));

        // Silence unused-variable style; the assignments above are the test.
        assertFalse(address(a) == address(0));
        assertFalse(address(au) == address(0));
        assertFalse(address(c) == address(0));
        assertFalse(address(e) == address(0));
        assertFalse(address(m) == address(0));
        assertFalse(address(p) == address(0));
        assertFalse(address(r) == address(0));
        assertFalse(address(s) == address(0));
        assertFalse(address(t) == address(0));
        assertFalse(address(v) == address(0));
    }

    function test_interface_selectors_match_governance_encoding() public pure {
        // Governance encodes exactly these selectors (QTrustGovernance.sol).
        assertEq(IPausable.pause.selector, bytes4(keccak256("pause()")));
        assertEq(IPausable.unpause.selector, bytes4(keccak256("unpause()")));
    }
}
