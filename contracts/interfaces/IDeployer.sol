// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "./IFacade.sol";
import "./IGnosis.sol";
import "./IMain.sol";
import "./IRToken.sol";
import "./IStRSR.sol";
import "./IDistributor.sol";

/**
 * @title DeploymentParams
 * @notice The set of protocol params needed to configure a new system deployment.
 * meaning that after deployment there is freedom to allow parametrizations to deviate.
 */
struct DeploymentParams {
    // === RSR/RToken/AAVE/COMP ===
    int192 maxTradeVolume; // {UoA}
    //
    // === Revenue sharing ===
    RevenueShare dist; // revenue sharing splits between RToken and RSR
    //
    // === Rewards (Furnace + StRSR) ===
    uint256 rewardPeriod; // {s} the atomic unit of rewards, determines # of exponential rounds
    int192 rewardRatio; // the fraction of available revenues that stRSR holders get each PayPeriod
    //
    // === StRSR ===
    uint256 unstakingDelay; // {s} the "thawing time" of staked RSR before withdrawal
    //
    // === BackingManager ===
    uint256 tradingDelay; // {s} how long to wait until starting auctions after switching basket
    uint256 auctionLength; // {s} the length of an auction
    int192 backingBuffer; // {%} how much extra backing collateral to keep
    int192 maxTradeSlippage; // {%} max slippage acceptable in a trade
    int192 dustAmount; // {UoA} value below which it is not worth wasting time trading
    //
    // === RToken ===
    int192 issuanceRate; // {%} number of RToken to issue per block / (RToken value)
}

/**
 * @title IDeployer
 * @notice Factory contract for an RToken system instance
 */
interface IDeployer {
    /// Emitted when a new RToken and accompanying system is deployed
    /// @param main The address of `Main`
    /// @param rToken The address of the RToken ERC20
    /// @param stRSR The address of the StRSR ERC20 staking pool/token
    /// @param facade The address of the view facade
    /// @param owner The owner of the newly deployed system
    event RTokenCreated(
        IMain indexed main,
        IRToken indexed rToken,
        IStRSR stRSR,
        IFacade facade,
        address indexed owner
    );

    //

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param constitutionURI An IPFS URI for the immutable constitution the RToken adheres to
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param params Deployment params
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string calldata name,
        string calldata symbol,
        string memory constitutionURI,
        address owner,
        DeploymentParams memory params
    ) external returns (address);
}

interface TestIDeployer is IDeployer {
    function rsr() external view returns (IERC20Metadata);

    function comp() external view returns (IERC20Metadata);

    function aave() external view returns (IERC20Metadata);

    function gnosis() external view returns (IGnosis);

    function comptroller() external view returns (IComptroller);

    function aaveLendingPool() external view returns (IAaveLendingPool);

    function deployments(uint256) external view returns (IMain);
}
