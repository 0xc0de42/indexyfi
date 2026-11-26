// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourCurveModule} from "../interfaces/IOpenFourCurveModule.sol";
import {IOpenFourTradeModule} from "../interfaces/IOpenFourTradeModule.sol";
import {IOpenFourMigrateModule} from "../interfaces/IOpenFourMigrateModule.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

abstract contract IndexFiSlot is Initializable {
    address internal boundToken;
    address internal boundCore;
    bytes internal parameters;
    string internal version;
    constructor() { _disableInitializers(); }
}

contract IndexFiCurveModule is IndexFiSlot, IOpenFourCurveModule {
    function getInitParams() external view returns(bytes memory){return parameters;}
    function init(address token, address core, OpenFourTypes.TokenCreateParams calldata,
        bytes calldata params, string calldata version_) external initializer {
        boundToken=token;boundCore=core;parameters=params;version=version_;
    }
    function descriptor() external view returns(bytes8 id,string memory tag,string memory version_){tag="module.curve.indexfi";return(bytes8(keccak256(bytes(tag))),tag,version);}
    function evaluate(OpenFourTypes.CurveContext calldata) external pure returns(OpenFourTypes.CurveResult memory result){result.reason="Use IndexFiVault.deposit or redeem";}
    function evaluateReverse(address,bool,uint256,uint256,uint256,uint256) external pure returns(uint256,uint256){return(0,0);}
    function getInitialPrice() external pure returns(uint256){return 0;}
    function getLastPrice(address,uint256,uint256) external pure returns(uint256){return 0;}
    function getLiquiditySnapshot(address,uint256,uint256) external pure returns(OpenFourTypes.CurveLiquiditySnapshot memory snapshot){return snapshot;}
}

contract IndexFiTradeModule is IndexFiSlot, IOpenFourTradeModule {
    function getInitParams() external view returns(bytes memory){return parameters;}
    function init(address token,address core,bytes calldata params,string calldata version_) external initializer {boundToken=token;boundCore=core;parameters=params;version=version_;}
    function descriptor() external view returns(bytes8 id,string memory tag,string memory version_){tag="module.trade.indexfi";return(bytes8(keccak256(bytes(tag))),tag,version);}
    function evaluate(OpenFourTypes.TradeContext calldata) external pure returns(OpenFourTypes.TradeResult memory result){result.revertData=abi.encodeWithSignature("Error(string)","Use IndexFiVault.deposit or redeem");}
}

contract IndexFiMigrateModule is IndexFiSlot, IOpenFourMigrateModule {
    function getInitParams() external view returns(bytes memory){return parameters;}
    function init(address token,address core,address,bytes calldata params,string calldata version_) external initializer {boundToken=token;boundCore=core;parameters=params;version=version_;}
    function descriptor() external view returns(bytes8 id,string memory tag,string memory version_){tag="module.migrate.indexfi";return(bytes8(keccak256(bytes(tag))),tag,version);}
    function evaluate(OpenFourTypes.MigrateContext calldata) external pure returns(OpenFourTypes.MigrateResult memory result){result.reason="Vault is immediately public";}
    function executeMigration(OpenFourTypes.MigrateHookContext calldata,bytes calldata) external pure returns(uint8,bytes memory){revert("IndexFi: optional graduation unavailable");}
}
