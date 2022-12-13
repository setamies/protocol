import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { AETHcCollateral } from '../../../typechain'

task('deploy-aethc-collateral', 'Deploys aETHc Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('referenceUnitFeed', 'ETH Price Feed address')
  .addParam('tokenAddress', 'aETHc address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('delayUntilDefault', 'Delay until default')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const AETHcCollateralFactory = await hre.ethers.getContractFactory('AETHcCollateral', {
      libraries: { OracleLib: params.oracleLib },
    })

    const collateral = <AETHcCollateral>(
      await AETHcCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.referenceUnitFeed,
        params.tokenAddress,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.delayUntilDefault
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed aETHc Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
