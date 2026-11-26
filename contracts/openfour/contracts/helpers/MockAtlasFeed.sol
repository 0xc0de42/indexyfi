// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockAtlasFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public source;
    uint256 public updated;
    uint80 public round;

    constructor(uint8 d) {
        decimals = d;
    }

    function set(int256 p, uint256 s, uint256 u, uint80 r) external {
        answer = p;
        source = s;
        updated = u;
        round = r;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, answer, source, updated, round);
    }
}
