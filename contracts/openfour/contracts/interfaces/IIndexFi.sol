// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIndexFiFactory {
    struct Constituent {
        address token;
        uint16 weightBps;
    }

    struct Basket {
        string name;
        string symbol;
        string metadataURI;
        Constituent[] constituents;
    }

    struct LaunchConfig {
        address creator;
        Constituent[] assets;
        address adapter;
        address oracle;
        address router;
        address factory;
        uint256 collateralUSDT;
        uint256 liquidityUSDT;
        uint256 minCreatorShares;
        bytes32 minimumsHash;
    }
    event VaultCreated(address indexed creator, address indexed vault, uint256 indexed requestId, uint256 seedUSDT);
    event PortfolioLaunched(
        address indexed vault,
        address indexed token,
        address indexed pair,
        uint256 collateralUSDT,
        uint256 liquidityUSDT,
        uint256 outstandingSupply
    );
    function settlementToken() external view returns (address);
    function minimumSeed() external view returns (uint256);
    function vaultCount() external view returns (uint256);
    function vaultAt(uint256 index) external view returns (address);
    function isVault(address candidate) external view returns (bool);
    function usedRequestIds(uint256 requestId) external view returns (bool);
    function previewCreate(Basket calldata basket, uint256 seedUSDT) external view returns (uint256[] memory);
    function buildCreateArgs(
        uint256 requestId,
        address creator,
        Basket calldata basket,
        uint256 seedUSDT,
        uint256 liquidityUSDT,
        uint256 minCreatorShares,
        uint256[] calldata minTokenOut,
        uint256 deadline,
        uint256 createFee
    ) external view returns (bytes memory);
    function createVault(
        uint256 requestId,
        Basket calldata basket,
        uint256 seedUSDT,
        uint256 liquidityUSDT,
        uint256 minCreatorShares,
        uint256[] calldata minTokenOut,
        uint256 deadline,
        bytes calldata launchAuthorization
    ) external payable returns (address vault, uint256 seedShares);
}

interface IIndexFiVault {
    event Deposited(address indexed holder, uint256 usdtIn, uint256 shares, uint256 creatorFeeUSDT);
    event Redeemed(address indexed holder, uint256 shares, uint256 grossUSDT, uint256 creatorFeeUSDT, uint256 netUSDT);
    event RedeemedInKind(address indexed holder, uint256 shares);
    event RedeemedAsset(
        address indexed holder, address indexed asset, uint256 grossAmount, uint256 creatorFeeAmount, uint256 netAmount
    );
    event Seeded(uint256 collateralUSDT, uint256 liquidityUSDT, uint256 outstanding, uint256 creatorShares);
    event LiquidityMigrated(address indexed pair, address indexed creator);
    event VaultClosed();
    function creator() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function metadataURI() external view returns (string memory);
    function settlementToken() external view returns (address);
    function constituents() external view returns (IIndexFiFactory.Constituent[] memory);
    function closed() external view returns (bool);
    // Vault totalSupply means backed claims, NOT the standard ERC20's pre-minted totalSupply.
    function totalSupply() external view returns (uint256);
    function balanceOf(address holder) external view returns (uint256);
    function collateralBalance(address asset) external view returns (uint256);
    function nav() external view returns (uint256);
    function collateralValue() external view returns (uint256);
    function previewDeposit(uint256 usdtIn) external view returns (uint256 shares, uint256[] memory tokenOut);
    function previewRedeem(address holder, uint256 shares)
        external
        view
        returns (uint256 grossUSDT, uint256 creatorFeeUSDT, uint256 netUSDT);
    function previewRedeemAssets(address holder, uint256 shares)
        external
        view
        returns (uint256[] memory assetAmounts, uint256[] memory expectedUSDT);
    function previewRedeemInKind(address holder, uint256 shares)
        external
        view
        returns (uint256[] memory grossAmounts, uint256[] memory creatorFeeAmounts, uint256[] memory netAmounts);
    function deposit(uint256 usdtIn, uint256 minSharesOut, uint256[] calldata minTokenOut, uint256 deadline)
        external
        returns (uint256 shares);
    function redeem(uint256 shares, uint256 minNetUSDT, uint256[] calldata minAssetOut, uint256 deadline)
        external
        returns (uint256 netUSDT, uint256 creatorFeeUSDT);
    function redeemInKind(uint256 shares, uint256[] calldata minAmountsOut, uint256 deadline)
        external
        returns (uint256[] memory netAmounts, uint256[] memory creatorFeeAmounts);
}
