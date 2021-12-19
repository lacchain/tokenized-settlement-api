const { deployERC20Tornado, MERKLE_TREE_HEIGHT, newDeposit, generateProof } = require('../lib/');
const { readFile } = require('fs/promises');
const BNfrom = ethers.BigNumber.from;

async function main() {

  const tornadoDenomination = 100; //only 1 denomination for testing
  const initialSupply = 1000; //if you want to mint any tokens on deployment to msg.sender (all other mints must go through ZKP escrow)
  //(1) deploy first institution
  const signers = await ethers.getSigners();
  const deployer1 = signers[0];
  const institution1 = "Financial Institution 1";
  const tokenId1 = "FI1";
  const tokenName1 = "FI1 Token";
  const institution1Deployment = await deployTornadoAndERC20(deployer1, tokenName1, tokenId1, institution1, tornadoDenomination,initialSupply);
  //(2) deploy second institution
  const deployer2 = signers[1];
  const institution2 = "Financial Institution 2";
  const tokenId2 = "FI2";
  const tokenName2 = "FI2 Token";
  const institution2Deployment = await deployTornadoAndERC20(deployer2, tokenName2, tokenId2, institution2, tornadoDenomination,initialSupply);
  //(3) each institution to approve each other AND themselves to allow for internal private txs
  await approveInstitution(institution1Deployment.erc20Contract, institution2, institution2Deployment.erc20Contract.address);
  await approveInstitution(institution1Deployment.erc20Contract, institution1, institution1Deployment.erc20Contract.address);
  await approveInstitution(institution2Deployment.erc20Contract, institution1, institution1Deployment.erc20Contract.address);
  await approveInstitution(institution2Deployment.erc20Contract, institution2, institution2Deployment.erc20Contract.address);
  //(4) send tokens from 1 institution to another

    //(4a) make sure the receiving user is authorised the second institution
    const tokenReceiver = await signers[2].getAddress();//institution2Deployment.erc20Contract.address;////
    console.log("tokenReceiver: \x1b[32m%s\x1b[0m", tokenReceiver);
    await authoriseUser(institution2Deployment.erc20Contract,tokenReceiver);
    //(4b) perform the deposit and withdrawal via ZKPs
    await performDepositAndWithdrawal(institution1Deployment.erc20Contract,institution2Deployment.erc20Contract,institution2Deployment.tornadoContract, institution2,tornadoDenomination,tokenReceiver);
}

async function deployTornadoAndERC20(deployer, tokenName, tokenId, institutionName, tornadoDenomination, initialSupply){

  const InteroperableToken = await ethers.getContractFactory('InteroperableToken', deployer);
  const deployerAddress = await deployer.getAddress();
  console.log("deployerAddress: \x1b[32m%s\x1b[0m", deployerAddress);

  //(1) deploy erc20 contract
  const financialInstitutionToken = await InteroperableToken.deploy(tokenName, tokenId, institutionName, initialSupply, deployerAddress, deployerAddress, deployerAddress, deployerAddress, deployerAddress);
  await financialInstitutionToken.deployTransaction.wait();
  console.log(institutionName + " contract deployed to: \x1b[32m%s\x1b[0m", financialInstitutionToken.address);
  const institution1Supply = await financialInstitutionToken.totalSupply();
  console.log("institution1Supply: \x1b[32m%s\x1b[0m", institution1Supply);
  //(2) deploy tornado contract
  const tornado = await deployERC20Tornado(ethers, deployer, tornadoDenomination, financialInstitutionToken.address);
  await tornado.deployTransaction.wait();
  console.log("Tornado deployed to: \x1b[32m%s\x1b[0m", tornado.address);
  //(3) connect erc20 contract to tornado contract
  const addTornadoTx = await financialInstitutionToken.addTornadoContract(tornado.address);
  await addTornadoTx.wait();
  console.log("addTornadoTx.Hash: \x1b[32m%s\x1b[0m", addTornadoTx.hash);

  //(4) test connection
  let tornadoAddress = await financialInstitutionToken.registeredTornadoDenominations(tornadoDenomination);
  console.log("RegisteredTornadoAddress: \x1b[32m%s\x1b[0m", tornadoAddress);
  if (!(tornadoAddress === tornado.address)){
    throw 'Registered Tornado Address: ' + tornadoAddress + ' is not equal to the real tornado address: ' + tornado.address;
  } else {
    return {erc20Contract: financialInstitutionToken, tornadoContract: tornado};
  }
}

async function approveInstitution(institutionTokenContract, toApproveInstitutionName, toApproveInstitutionAddress){
  console.log("approving: " + toApproveInstitutionName + " at " + toApproveInstitutionAddress);
  const approveTx = await institutionTokenContract.addOrDeleteInstitution(toApproveInstitutionName, toApproveInstitutionAddress, true);
  await approveTx.wait();
  const registeredInstitution = await institutionTokenContract.registeredInstitutions(toApproveInstitutionName);
  if (!(registeredInstitution === toApproveInstitutionAddress)){
    throw 'Registered Institution Address: ' + registeredInstitution + ' is not equal to the real institution address: ' + toApproveInstitutionAddress;
  }

}

async function authoriseUser(institutionTokenContract, tokenReceiver){

  const authTx = await institutionTokenContract.addOrDeleteAuthorisedUser(tokenReceiver, true);
  await authTx.wait();

}

async function performDepositAndWithdrawal(institution1Contract,institution2Contract,institution2TornadoContract, institution2Name,tokenAmount,tokenReceiver){
      //burning with a correct commitment value.
      const deposit = newDeposit();
      let commitmentHex = BNfrom(deposit.commitment).toHexString();
      //check current supply for FI1 & FI2
      const institution1SupplyBefore = await institution1Contract.totalSupply();
      const institution2SupplyBefore = await institution2Contract.totalSupply();
      console.log("institution1SupplyBefore: \x1b[32m%s\x1b[0m", institution1SupplyBefore);
      console.log("institution2SupplyBefore: \x1b[32m%s\x1b[0m", institution2SupplyBefore);
      //burning on institution 1 to deposit into institution 2]
      const txDeposit = await institution1Contract.burnAndTransferToConnectedInstitution(tokenAmount, [tokenAmount], [commitmentHex], institution2Name); 
      await txDeposit.wait();
      console.log("txDeposit.hash: \x1b[32m%s\x1b[0m", txDeposit.hash);
      //check supply has gone down at FI1 and up at FI2
      const institution1SupplyAfter = await institution1Contract.totalSupply();
      const institution2SupplyAfter = await institution2Contract.totalSupply();
      console.log("institution1SupplyAfter: \x1b[32m%s\x1b[0m", institution1SupplyAfter);
      console.log("institution2SupplyAfter: \x1b[32m%s\x1b[0m", institution2SupplyAfter);
      if (parseInt(institution1SupplyBefore) <= parseInt(institution1SupplyAfter)){
        throw 'Institution 1 before supply: ' + institution1SupplyBefore + ' and institution 1 after supply: ' + institution1SupplyAfter + ' misaligned';
      }
      if (parseInt(institution2SupplyBefore) >= parseInt(institution2SupplyAfter)){
        throw 'Institution 2 before supply: ' + institution2SupplyBefore + ' and institution 2 after supply: ' + institution2SupplyAfter + ' misaligned';
      }
      //check tornado contract:
      const tornadoCommitmentAdded = await institution2TornadoContract.commitments(commitmentHex);
      if (tornadoCommitmentAdded === false){
        throw 'tornadoCommitmentAdded: ' + tornadoCommitmentAdded;
      }
      //withdraw from institution2's tornado contract
      const circuit = require('../resources/external/withdraw.json');
      const provingKey = (await readFile('resources/external/withdraw_proving_key.bin')).buffer;
      const depositEvents = (await institution2TornadoContract.queryFilter('Deposit')).map(depositArgs => ({
        leafIndex: depositArgs.args.leafIndex,
        commitment: depositArgs.args.commitment,
      }));
      //the receiving address must have already been approved!
      const { root, proof } = await generateProof(deposit.preimage, tokenReceiver, MERKLE_TREE_HEIGHT, depositEvents, circuit, provingKey);
      const rootHex = BNfrom(root).toHexString();
      const nullifierHashHex = BNfrom(deposit.nullifierHash).toHexString();
      const tornadoRoot = await institution2TornadoContract.isKnownRoot(rootHex);
      if (tornadoRoot === false){
        throw 'tornadoRoot: ' + tornadoRoot;
      }    
      //checking the receiving address has 0 balance before the withdrawal
      const receiverBalance = await institution2Contract.balanceOf(tokenReceiver);
      if (parseInt(receiverBalance) !== 0){
        throw 'receiverBalance not 0: ' + receiverBalance;
      }
//      console.log("proof: " + proof);
//      console.log("rootHex: " + rootHex);
//      console.log("nullifierHashHex: " + nullifierHashHex);
//      console.log("tokenReceiver: " + tokenReceiver);
//      console.log("ethers.constants.AddressZero: " + ethers.constants.AddressZero);
      //format of rawTx input data for withdrawal is:
      //  "0x"+<MethodId>+"00000000000000000000000000000000000000000000000000000000000000e0"+
      //  <rootHex>+<nullifierHashHex>+"000000000000000000000000"+<TokenReceiver>+
      //  "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100"+
      //  <proof>
      const withdrawTx = await institution2TornadoContract.withdraw(
        proof,
        rootHex,
        nullifierHashHex,
        tokenReceiver,
        ethers.constants.AddressZero,
        0,
        0
      );
      await withdrawTx.wait();
      console.log("withdrawTx.hash: \x1b[32m%s\x1b[0m", withdrawTx.hash);
      //checking the receiving address has has now received tokens
      const receiverBalance2 = await institution2Contract.balanceOf(tokenReceiver);
      console.log("receiverBalance2: \x1b[32m%s\x1b[0m", receiverBalance2);
      if (parseInt(receiverBalance2) !== parseInt(tokenAmount)){
        throw 'receiverBalance not updated: ' + receiverBalance2;
      }
  


}

main()
.then(() => process.exit(0))
.catch(error => {
  console.error(error);
  process.exit(1);
});
