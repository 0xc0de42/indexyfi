// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// Test-only constant-product pool, with 25 bps swap fee and permanently locked minimum LP.
/// Not PancakeSwap bytecode; used to exercise non-linear execution and migration library.
contract MockV2Pair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable token0;
    address public immutable token1;
    uint256 public reserve0;
    uint256 public reserve1;

    constructor(address a, address b) ERC20("Fixture LP", "FLP") {
        token0 = a;
        token1 = b;
    }

    function _sync() private {
        reserve0 = IERC20(token0).balanceOf(address(this));
        reserve1 = IERC20(token1).balanceOf(address(this));
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        require(reserve0 <= type(uint112).max && reserve1 <= type(uint112).max, "Fixture: reserve overflow");
        return (uint112(reserve0), uint112(reserve1), uint32(block.timestamp));
    }

    function skim(address to) external nonReentrant {
        require(to != address(0), "Fixture: recipient");
        uint256 excess0 = IERC20(token0).balanceOf(address(this)) - reserve0;
        uint256 excess1 = IERC20(token1).balanceOf(address(this)) - reserve1;
        if (excess0 != 0) IERC20(token0).safeTransfer(to, excess0);
        if (excess1 != 0) IERC20(token1).safeTransfer(to, excess1);
    }

    function sync() external nonReentrant {
        _sync();
    }

    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        uint256 a = IERC20(token0).balanceOf(address(this)) - reserve0;
        uint256 b = IERC20(token1).balanceOf(address(this)) - reserve1;
        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(a * b) - 1000;
            _mint(address(0xdead), 1000);
        } else {
            liquidity = Math.min(Math.mulDiv(a, supply, reserve0), Math.mulDiv(b, supply, reserve1));
        }
        require(liquidity > 0, "Fixture: liquidity");
        _mint(to, liquidity);
        _sync();
    }

    function burn(address to) external nonReentrant returns (uint256 a, uint256 b) {
        uint256 lp = balanceOf(address(this));
        uint256 supply = totalSupply();
        a = Math.mulDiv(lp, IERC20(token0).balanceOf(address(this)), supply);
        b = Math.mulDiv(lp, IERC20(token1).balanceOf(address(this)), supply);
        require(a > 0 && b > 0, "Fixture: burn");
        _burn(address(this), lp);
        IERC20(token0).safeTransfer(to, a);
        IERC20(token1).safeTransfer(to, b);
        _sync();
    }

    function quote(address input, uint256 amount) public view returns (uint256) {
        require(input == token0 || input == token1, "Fixture: token");
        (uint256 x, uint256 y) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        require(x > 0 && y > 0 && amount > 0, "Fixture: reserves");
        uint256 feeInput = amount * 9975;
        return Math.mulDiv(feeInput, y, x * 10000 + feeInput);
    }

    function swap(address input, address to) external nonReentrant returns (uint256 out) {
        require(input == token0 || input == token1, "Fixture: token");
        uint256 amount = IERC20(input).balanceOf(address(this)) - (input == token0 ? reserve0 : reserve1);
        out = quote(input, amount);
        require(out > 0, "Fixture: output");
        IERC20(input == token0 ? token1 : token0).safeTransfer(to, out);
        _sync();
    }
}

contract MockV2Factory {
    mapping(address => mapping(address => address)) public getPair;

    function createPair(address a, address b) external returns (address pair) {
        require(a != b && a != address(0) && b != address(0) && getPair[a][b] == address(0), "Fixture: pair");
        (address x, address y) = a < b ? (a, b) : (b, a);
        pair = address(new MockV2Pair(x, y));
        getPair[a][b] = pair;
        getPair[b][a] = pair;
    }
}

contract MockV2Router {
    using SafeERC20 for IERC20;
    MockV2Factory public immutable factory;

    constructor(address factory_) {
        factory = MockV2Factory(factory_);
    }

    function getAmountsOut(uint256 input, address[] calldata path) external view returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = input;
        for (uint256 i = 1; i < path.length; ++i) {
            amounts[i] = MockV2Pair(factory.getPair(path[i - 1], path[i])).quote(path[i - 1], amounts[i - 1]);
        }
    }

    function swapExactTokensForTokens(
        uint256 input,
        uint256 minOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline && path.length >= 2, "Fixture: deadline/path");
        amounts = new uint256[](path.length);
        amounts[0] = input;
        IERC20(path[0]).safeTransferFrom(msg.sender, factory.getPair(path[0], path[1]), input);
        for (uint256 i = 1; i < path.length; ++i) {
            address next = i + 1 == path.length ? to : factory.getPair(path[i], path[i + 1]);
            amounts[i] = MockV2Pair(factory.getPair(path[i - 1], path[i])).swap(path[i - 1], next);
        }
        require(amounts[amounts.length - 1] >= minOut, "Fixture: slippage");
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 desiredA,
        uint256 desiredB,
        uint256 minA,
        uint256 minB,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(block.timestamp <= deadline, "Fixture: deadline");
        MockV2Pair pair = MockV2Pair(factory.getPair(tokenA, tokenB));
        (uint256 a, uint256 b) =
            pair.token0() == tokenA ? (pair.reserve0(), pair.reserve1()) : (pair.reserve1(), pair.reserve0());
        require(a > 0 && b > 0, "Fixture: empty pair");
        amountA = desiredA;
        amountB = Math.mulDiv(desiredA, b, a);
        if (amountB > desiredB) amountB = desiredB;
        amountA = Math.mulDiv(desiredB, a, b);
        require(amountA >= minA && amountB >= minB, "Fixture: slippage");
        IERC20(tokenA).safeTransferFrom(msg.sender, address(pair), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(pair), amountB);
        liquidity = pair.mint(to);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 minA,
        uint256 minB,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB) {
        require(block.timestamp <= deadline, "Fixture: deadline");
        MockV2Pair pair = MockV2Pair(factory.getPair(tokenA, tokenB));
        IERC20(address(pair)).safeTransferFrom(msg.sender, address(pair), liquidity);
        (uint256 x, uint256 y) = pair.burn(to);
        (amountA, amountB) = pair.token0() == tokenA ? (x, y) : (y, x);
        require(amountA >= minA && amountB >= minB, "Fixture: slippage");
    }
}
