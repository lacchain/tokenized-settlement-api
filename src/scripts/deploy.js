const { deployERC20Tornado } = require('../lib/')

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[1];

  const InteroperableToken = await ethers.getContractFactory('InteroperableToken', deployer);
  const deployerAddress = await deployer.getAddress();
  const initialSupply = 0; //if you want to mint any tokens on deployment to msg.sender (all other mints must go through ZKP escrow)
  const financialInstitution1Token = await InteroperableToken.deploy("FI1 Token", 'FI1', "Financial Institution 1", initialSupply, deployerAddress, deployerAddress, deployerAddress, deployerAddress, deployerAddress);
  const tornado = await deployERC20Tornado(ethers, deployer, 100, financialInstitution1Token.address);
  console.log("Financial Institution 1 deployed to: \x1b[32m%s\x1b[0m", financialInstitution1Token.address);
  console.log("Tornado deployed to: \x1b[32m%s\x1b[0m", tornado.address);
}

main()
.then(() => process.exit(0))
.catch(error => {
  console.error(error);
  process.exit(1);
});
