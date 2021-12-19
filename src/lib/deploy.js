import ethers from "ethers";
import genContract from "circomlib/src/mimcsponge_gencontract.js";
import verifierJSON from '../contracts/Verifier.json';
import tornadoJSON from '../contracts/ERC20Tornado.json';

export const MERKLE_TREE_HEIGHT = 20;

function link( bytecode, linkedReferences, libraryAddress ) {
	const address = libraryAddress.replace( '0x', '' );
	linkedReferences.forEach( ( { start: byteStart, length: byteLength } ) => {
		const start = 2 + byteStart * 2
		const length = byteLength * 2
		bytecode = bytecode
			.slice( 0, start )
			.concat( address )
			.concat( bytecode.slice( start + length, bytecode.length ) )
	} )
	return bytecode;
}

export async function deployERC20Tornado( operator, denomination, tokenAddress ) {
	const Verifier = new ethers.ContractFactory( verifierJSON.abi, verifierJSON.bytecode, operator );
	const Hasher = new ethers.ContractFactory( genContract.abi, genContract.createCode( 'mimcsponge', 220 ), operator );

	const verifier = await Verifier.deploy();
	const hasher = await Hasher.deploy();

	const hasherReferences = tornadoJSON.linkReferences['contracts/external/MerkleTreeWithHistory.sol'].Hasher;

	const ERC20Tornado = new ethers.ContractFactory( tornadoJSON.abi, link( tornadoJSON.bytecode, hasherReferences, hasher.address ), operator );

	return await ERC20Tornado.deploy(
		verifier.address,
		denomination,
		MERKLE_TREE_HEIGHT,
		operator.address,
		tokenAddress,
		{
			gasLimit: 804247552
		}
	);
}