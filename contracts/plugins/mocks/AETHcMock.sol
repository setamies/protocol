// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./ERC20Mock.sol";
import "contracts/libraries/Fixed.sol";

/// Wrapped liquid staked Ether 2.0
/// @dev ERC20 + Exchange rate
/// @dev https://etherscan.io/token/0xE95A203B1a91a908F9B9CE46459d101078c2c3cb#code
contract AETHcMock is ERC20Mock {
    event RatioUpdate(uint256 newRatio);
    event GlobalPoolContractUpdated(address prevValue, address newValue);
    event NameAndSymbolChanged(string name, string symbol);
    event OperatorChanged(address prevValue, address newValue);
    event PauseToggled(bytes32 indexed action, bool newValue);
    event BscBridgeContractChanged(address prevValue, address newValue);

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    address private _globalPoolContract;

    // ratio should be base on 1 ether
    // if ratio is 0.9, this variable should be  9e17
    uint256 private _ratio;

    constructor() ERC20Mock("Wrapped liquid staked Ether 2.0", "wstETH") {
        _ratio = 1e18;
    }

    function updateRatio(uint256 newRatio) public {
        // 0.001 * ratio
        uint256 threshold = _ratio / 1000;
        require(newRatio < _ratio + threshold || newRatio > _ratio - threshold, "");
        _ratio = newRatio;
        emit RatioUpdate(_ratio);
    }

    function repairRatio(uint256 newRatio) public {
        _ratio = newRatio;
        emit RatioUpdate(_ratio);
    }

    function ratio() public view returns (uint256) {
        return _ratio;
    }
}
