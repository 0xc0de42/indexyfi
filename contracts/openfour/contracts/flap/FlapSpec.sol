// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
// ABI subset of flap-sh/FlapPoolLaunchVaultExample, IPortal.sol, Distribution.sol,
// IStrategy.sol, ILauncher.sol, ILaunchVaultSpec.sol, IVaultSchemas.sol (MIT).
// See FLAP_VALIDATION.md for source blob identifiers and integration limitations.
enum DistributionTarget { NONE, EXPLICIT, VAULT }
struct Distribution { DistributionTarget target; address strategy; uint128 amount; bytes configData; }
struct LauncherRecord { address launcherFactory; }
struct FieldDescriptor { string name; string fieldType; string description; uint8 decimals; }
struct LauncherDataSchema { string description; FieldDescriptor[] fields; bool isArray; }
interface ILauncherFactory {
    function newLauncher(address creator, bytes calldata data) external payable returns (address);
    function factorySpecVersion() external pure returns (string memory);
    function launcherDataSchema() external pure returns (LauncherDataSchema memory);
    function upgradeVaultImplementation(address newImplementation) external;
}
interface IPortalTypes {
    enum FeeSlotType { NONE, DEFLATION, LP_BPS, MARKETING, VAULT, DIVIDEND }
    struct FeeConfig { FeeSlotType feeType; uint16 bps; bytes configData; }
    struct FeeConfigVault { address vaultFactory; bytes vaultData; }
    struct CreateTaxTokenParams {
        string name; string symbol; string meta; uint256 totalSupply; bytes32 salt;
        address quoteToken; uint8 dexId; uint256 poolQuote; uint256 poolToken;
        uint16 buyTaxRate; uint16 sellTaxRate; uint32 taxDuration; uint32 antiFarmerDuration;
        FeeConfig[] feeConfigs; uint8 antiSniperMode; uint32 exemptWindow; address[] exemptAddrs;
        uint256 creatorBuyQuote; bytes32 extensionID; bytes extensionData; address commissionReceiver;
    }
    struct CreatorBuyParams { uint256 minOutputAmount; bytes permitData; }
}
interface IPortal {
    function newLauncher(address launcherFactory, bytes calldata data) external payable returns (address launcher);
    function getLauncher(address launcher) external view returns (LauncherRecord memory);
    function launchTaxTokenV2(IPortalTypes.CreateTaxTokenParams calldata p, Distribution calldata distribution,
        IPortalTypes.CreatorBuyParams calldata creatorBuy) external payable returns (address token, address pool);
    function launcherFactoryMultiplier(address factory) external view returns (bool enabled, uint16 multiplierBps);
    function setLauncherFactoryMultiplier(address factory, uint16 multiplierBps, bool enabled) external;
}
interface IStrategy {
    event FlapDistributionInitialized(address token, uint256 amount);
    function initializeDistribution(address token, uint256 amount, bytes calldata configData, bytes32 salt) external;
}
interface ITokenDock {
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount, address to) external;
    function balanceOf(address token, address owner) external view returns (uint256);
}
interface IFlapV2Router { function factory() external view returns(address); }
interface IFlapV2Factory { function getPair(address,address) external view returns(address); }
interface IFlapV2Pair { function token0() external view returns(address); function token1() external view returns(address); function getReserves() external view returns(uint112,uint112,uint32); }

struct VaultDataSchema { string description; FieldDescriptor[] fields; bool isArray; }
struct ApproveAction { string tokenType; string amountFieldName; }
struct VaultMethodSchema { string name; string description; FieldDescriptor[] inputs; FieldDescriptor[] outputs; ApproveAction[] approvals; bool isInputArray; bool isOutputArray; bool isWriteMethod; }
struct VaultUISchema { string vaultType; string description; VaultMethodSchema[] methods; }
struct FactoryPolicy { string target; string operator; bytes value; string description; }
interface IDirectLaunchVaultFactory {
    function newVault(address token,address creator,uint8 launchKind,bytes calldata launchParams) external returns(address vault);
    function isQuoteTokenSupported(address quoteToken) external view returns(bool);
    function factorySpecVersion() external pure returns(string memory);
    function vaultDataSchema() external pure returns(VaultDataSchema memory);
    function tokenCreationPolicies() external view returns(FactoryPolicy[] memory);
    function upgradeVaultImplementation(address newImplementation) external;
}
interface IDirectLaunchVault {
    function description() external view returns(string memory);
    function vaultUISchema() external pure returns(VaultUISchema memory);
}
