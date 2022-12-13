import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  InvalidMockV3Aggregator,
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  AETHcMock,
  AETHcCollateral,
  AETHcCollateral__factory,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderAETHc = '0xc8b6eacbd4a4772d77622ca8f3348877cf0beb46'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`aETHcCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let aETHc: AETHcMock
  let aETHcCollateral: AETHcCollateral

  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Core Contracts
  let main: TestIMain
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let deployer: TestIDeployer
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let facadeWrite: FacadeWrite
  let oracleLib: OracleLib
  let govParams: IGovParams

  // RToken Configuration
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e4'), // $10k
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: fp('0.05'), // 5%
    redemptionRateFloor: fp('1e6'), // 1M RToken
  }

  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let aETHcCollateralFactory: AETHcCollateral__factory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // Setup required token contracts
    // Create aETHc Token
    aETHc = <AETHcMock>(
      await ethers.getContractAt('AETHcMock', networkConfig[chainId].tokens.AETHC || '')
    )

    // Deploy aETHc collateral plugin
    aETHcCollateralFactory = await ethers.getContractFactory('AETHcCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    aETHcCollateral = <AETHcCollateral>await aETHcCollateralFactory.deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.ETH as string,
      aETHc.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('ETH'),

      delayUntilDefault
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    initialBal = bn('2000e18')

    // get aETHc balance of holderATHc
    await whileImpersonating(holderAETHc, async (aETHcSigner) => {
      await aETHc.connect(aETHcSigner).transfer(addr1.address, toBNDecimals(initialBal, 18))
    })

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [],
      primaryBasket: [aETHcCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: [],
    }

    // Deploy RToken via FacadeWrite
    const receipt = await (
      await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()

    // Get Main
    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

    // Get core contracts
    assetRegistry = <IAssetRegistry>(
      await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
    )
    backingManager = <TestIBackingManager>(
      await ethers.getContractAt('TestIBackingManager', await main.backingManager())
    )
    basketHandler = <IBasketHandler>(
      await ethers.getContractAt('IBasketHandler', await main.basketHandler())
    )
    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
    rTokenAsset = <RTokenAsset>(
      await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
    )

    // Setup owner and unpause
    await facadeWrite.connect(owner).setupGovernance(
      rToken.address,
      false, // do not deploy governance
      true, // unpaused
      govParams, // mock values, not relevant
      owner.address, // owner
      ZERO_ADDRESS, // no guardian
      ZERO_ADDRESS // no pauser
    )

    // Setup mock chainlink feed for some of the tests (so we can change the value)
    MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      // aETHc (aETHcCollateral)
      expect(await aETHcCollateral.isCollateral()).to.equal(true)
      expect(await aETHcCollateral.erc20()).to.equal(aETHc.address)
      expect(await aETHc.decimals()).to.equal(18)
      expect(await aETHcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
      expect(await aETHcCollateral.refPerTok()).to.be.closeTo(fp('0.93'), fp('0.03')) //exchangerate about 0.91-0.93
      expect(await aETHcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await aETHcCollateral.pricePerTarget()).to.equal(fp('1859.17')) // ETH Price for block 14916729
      expect(await aETHcCollateral.prevReferencePrice()).to.equal(await aETHcCollateral.refPerTok())
      expect(await aETHcCollateral.strictPrice()).to.be.closeTo(fp('1729.028'), fp('100')) //  ~0.93*1859.17 - delta $100

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(aETHc.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(aETHcCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(aETHcCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(aETHc.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const isFallback = (await basketHandler.price(true))[0]
      expect(isFallback).to.equal(false)

      // Check RToken price
      // Approve rtokens for addr1
      const issueAmount: BigNumber = bn('1000e18')

      await aETHc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1859.17'), fp('50'))
    })

    describe('Issuance/Appreciation/Redemption', () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('1000e18')

      // Issuance and redemption, making the collateral appreciate over time
      it('Should issue, redeem, and handle appreciation rates correctly', async () => {
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

        // Provide approvals for issuances
        await aETHc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        // Store Balances after issuance
        const balanceAddr1aETHc: BigNumber = await aETHc.balanceOf(addr1.address)

        const aETHcPrice1: BigNumber = await aETHcCollateral.strictPrice() // ~ 1729 USD
        const aETHcRefPerTok1: BigNumber = await aETHcCollateral.refPerTok()

        expect(aETHcPrice1).to.be.closeTo(fp('1729.028'), fp('100'))
        expect(aETHcRefPerTok1).to.be.closeTo(fp('0.93'), fp('0.1'))

        // Check total asset value
        const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )

        expect(totalAssetValue1).to.be.closeTo(issueAmount.mul(1860), fp(10000))

        // Advance time and blocks slightly, causing refPerTok() to increase
        await advanceTime(10000)
        await advanceBlocks(10000)

        // Update Exchange rate
        const ownerAETHC = '0x2ffc59d32a524611bb891cab759112a51f9e33c0'
        await whileImpersonating(ownerAETHC, async (contractOwner) => {
          //uint256 threshold = _ratio.div(1000) require(newRatio < _ratio.add(threshold)
          const currentRatio = await aETHc.ratio()
          const newRatio = currentRatio.add(currentRatio.div(999))
          await aETHc.connect(contractOwner).updateRatio(newRatio)
        })

        // Refresh aETHcCollateral manually (required)
        await aETHcCollateral.refresh()
        expect(await aETHcCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Check rates and prices - Have changed, slight inrease
        const aETHcPrice2: BigNumber = await aETHcCollateral.strictPrice()
        const aETHcRefPerTok2: BigNumber = await aETHcCollateral.refPerTok()

        // Check rates and price increase
        expect(aETHcPrice2).to.be.gt(aETHcPrice1)
        expect(aETHcRefPerTok2).to.be.gt(aETHcRefPerTok1)

        // Still close to the original values
        expect(aETHcPrice2).to.be.closeTo(fp('1766'), fp('100'))
        expect(aETHcRefPerTok2).to.be.closeTo(fp('0.94'), fp('0.02'))

        // Check total asset value increased
        const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue2).to.be.gt(totalAssetValue1)

        // Advance time and blocks slightly, causing refPerTok() to increase
        await advanceTime(100000000)
        await advanceBlocks(100000000)

        // Update Exchange rate
        await whileImpersonating(ownerAETHC, async (contractOwner) => {
          //uint256 threshold = _ratio.div(1000) require(newRatio < _ratio.add(threshold)
          const currentRatio = await aETHc.ratio()
          const newRatio = currentRatio.add(currentRatio.div(999))
          await aETHc.connect(contractOwner).updateRatio(newRatio)
        })

        // Refresh aETHc manually (required)
        await aETHcCollateral.refresh()
        expect(await aETHcCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Check rates and prices - Have changed
        const aETHcPrice3: BigNumber = await aETHcCollateral.strictPrice()
        const aETHcRefPerTok3: BigNumber = await aETHcCollateral.refPerTok()

        // Check rates and price increase
        expect(aETHcPrice3).to.be.gt(aETHcPrice2)
        expect(aETHcRefPerTok3).to.be.gt(aETHcRefPerTok2)

        // Need to adjust ranges
        expect(aETHcPrice3).to.be.closeTo(fp('1732.27'), fp('50'))
        expect(aETHcRefPerTok3).to.be.closeTo(fp('0.94'), fp('0.01'))

        // Check total asset value increased
        const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue3).to.be.gt(totalAssetValue2)

        // Redeem Rtokens with the updated rates
        await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances - Fewer aETHc Tokens should have been sent to the user
        const newBalanceAddr1aETHc: BigNumber = await aETHc.balanceOf(addr1.address)

        // Check received tokens represent - 1K (100% of basket)
        expect(newBalanceAddr1aETHc.sub(balanceAddr1aETHc)).to.be.closeTo(fp('1000'), fp('100'))

        // Check remainders in Backing Manager
        expect(await aETHc.balanceOf(backingManager.address)).to.be.closeTo(fp('2.1'), fp('0.1')) // ~= 2.1 aETHc

        //  Check total asset value (remainder)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          fp('3723.9'), // ~= 3723.9 usd (from above)
          fp('0.5')
        )
      })
    })

    // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
    // claiming calls throughout the protocol are handled correctly and do not revert.
    describe('Rewards', () => {
      it('Should be able to claim rewards (if applicable)', async () => {
        // Rewards not possible --> Only checks that claim call does't revert

        await expectEvents(backingManager.claimRewards(), [])
      })
    })

    // Test what happens when price is stale or oracledata is unreliable
    describe('Price Handling', () => {
      it('Should handle invalid/stale Price', async () => {
        // Reverts with a feed with zero price
        const invalidPriceAETHcCollateral: AETHcCollateral = <AETHcCollateral>await (
          await ethers.getContractFactory('AETHcCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          fp('1'),
          mockChainlinkFeed.address,
          aETHc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          delayUntilDefault
        )
        await setOraclePrice(invalidPriceAETHcCollateral.address, bn(0))

        // Reverts with zero price
        await expect(invalidPriceAETHcCollateral.strictPrice()).to.be.revertedWith(
          'PriceOutsideRange()'
        )

        // Refresh should mark status IFFY
        await invalidPriceAETHcCollateral.refresh()
        expect(await invalidPriceAETHcCollateral.status()).to.equal(CollateralStatus.IFFY)

        // Reverts with stale price
        await advanceTime(ORACLE_TIMEOUT.toString())
        await expect(aETHcCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

        // Fallback price is returned
        const [isFallback, price] = await aETHcCollateral.price(true)
        expect(isFallback).to.equal(true)
        expect(price).to.equal(fp('1'))

        // Refresh should mark status DISABLED
        await aETHcCollateral.refresh()
        expect(await aETHcCollateral.status()).to.equal(CollateralStatus.IFFY)
        await advanceBlocks(delayUntilDefault.mul(60))
        await aETHcCollateral.refresh()
        expect(await aETHcCollateral.status()).to.equal(CollateralStatus.DISABLED)

        const nonPriceAETHcCollateral: AETHcCollateral = <AETHcCollateral>await (
          await ethers.getContractFactory('AETHcCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          fp('1'),
          NO_PRICE_DATA_FEED,
          aETHc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          delayUntilDefault
        )
        // Collateral with no price info should revert
        await expect(nonPriceAETHcCollateral.strictPrice()).to.be.reverted

        expect(await nonPriceAETHcCollateral.status()).to.equal(CollateralStatus.SOUND)
      })
    })

    // Note: Here the idea is to test all possible statuses and check all possible paths to default
    // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
    // hard default = SOUND -> DISABLED due to an invariant violation
    // This may require to deploy some mocks to be able to force some of these situations
    describe('Collateral Status', () => {
      // No soft default scenarios to be tested

      // Test for hard default
      // This should never happen as ratio() aETHc is nondecrasing over time,
      // But it is tested anyways.
      it('Updates status in case of hard default', async () => {
        // Note: In this case requires to use a AETHc mock to be able to change the rate
        const AETHcMockFactory: ContractFactory = await ethers.getContractFactory('AETHcMock')
        const aETHcMock: AETHcMock = <AETHcMock>await AETHcMockFactory.deploy()

        // Set initial exchange rate to the new aETHc Mock
        await aETHcMock.repairRatio(fp('0.93'))

        // Redeploy plugin using the new aETHc mock
        const newaETHcCollateral: AETHcCollateral = <AETHcCollateral>await (
          await ethers.getContractFactory('AETHcCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          fp('1'),
          await aETHcCollateral.chainlinkFeed(),
          aETHcMock.address,
          await aETHcCollateral.maxTradeVolume(),
          await aETHcCollateral.oracleTimeout(),
          await aETHcCollateral.targetName(),
          await aETHcCollateral.delayUntilDefault()
        )

        // Check initial state
        expect(await newaETHcCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newaETHcCollateral.whenDefault()).to.equal(MAX_UINT256)

        // Decrease rate for aETHc, will disable collateral immediately
        await aETHcMock.repairRatio(fp('0.75'))

        // Force updates - Should update whenDefault and status for aETHc
        await expect(newaETHcCollateral.refresh())
          .to.emit(newaETHcCollateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

        expect(await newaETHcCollateral.status()).to.equal(CollateralStatus.DISABLED)
        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
        expect(await newaETHcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
      })
    })

    // strictPrice() should revert if any of the price information it relies upon to give a high-quality price is unavailable; price(false)
    // should behave essentially the same way. In a situation where strictPrice() or price(false) would revert, price(true) should instead
    //return (true, p), where p is some reasonable fallback price computed without relying on the failing price feed.
    // SOUND --> IFFY --> DISABLED ?
    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(18, bn('1e8'))
      )

      const invalidAETHcCollateral: AETHcCollateral = <AETHcCollateral>(
        await aETHcCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await aETHcCollateral.erc20(),
          await aETHcCollateral.maxTradeVolume(),
          await aETHcCollateral.oracleTimeout(),
          await aETHcCollateral.targetName(),
          await aETHcCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidAETHcCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidAETHcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidAETHcCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidAETHcCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})
