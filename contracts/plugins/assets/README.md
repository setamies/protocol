# Collateral Plugin - ankrETH - aETHc
https://gitcoin.co/issue/29482

## Introduction
The Reserve Protocol is a decentralized finance (DeFi) platform that allows users to create and manage asset-backed stablecoins. It uses a basket of collateral assets to provide stability and reduce volatility and allows users to mint stablecoins pegged to various assets and currencies. The goal of the protocol is to provide a more flexible and customizable stablecoin platform that can be used to create a wide range of stablecoin assets.

By creating a collateral plugin for the Reserve Protocol, users can extend the range of assets that can be used as collateral for stablecoin issuance. This can help make the protocol more flexible and allow for the creation of more diverse and creative stablecoin assets.

This plugin allows the usage of [aETHc](https://www.ankr.com/about-staking/) as a collateral for the Reserve Protocol. The aETHc token represents the users staked ETH plus accumulated staking rewards. It is immediately liquid, which enables users to trade them instantly, or unstake them to redeem the original underlying asset. 

Ankr protocol currently has two tokens users can choose to receive when depositing ETH to the platform. The first token is aETHb, and the user's balance of aETHb grows daily. According to [ANKR](https://www.ankr.com/docs/staking/for-integrators/dev-details/eth-liquid-staking-mechanics/), the growth of tokens can be described with:
 `total share supply / (total stake amount + rewards)`. 
 ANKR also states in their [liquid staking](https://www.ankr.com/docs/staking/liquid-staking/eth/overview/) docs that no new users are able to get aETHb token by staking.

The second token is aETHc (also called as ankrETH). Contrary to aETHb, the user's balance remains constant, but the value of aETHc token grows over time. As stated in [Reserve Protocols Collateral Plugin docs](https://github.com/reserve-protocol/protocol/blob/master/docs/collateral.md): 
>"Reserve Protocol cannot directly hold rebasing tokens. However, the protocol can indirectly hold a rebasing token if it's wrapped by another token that does not itself rebase, but instead appreciates only through exchange-rate increases. Any rebasing token can be wrapped to be turned into an appreciating exchange-rate token, and vice versa." Therefore, aETHc (ankrETH) is a suitable choice for collateral.

## Accounting units
|  tok  |  ref  | target | UoA  |
|-----  | ----- | ------ | ---- |
| aETHc |  ETH  |   ETH  | USD  |

#### Collateral unit `{tok}`
aETHc is a reward-bearing token, meaning that the fair value of 1 aETHc token vs. ETH increases over time as staking rewards accumulate. When it will be possible to unstake ETH at phase 1.5 of Ethereum 2.0, users will have the option to redeem aETHc to Ankr StakeFi, and unstake ETH with accumulated staking rewards. (https://www.ankr.com/docs/staking/liquid-staking/eth/overview/)

#### Reference unit `{ref}`
The reference unit is ETH. The exchange rate between ETH and aETHc can be fetched from aETHc contract function `ratio()`

#### Target unit `{target}` is ETH

#### Unit of Account `{UoA}` is USD

## Functions

`strictprice()` 
Since there is no chainlink feed available for aETHc at the time of building this plugin, the best market price for aETHc is calculated using the following formula: `{UoA/tok} = {UoA/ref} * {ref/tok}`.

In other words, the price for aETHc is calculated by multiplying the exchange rate between aETHc and ETH with the price of ETH. 
- `{UoA/tok}` is the chainlink feed for ETH/USD: https://data.chain.link/ethereum/mainnet/crypto-usd/eth-usd
- `{ref/tok}` is fetched by calling the `ratio()` function from the aETHc contract.


`refresh()`
The function is called at the start of any significant system interaction and checks the conditions defined in Reserves [Writing Collateral Plugins](https://github.com/reserve-protocol/protocol/blob/master/docs/collateral.md). After checking the conditions, it updates the status and price.

In short, the conditions checked by this function are:
- If the status of the collateral is already `DISABLED`, the status stays `DISABLED`
- Reference price decrease: If `refPerTok()` has decreased, the status will immediately become `DISABLED`.
- If no reliable price data is available, the collateral status becomes `IFFY`.

`refPerTok()`
Checks the exchange rate between ETH and aETHc with the aETHc token's contract function `ratio()`. The ratio increases over time, which means that the amount of aETHc redeemable for ETH always increases. This fills the requirement for a collateral plugin that the reference price must be nondecreasing over time. As the `ratio()` function is used for determining how many ETH tokens one receives when redeeming aETHc, it is also a good market rate for 1 `{tok}`. `ratio()` returns the exchange rate in 10**18.

NOTE: 
- Although `refPerTok()` should never decrease, the collateral plugin will immediately default in case of exceptional circumstances where the `refPerTok()` would decrease.


`pricePerRef()` & `pricePerTarget()` 
As both the `{target}` and `{ref}` are ETH, both of these functions return `{UoA/ref}`

`claimRewards()`
Unstaking is unavailable before the [Shanghai update](https://www.ankr.com/docs/staking/liquid-staking/eth/overview/). Consequently, the `claimRewards()` function does nothing. There are tests to ensure 

## Tests

* Yarn slither
  - No warnings regarding aETHc.

* Integration test:
  - AETHc integration test can be found from: [/test/integration/individual-collateral/AETHcCollateral.test.ts]
  - To run the test: `yarn test:integration`
  - Result:  
```
  56 passing (1m)
  33 pending
```

* Collateral test:
  - AETHc collateral test can be found from: [/test/plugins/Collateral.test.ts]
  - To run the test: `yarn test:fast`
  - Result:   
```
  229 passing (1m)
  3 pending
  2 failing
```

  Both of the failing tests are related to Gnosis address being different than in the config file. This is a bug with Hardhat. Both of the error messages are in the end of the README file. [More information about the bug](https://github.com/NomicFoundation/hardhat/issues/1956)
## Deployment
AETHcCollateral has a deployment script in the [task](/tasks/deployment/collateral/deploy-aethc-collateral.ts) folder, hence, it will be deployed automatically when following the [deployment](https://github.com/nabetse00/protocol/blob/plugin-cbeth/docs/deployment.md) instuctions.

- Mainnet addresses have been added to the [config file](/common/configuration.ts)

- [deploy_collateral.ts](/scripts/deployment/phase2-assets/2_deploy_collateral.ts) also contains the following deployment script:

```
  const { collateral: AETHcCollateral } = await hre.run('deploy-aethc-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.ETH)).toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    tokenAddress: networkConfig[chainId].tokens.AETHC,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: ethers.utils.formatBytes32String('ETH'),
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.AETHC = AETHcCollateral
  deployedCollateral.push(AETHcCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
}
```

#### Failing collateral tests (not aETHc related)
```
  1) BrokerP0 contract #fast
       Deployment
         Should setup Broker correctly:

      AssertionError: expected '0x0b7fFc1f4AD541A4Ed16b40D8c37f092915…' to equal '0xe70f935c32dA4dB13e7876795f1e175465e…'
      + expected - actual

      -0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101
      +0xe70f935c32dA4dB13e7876795f1e175465e6458e
      
      at Context.<anonymous> (test/Broker.test.ts:79:40)
      at processTicksAndRejections (node:internal/process/task_queues:96:5)
      at runNextTicks (node:internal/process/task_queues:65:3)
      at listOnTimeout (node:internal/timers:528:9)
      at processTimers (node:internal/timers:502:7)


      2) DeployerP0 contract #fast
       Deployment
         Should setup values correctly:

      AssertionError: expected '0x0b7fFc1f4AD541A4Ed16b40D8c37f092915…' to equal '0xE8F7d98bE6722d42F29b50500B0E318EF2b…'
      + expected - actual

      -0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101
      +0xE8F7d98bE6722d42F29b50500B0E318EF2be4fc8
      
      at Context.<anonymous> (test/Deployer.test.ts:225:42)
      at runMicrotasks (<anonymous>)
      at processTicksAndRejections (node:internal/process/task_queues:96:5)
      at runNextTicks (node:internal/process/task_queues:65:3)
      at listOnTimeout (node:internal/timers:528:9)
      at processTimers (node:internal/timers:502:7)
```

NOTE: Both of these AssertionErrors stem from gnosis. Here is the code snippet where `Broker.test.ts` throws the error:
```
  describe('Deployment', () => {
    it('Should setup Broker correctly', async () => {
      expect(await broker.gnosis()).to.equal(gnosis.address)

```