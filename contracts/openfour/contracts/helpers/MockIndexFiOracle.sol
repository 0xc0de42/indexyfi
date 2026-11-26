// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IIndexFiOracle} from "../interfaces/IIndexFiOracle.sol";

contract MockIndexFiOracle is IIndexFiOracle {
    address public immutable settlementToken;
    address public immutable owner;
    bool public unavailable;
    mapping(address => uint256) private prices;

    constructor(address cash) {
        settlementToken = cash;
        owner = msg.sender;
    }

    function setPrice(address asset, uint256 price) external {
        require(msg.sender == owner);
        prices[asset] = price;
    }

    function setUnavailable(bool value) external {
        require(msg.sender == owner);
        unavailable = value;
    }

    function supportsAsset(address asset) external view returns (bool) {
        return asset == settlementToken || prices[asset] != 0;
    }

    function price18(address asset) external view returns (uint256) {
        require(!unavailable, "Mock oracle unavailable");
        if (asset == settlementToken) return 1e18;
        require(prices[asset] != 0, "Mock oracle missing");
        return prices[asset];
    }
}
