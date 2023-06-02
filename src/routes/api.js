import fs from "fs";
import path from "path";
import redis from "redis";
import ethers from "ethers";
import { deployERC20Tornado, generateProof, MERKLE_TREE_HEIGHT, newDeposit } from "../lib/index.js";
import Router from './router.js';
import InteroperableTokenJSON from '../contracts/InteroperableToken.json';
import circuit from '../resources/external/withdraw.json';
import tornadoJSON from "../contracts/ERC20Tornado.json";
import swaggerDocument from '../resources/swagger.json';

const networks = {
	settlement: "ws://3.17.191.188:4546",
	commercial: "ws://3.142.145.202:4546"
};

const BNfrom = ethers.BigNumber.from;
const operator = new ethers.Wallet( "6ccfcaa51011057276ef4f574a3186c1411d256e4d7731bdf8743f34e608d1d1" );
const lastBlock = 0;

export const sleep = seconds => new Promise( resolve => setTimeout( resolve, seconds * 1e3 ) );
export const denominations = [1, 3, 5, 10, 50, 100, 300, 500, 1000, 5000, 10000, 20000, 40000];

export const amountInDenominations = amount => {
	let amounts = [];
	const res = {};

	for (let i = 0; amount > 0 && i < denominations.length; i++) {
		const value = denominations[denominations.length - i - 1];

		if (value <= amount) {
			res[value] = Math.floor(amount / value);
			amount -= value * res[value];
			amounts = amounts.concat( Array(res[value]).fill(value) );
		}
	}

	return amounts;
}


export default class APIRouter extends Router {

	constructor() {
		super();
	}

	async init() {
		const operatorAddress = await operator.getAddress();

		const redisClient = redis.createClient( { url: process.env.REDIS_HOST } );

		await redisClient.connect();

		this.swagger( '/', swaggerDocument );

		this.post( '/deploy', async req => {
			const { name, symbol, initialSupply, network } = req.body;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			if( isNaN( initialSupply ) ) throw new Error( "initialSupply is not a number" );

			const InteroperableToken = new ethers.ContractFactory( InteroperableTokenJSON.abi, InteroperableTokenJSON.bytecode, sender );
			const token = await InteroperableToken.deploy( name, symbol, name, `0x${initialSupply.toString( 16 )}`, operatorAddress, operatorAddress, operatorAddress, operatorAddress, operatorAddress, { gasLimit: 30000000 } );
			await token.deployed().catch( error => {
				console.error( error );
			} );

			const tornados = {};
			for( const denomination of denominations ){
				const tornado = await deployERC20Tornado( sender, denomination, token.address)
				await tornado.deployed();
				await token.addTornadoContract( tornado.address, { gasLimit: 30000000 } );
				tornados[`d_${denomination}`] = tornado.address;
			}

			const totalSupply = await token.totalSupply();

			await redisClient.set( token.address, JSON.stringify( {
				name,
				symbol,
				initialSupply,
				token: token.address,
				tornados
			} ) );
			// "0xD65968Ce4F907f15020607691ab82aA19Ac37641" "{\n    \"name\": \"Test Institution USA\",\n    \"symbol\": \"T11US\",\n    \"tornados\": {\n        \"d_1\": \"0x0E016DF1Ec35685f0aAcbb5f8247F3Ed8D98F27A\",\n        \"d_3\": \"0xe1A532899CC8f2368F99E5e04423C0C0dE145aB7\",\n        \"d_5\": \"0xD4aa6dfCa61CC512D9Af3082D9EAA8d05BF157e5\",\n        \"d_10\": \"0x995a8cB3C5AB2eFD648be45EE729109A49BBd70B\",\n        \"d_50\": \"0xD5d31768fCb0D6b551f9D6A61800BccfB3b8EF33\",\n        \"d_100\": \"0xdC21F66Ca2Ec1A1f8dD04EDe468BFEA4eebBce39\",\n        \"d_300\": \"0x3a7D23705f6DA21c7Bc1c75E89791C7c4572D7b7\",\n        \"d_500\": \"0x360Ae6B277Aa525dE9131AD009A9E5D78a9aac7c\",\n        \"d_1000\": \"0x6940b8C51b5Cb495aE1FD581e35dd3c0535f3af0\",\n        \"d_5000\": \"0xd5f2C667c2FB35c42cE947e6b3b13B2a88a6d7B8\",\n        \"d_10000\": \"0xe3Aaa7FBe6757E338B901528996bAe364e43D2EC\",\n        \"d_20000\": \"0x64520F390bB067F8aaCCEEDFa1458732864102A2\",\n        \"d_40000\": \"0xACa5804c4985B790CdA31EF5e4b52f586f621600\"\n    }\n}"
			// "0xA7fb182068f596c97C4239D5AcBc5A0aaF19DBCf" "{\n    \"name\": \"Test Institution Peru\",\n    \"symbol\": \"T11PE\",\n    \"tornados\": {\n        \"d_1\": \"0xBb29bC4a412A2B07439311E7312FFAeC33C79000\",\n        \"d_3\": \"0x4A70DA6Aa799b4B221d6dea428DE317a61D64204\",\n        \"d_5\": \"0xF2Bf95889F7B909435873Be10dCd2221D9eEF2c5\",\n        \"d_10\": \"0x882afEdb4CD172Cb473B8Bcf661fa0052E045b32\",\n        \"d_50\": \"0x30f1323CE9edc2232887d7230451A366ae1Dfec2\",\n        \"d_100\": \"0x7d5D3f8786533fe3Dd7563aE6BfC93542A04D7b5\",\n        \"d_300\": \"0x17C446abab6ee3e53B4A6D8AaA711cA3C9D8c506\",\n        \"d_500\": \"0x8b48809D0371dAA839Fc7DcE90Ea2EABd19B82E5\",\n        \"d_1000\": \"0x473bf291F7F4574B98eC7608b05fFAF6b447c09B\",\n        \"d_5000\": \"0x67a0cFE550bE18fe97E8Dd9a65D0C9E64fccEAb0\",\n        \"d_10000\": \"0xaFF8975233868D929862A70d4589AB15bCDbC71A\",\n        \"d_20000\": \"0x42e86E3644652C2cA3e9cC49749e790bC2649834\",\n        \"d_40000\": \"0xFd865B5e49c279b4ce9b389Dd9bE3486A93EEE6D\"\n    }\n}"
			return {
				name,
				symbol,
				tokenAddress: token.address,
				tornados,
				totalSupply: totalSupply.toString()
			};
		} );

		this.post( '/connect', async req => {
			const { fromAddress, toAddress, network } = req.body;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			const from = await redisClient.get( fromAddress );
			const to = await redisClient.get( toAddress );

			if( !from ) throw new Error( "Invalid (from) institution" );
			if( !to ) throw new Error( "Invalid (to) institution" );

			const institutionFrom = JSON.parse( from );
			const institutionTo = JSON.parse( to );

			const tokenFrom = new ethers.Contract( institutionFrom.token, InteroperableTokenJSON.abi, sender );

			await tokenFrom.addOrDeleteInstitution( institutionTo.name, institutionTo.token, true, { gasLimit: 30000000 } );

			return true;
		} );

		this.get( '/supply/:network/:tokenAddress', async req => {
			const { tokenAddress, network } = req.params;

			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, sender );

			const totalSupply = await token.totalSupply();
			return {
				totalSupply: totalSupply.toString()
			}
		});

		this.post( '/mint', async req => {
			const { tokenAddress, amount, network } = req.body;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, sender );

			await token.mint( operatorAddress, `0x${amount.toString( 16 )}`, { gasLimit: 30000000 } );

			await sleep(3);

			const totalSupply = await token.totalSupply();
			return {
				totalSupply: totalSupply.toString()
			}
		} );

		this.get( '/balance/:network/:tokenAddress/:accountAddress', async req => {
			const { tokenAddress, accountAddress, network } = req.params;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );

			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, sender );
			const balance = await token.balanceOf( accountAddress ); // operator = 0x4222ec932c5a68b80e71f4ddebb069fa02518b8a
			return {
				balance: balance.toString()
			}
		} );

		this.post( '/addCustomer', async req => {
			const { tokenAddress, account, network } = req.body;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, sender );

			const role = await token.AUTHORISED_ROLE();
			const hasRole = await token.hasRole( role, account );
			if( !hasRole ) {
				await token.addOrDeleteAuthorisedUser( account, true, { gasLimit: 30000000 } );
			}

			return true;
		} );

		this.post( '/transferInstitution1', async req => {
			const { fromAddress, toAddress, amount, network } = req.body;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const from = await redisClient.get( fromAddress );
			const to = await redisClient.get( toAddress );

			if( !from ) throw new Error( "Invalid (from) institution" );
			if( !to ) throw new Error( "Invalid (to) institution" );

			const institutionFrom = JSON.parse( from );
			const institutionTo = JSON.parse( to );

			const amounts = amountInDenominations( amount + 0 );
			const deposits = amounts.map( value => ({ denomination: value, ...newDeposit() }) );
			const tokenFrom = new ethers.Contract( institutionFrom.token, InteroperableTokenJSON.abi, sender );
			const commitments = deposits.map(({ commitment }) => BNfrom( commitment ).toHexString() );
			this.logger.silly( `transferInstitution1`, { amount, amounts, commitments, institution: institutionTo.name } );
			const tx = await tokenFrom.burnAndTransferToConnectedInstitution( amount, amounts, commitments, institutionTo.name, { gasLimit: 300000000 } );
			const receipt = await tx.wait();
			return deposits.map( ({ denomination, preimage, nullifierHash,  }) => ({
				denomination,
				preimage: preimage.toString( 'hex' ),
				nullifierHash: BNfrom( nullifierHash ).toHexString()
			}) )
		} );

		this.post( '/transferInstitution2', async req => {
			const { tokenAddress, deposits, network } = req.body;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );

			const provingKey = ( await fs.readFileSync( path.resolve() + '/src/resources/external/withdraw_proving_key.bin' ) ).buffer;

			for( const deposit of deposits ) {
				const tornado = new ethers.Contract( institution.tornados[`d_${deposit.denomination}`], tornadoJSON.abi, sender );
				const depositEvents = ( await tornado.queryFilter( 'Deposit', lastBlock ) ).map( depositArgs => ( {
					leafIndex: depositArgs.args.leafIndex,
					commitment: depositArgs.args.commitment,
				} ) );
				const { root, proof } = await generateProof( Buffer.from( deposit.preimage, 'hex' ), operatorAddress, MERKLE_TREE_HEIGHT, depositEvents, circuit, provingKey );
				const rootHex = BNfrom( root ).toHexString();
				await tornado.withdraw( proof, rootHex, deposit.nullifierHash, operatorAddress, ethers.constants.AddressZero, 0, 0, { gasLimit: 30000000 } );
			}
			return true;
		} );

		this.post( '/transferCustomer', async req => {
			const { tokenAddress, amount, account, network } = req.body;
			const sender = operator.connect( new ethers.providers.WebSocketProvider( networks[network] || networks.commercial ) );

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );

			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, sender );
			return await token.transfer( account, amount, { gasLimit: 30000000 } );
		} )

	}

}
