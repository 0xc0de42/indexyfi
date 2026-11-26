// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAsset is ERC20 {
    uint8 private immutable precision;
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        precision = decimals_;
    }
    function decimals() public view override returns (uint8) { return precision; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
