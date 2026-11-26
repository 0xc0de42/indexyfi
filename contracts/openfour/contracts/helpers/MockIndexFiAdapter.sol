// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IIndexFiAdapter} from "../interfaces/IIndexFiAdapter.sol";

contract MockIndexFiAdapter is IIndexFiAdapter {
    using SafeERC20 for IERC20;
    address public immutable settlementToken;
    address public immutable owner;
    mapping(address => uint256) public price;

    constructor(address settlement_) { settlementToken = settlement_; owner = msg.sender; }
    function setPrice(address token, uint256 value) external { require(msg.sender == owner, "IndexFi: only owner"); price[token] = value; }
    function unit(address token) public view returns (uint256) { return 10 ** uint256(IERC20Metadata(token).decimals()); }
    function quoteBuy(address token, uint256 usdt) public view returns (uint256) {
        require(price[token] != 0, "IndexFi: unsupported asset");
        return Math.mulDiv(usdt, unit(token), price[token]);
    }
    function quoteSell(address token, uint256 amount) public view returns (uint256) {
        require(price[token] != 0, "IndexFi: unsupported asset");
        return Math.mulDiv(amount, price[token], unit(token));
    }
    function buy(address token, uint256 usdt, uint256 minimum, uint256 deadline) external {
        require(block.timestamp <= deadline, "IndexFi: expired");
        uint256 amount = quoteBuy(token, usdt);
        require(amount >= minimum, "IndexFi: buy slippage");
        IERC20(settlementToken).safeTransferFrom(msg.sender, address(this), usdt);
        IERC20(token).safeTransfer(msg.sender, amount);
    }
    function sell(address token, uint256 amount, uint256 minimum, uint256 deadline) external {
        require(block.timestamp <= deadline, "IndexFi: expired");
        uint256 usdt = quoteSell(token, amount);
        require(usdt >= minimum, "IndexFi: sell slippage");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(settlementToken).safeTransfer(msg.sender, usdt);
    }
}
