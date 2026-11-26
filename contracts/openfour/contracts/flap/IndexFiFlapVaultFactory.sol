// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IndexFiFlapVault} from "./IndexFiFlapVault.sol";
import {IPortalTypes, Distribution, DistributionTarget, IDirectLaunchVaultFactory, VaultDataSchema, FieldDescriptor, FactoryPolicy} from "./FlapSpec.sol";

/// Immutable native factory; a prepared clone is returned only during its bound launcher's Portal callback.
/// Pre-acquisition is required to know the actual backing and NAV before committing the pool ratio.
contract IndexFiFlapVaultFactory is IDirectLaunchVaultFactory {
    address public immutable launcherFactory;
    address public immutable portal;
    address public immutable guardian;
    address public immutable quoteToken;
    address public immutable implementation;
    address private pendingVault;
    address private pendingLauncher;
    bytes32 private pendingParams;
    address public lastVault;
    constructor(address hub,address guard,address quote,address impl) {
        launcherFactory=msg.sender; portal=hub; guardian=guard; quoteToken=quote;
        require(impl.code.length!=0,"Native: implementation"); implementation=impl;
    }
    modifier onlyLauncherFactory(){ require(msg.sender==launcherFactory,"Native: launcher factory"); _; }
    function prepare() external onlyLauncherFactory returns(address vault){
        require(pendingVault==address(0),"Native: pending");
        vault=Clones.clone(implementation); pendingVault=vault;
    }
    function arm(address vault,address launcher,bytes32 paramsHash) external onlyLauncherFactory {
        require(vault==pendingVault&&pendingLauncher==address(0)&&launcher!=address(0),"Native: arm");
        pendingLauncher=launcher; pendingParams=paramsHash;
    }
    function newVault(address token,address creator,uint8 kind,bytes calldata launchParams) external returns(address vault){
        require(msg.sender==portal&&kind==0&&token!=address(0)&&creator==pendingLauncher&&pendingVault!=address(0)&&pendingParams==keccak256(launchParams),"Native: callback");
        (IPortalTypes.CreateTaxTokenParams memory p,Distribution memory d)=abi.decode(launchParams,(IPortalTypes.CreateTaxTokenParams,Distribution));
        require(p.quoteToken==quoteToken&&d.target==DistributionTarget.VAULT&&d.amount>0&&p.poolToken+uint256(d.amount)==p.totalSupply&&d.configData.length==0,"Native: allocation");
        vault=pendingVault;
        // One VAULT slot, bound to this factory; no deflationary or unrelated receivers.
        require(p.feeConfigs.length==1&&p.feeConfigs[0].feeType==IPortalTypes.FeeSlotType.VAULT&&p.feeConfigs[0].bps==10000,"Native: fee");
        IPortalTypes.FeeConfigVault memory slot=abi.decode(p.feeConfigs[0].configData,(IPortalTypes.FeeConfigVault));
        require(slot.vaultFactory==address(this)&&slot.vaultData.length==0,"Native: fee binding");
        pendingVault=address(0); pendingLauncher=address(0); pendingParams=bytes32(0); lastVault=vault;
        IndexFiFlapVault(vault).bindNativeToken(token);
    }
    function factorySpecVersion() external pure returns(string memory){return "pl-v1";}
    function isQuoteTokenSupported(address q) external view returns(bool){return q==quoteToken;}
    function vaultDataSchema() external pure returns(VaultDataSchema memory s){s.description="IndexFi vault: prepared and bound by its Launcher Factory";s.fields=new FieldDescriptor[](0);}
    function tokenCreationPolicies() external view returns(FactoryPolicy[] memory p){p=new FactoryPolicy[](1);p[0]=FactoryPolicy("quoteToken","eq",abi.encode(quoteToken),"IndexFi settlement token");}
    function upgradeVaultImplementation(address) external view {require(msg.sender==guardian,"Native: guardian");revert("Native: immutable vaults");}
}
