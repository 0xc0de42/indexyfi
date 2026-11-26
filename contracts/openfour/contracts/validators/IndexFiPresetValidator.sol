// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IOpenFourPresetValidator} from "../interfaces/IOpenFourPresetValidator.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

contract IndexFiPresetValidator is IOpenFourPresetValidator {
    address public immutable settlementToken;
    // A zero settlement token keeps the preset asset-agnostic; a production
    // deployment may pin this to the chain's canonical USDT address.
    constructor(address settlement_) { settlementToken = settlement_; }
    function validate(uint256, OpenFourTypes.TokenInitParams calldata p) external view {
        require(settlementToken == address(0) || p.quoteAsset == settlementToken, "IndexFi: wrong settlement");
        require(p.maxSupply == 0 && p.saleAmount == 0 && p.raiseAmount == 0, "IndexFi: dynamic supply required");
        require(bytes(p.name).length != 0 && bytes(p.symbol).length != 0, "IndexFi: empty identity");
        require(p.vaultParams.length != 0, "IndexFi: missing basket");
    }
}
