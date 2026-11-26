// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
// Adapted from the MIT-licensed Flap LauncherFactoryBase (blob 5165194165d1106d79f1809f738687854ba028c2).
// Same Portal-facing ABI and authorization, with abstract address resolution for explicit fixture/live separation.
import {ILauncherFactory, LauncherDataSchema} from "./FlapSpec.sol";
abstract contract LauncherFactoryBase is ILauncherFactory {
    error NotHub(address caller);
    error NotGuardian(address caller);
    modifier onlyHub() { if (msg.sender != _getHub()) revert NotHub(msg.sender); _; }
    modifier onlyGuardian() { if (msg.sender != _getGuardian()) revert NotGuardian(msg.sender); _; }
    function _getHub() internal view virtual returns(address);
    function _getGuardian() internal view virtual returns(address);
    function factorySpecVersion() external pure virtual override returns(string memory) { return "lf-v1"; }
    function newLauncher(address creator, bytes calldata data) external payable override onlyHub returns(address launcher) { return _newLauncher(creator,data); }
    function launcherDataSchema() external pure virtual override returns(LauncherDataSchema memory);
    function upgradeVaultImplementation(address newImplementation) external virtual override;
    function _newLauncher(address creator, bytes calldata data) internal virtual returns(address launcher);
}
