import crypto from "crypto";
import snarkjs from "snarkjs";
import circomlib from "circomlib";
import merkleTree from "cli-tornado/lib/MerkleTree.js";
import buildGroth16 from "websnark/src/groth16.js";
import websnarkUtils from "websnark/src/utils.js";

const { bigInt } = snarkjs;

const rbigint = (nbytes) => bigInt.leBuff2int(crypto.randomBytes(nbytes));
const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0];

export function newDeposit() {
  return _createDeposit(rbigint(31), rbigint(31));
}

export async function generateProof(preimage, recipientAddress, merkleTreeHeight, deposits, circuit, provingKey) {
  const deposit = _createDeposit(
    bigInt.leBuff2int(preimage.slice(0, 31)), bigInt.leBuff2int(preimage.slice(31, 62))
  );
  const { root, path_elements, path_index } = await generateMerkleProof(deposit, merkleTreeHeight, deposits);
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    recipient: bigInt(recipientAddress),
    relayer: bigInt.zero,
    fee: bigInt.zero,
    refund: bigInt.zero,

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndices: path_index
  };
  const groth16 = await buildGroth16(); //FIXME: this should be a constant
  const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, provingKey);
  const { proof } = websnarkUtils.toSolidityInput(proofData);
  return { root, proof };
}

async function generateMerkleProof(deposit, merkleTreeHeight, deposits) {
  let leafIndex = -1;
  const leaves = deposits
  .sort((a, b) => a.leafIndex - b.leafIndex)
  .map(e => {
    if (bigInt(e.commitment).eq(bigInt(deposit.commitment))) {
      leafIndex = e.leafIndex;
    }
    return e.commitment.toString(10);
  });
  if (leafIndex < 0) {
    throw new Error('The deposit is not found in the tree');
  }
  const tree = new merkleTree(merkleTreeHeight, leaves);
  return tree.path(leafIndex)
}

function _createDeposit(nullifier, secret) {
  const preimage = Buffer.concat([nullifier.leInt2Buff(31), secret.leInt2Buff(31)]);
  const commitment = pedersenHash(preimage);
  return {
    secret: secret,
    nullifier: nullifier,
    nullifierHash: pedersenHash(nullifier.leInt2Buff(31)),
    preimage: preimage,
    commitment: commitment,
  };
}