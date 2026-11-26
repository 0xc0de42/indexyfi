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

    event VaultCreated(address indexed creator, address indexed vault, uint256 seedUSDT);

    function settlementToken() external view returns (address);
    function minimumSeed() external view returns (uint256);
    function vaultCount() external view returns (uint256);
    function vaultAt(uint256 index) external view returns (address);
    function previewCreate(Basket calldata basket, uint256 seedUSDT)
        external view returns (uint256[] memory tokenOut);

    function createVault(
        Basket calldata basket,
        uint256 seedUSDT,
        uint256[] calldata minTokenOut,
        uint256 deadline,
        bytes calldata launchAuthorization
    ) external payable returns (address vault, uint256 seedShares);
}

interface IIndexFiVault {
    event Deposited(address indexed holder, uint256 usdtIn, uint256 shares);
    event Redeemed(address indexed holder, uint256 shares, uint256 basisUSDT,
        uint256 grossUSDT, uint256 creatorFeeUSDT, uint256 netUSDT);
    event VaultClosed();

    function creator() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function metadataURI() external view returns (string memory);
    function settlementToken() external view returns (address);
    function constituents() external view returns (IIndexFiFactory.Constituent[] memory);
    function closed() external view returns (bool);
    function totalSupply() external view returns (uint256);
    function balanceOf(address holder) external view returns (uint256);
    function costBasisUSDT(address holder) external view returns (uint256);
    function previewDeposit(uint256 usdtIn)
        external view returns (uint256 shares, uint256[] memory tokenOut);
    function previewRedeem(address holder, uint256 shares)
        external view returns (uint256 grossUSDT, uint256 creatorFeeUSDT, uint256 netUSDT);

    function deposit(uint256 usdtIn, uint256 minSharesOut, uint256[] calldata minTokenOut,
        uint256 deadline) external returns (uint256 shares);
    function redeem(uint256 shares, uint256 minNetUSDT, uint256 deadline)
        external returns (uint256 netUSDT, uint256 creatorFeeUSDT);
}
