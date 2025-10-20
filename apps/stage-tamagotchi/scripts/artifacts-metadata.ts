import process from 'node:process'

import { cac } from 'cac'

import { getElectronBuilderConfig, getFilenames, getVersion } from './utils'

async function main() {
  const cli = cac('name-of-artifact')
    .option(
      '--release',
      'Rename with version from package.json',
      { default: false },
    )
    .option(
      '--auto-tag',
      'Automatically tag the release with the latest git ref',
      { default: false },
    )
    .option(
      '--tag <tag>',
      'Tag to use for the release',
      { default: '', type: [String] },
    )
    .option(
      '--get-bundle-name',
      'Get the bundle name',
      { default: false },
    )
    .option(
      '--get-product-name',
      'Get the product name',
      { default: false },
    )
    .option(
      '--get-version',
      'Get the version',
      { default: false },
    )

  const args = cli.parse()

  const argOptions = args.options as {
    release: boolean
    autoTag: boolean
    tag: string[]
    getBundleName: boolean
    getProductName: boolean
    getVersion: boolean
  }

  const target = args.args[0]
  if (argOptions.getBundleName) {
    const filenames = await getFilenames(target, argOptions)
    console.info(filenames[0].releaseArtifactFilename)
  }
  if (argOptions.getProductName) {
    const electronBuilderConfig = await getElectronBuilderConfig()
    console.info(electronBuilderConfig.productName)
  }
  if (argOptions.getVersion) {
    const version = await getVersion({ release: argOptions.release, autoTag: argOptions.autoTag, tag: argOptions.tag })
    console.info(version)
  }
}

main()
  .catch((error) => {
    console.error('Error during generating name:', error)
    process.exit(1)
  })
