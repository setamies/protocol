// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// External interface for aETHc
// See: https://etherscan.io/address/0x6a9366f02b6e252e0cbe2e6b9cf0a8addd7b641c#code

interface IankrETH {
    // @dev From AETH_R15.sol: Returns the exchange rate scaled by 10**18
    function ratio() external view returns (uint256);
}
