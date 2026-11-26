// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {OpenFourToken} from "../token/OpenFourToken.sol";
import {StandardTokenModule} from "../modules/token/StandardTokenModule.sol";
import {IndexFiVault} from "../modules/vault/IndexFiVault.sol";
import {IndexFiMigrateModule} from "../modules/IndexFiOpenFourModules.sol";

/// Local-only fixture. NOT a substitute for real Core authorization, lifecycle or fee checks.
contract MockIndexFiCore {
    address public immutable tokenImplementation;
    address public immutable vaultImplementation;
    address public immutable migrationImplementation;
    address public immutable tokenModuleImplementation;

    constructor(address token_, address vault_, address migration_, address tokenModule_) {
        tokenImplementation = token_;
        vaultImplementation = vault_;
        migrationImplementation = migration_;
        tokenModuleImplementation = tokenModule_;
    }

    function wrappedNative() external pure returns (address) {
        return address(0);
    }

    function createToken(bytes memory encoded, bytes memory) external payable returns (address token) {
        OpenFourTypes.CreateTokenArgs memory a = abi.decode(encoded, (OpenFourTypes.CreateTokenArgs));
        require(a.validTimestamp >= block.timestamp && a.presaleQuote == 0, "Core: args");
        token = Clones.clone(tokenImplementation);
        address vault = Clones.clone(vaultImplementation);
        address migration = Clones.clone(migrationImplementation);
        address tm = Clones.clone(tokenModuleImplementation);
        OpenFourTypes.TokenCreateParams memory p = OpenFourTypes.TokenCreateParams({
            requestId: a.requestId,
            name: a.initParams.name,
            symbol: a.initParams.symbol,
            maxSupply: a.initParams.maxSupply,
            saleAmount: a.initParams.saleAmount,
            raiseAmount: a.initParams.raiseAmount,
            quoteAsset: a.initParams.quoteAsset,
            tokenUri: a.initParams.tokenUri,
            tokenParams: a.initParams.tokenParams,
            tokenSalt: a.initParams.tokenSalt
        });
        IndexFiVault(vault).init(token, address(this), msg.sender, migration, p, a.initParams.vaultParams, "fixture-v5");
        StandardTokenModule(tm)
            .createToken(
                msg.sender,
                token,
                vault,
                address(this),
                address(this),
                migration,
                address(0),
                p,
                "fixture-v5",
                "fixture-v5"
            );
        IndexFiMigrateModule(migration).init(token, address(this), address(0), a.initParams.migrateParams, "fixture-v5");
        IndexFiVault(vault).setPhase(OpenFourTypes.Phase.Trading);
    }

    function migrate(address token) external {
        IndexFiVault v = IndexFiVault(OpenFourToken(token).vault());
        require(v.phase() == OpenFourTypes.Phase.Trading, "Core: phase");
        IndexFiMigrateModule m = IndexFiMigrateModule(OpenFourToken(token).migrateModule());
        OpenFourTypes.MigrateResult memory r = m.evaluate(
            OpenFourTypes.MigrateContext(token, v.totalRaised(), v.remainingForSale(), v.isSoldOut(), block.timestamp)
        );
        require(r.canMigrate, "Core: not eligible");
        v.setPhase(OpenFourTypes.Phase.MigratePending);
        m.executeMigration(
            OpenFourTypes.MigrateHookContext(
                address(v), token, v.quoteAsset(), msg.sender, v.totalRaised(), v.remainingForSale(), block.timestamp
            ),
            r.data
        );
        v.setPhase(OpenFourTypes.Phase.Migrated);
    }
}
