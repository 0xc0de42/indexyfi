// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {IndexFiShare} from "../token/IndexFiShare.sol";
import {OpenFourToken} from "../token/OpenFourToken.sol";
import {IndexFiVault} from "../modules/vault/IndexFiVault.sol";

contract MockIndexFiCore {
    address public immutable tokenImplementation;
    address public immutable vaultImplementation;

    constructor(address token_, address vault_) { tokenImplementation = token_; vaultImplementation = vault_; }

    function createToken(bytes memory encoded, bytes memory) external payable returns (address token) {
        OpenFourTypes.CreateTokenArgs memory a = abi.decode(encoded, (OpenFourTypes.CreateTokenArgs));
        require(a.validTimestamp >= block.timestamp, "Core: expired");
        token = Clones.clone(tokenImplementation);
        address vault = Clones.clone(vaultImplementation);
        OpenFourTypes.TokenCreateParams memory p = OpenFourTypes.TokenCreateParams({
            requestId: a.requestId, name: a.initParams.name, symbol: a.initParams.symbol,
            maxSupply: a.initParams.maxSupply, saleAmount: a.initParams.saleAmount,
            raiseAmount: a.initParams.raiseAmount, quoteAsset: a.initParams.quoteAsset,
            tokenUri: a.initParams.tokenUri, tokenParams: a.initParams.tokenParams,
            tokenSalt: a.initParams.tokenSalt
        });
        IndexFiVault(vault).init(token, address(this), msg.sender, address(this), p, a.initParams.vaultParams, "local-1");
        IndexFiShare(token).initialize(OpenFourToken.InitArgs({
            requestId: a.requestId, name: p.name, symbol: p.symbol, vault: vault,
            maxSupply: 0, tokenUri: p.tokenUri, curveModule: address(this), tradeModule: address(this),
            migrateModule: address(this), tokenModule: address(this), customDataModule: address(0),
            creator: msg.sender, quoteAsset: p.quoteAsset, tokenParams: p.tokenParams,
            tokenImplVersion: "local-1"
        }));
    }
}
