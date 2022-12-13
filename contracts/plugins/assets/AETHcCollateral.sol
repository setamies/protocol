// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// Import this file to use console.log
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/IankrETH.sol";
import "contracts/plugins/assets/OracleLib.sol";

/**
 * @title aETHcCollateral
 * @notice Collateral plugin for aETHc
 */
contract AETHcCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 public prevReferencePrice;

    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok}: No direct oracle data for aETHc, has to be calculated like this.
    // {UoA/tok} = {UoA/ref} * {ref/tok}
    function strictPrice() public view virtual override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    function refresh() external virtual override {
        // If the collateral has once defaulted, it always stays that way.
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();

        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // {ref} = {target}
            try chainlinkFeed.price_(oracleTimeout) returns (uint192) {
                markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        // Updates the reference price
        prevReferencePrice = referencePrice;

        // Updates the status
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// Uses the ratio() function from aETHc contract
    function refPerTok() public view override returns (uint192) {
        uint256 exchangeRate = IankrETH(address(erc20)).ratio();
        return uint192(exchangeRate);
    }

    /// @return {UoA/ref} The price of a reference unit in UoA
    function pricePerRef() public view returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }
}
