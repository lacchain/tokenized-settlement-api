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

const BNfrom = ethers.BigNumber.from;
const operator = new ethers.Wallet( "6ccfcaa51011057276ef4f574a3186c1411d256e4d7731bdf8743f34e608d1d1", new ethers.providers.JsonRpcProvider( "https://writer.lacchain.net" ) );

export default class APIRouter extends Router {

	constructor() {
		super();
	}

	async init() {
		const operatorAddress = await operator.getAddress();

		const redisClient = redis.createClient( {
			host: 'redis-service',
			port: 6379,
			db: 1
		} );

		await redisClient.connect();

		this.swagger( '/', swaggerDocument );

		this.post( '/deploy', async req => {
			const { name, symbol, initialSupply } = req.body;

			if( isNaN( initialSupply ) ) throw new Error( "initialSupply is not a number" );

			const InteroperableToken = new ethers.ContractFactory( InteroperableTokenJSON.abi, InteroperableTokenJSON.bytecode, operator );
			const token = await InteroperableToken.deploy( name, symbol, name, `0x${initialSupply.toString( 16 )}`, operatorAddress, operatorAddress, operatorAddress, operatorAddress, operatorAddress );
			await token.deployed();

			const tornado = await deployERC20Tornado( operator, 1, token.address )
			await tornado.deployed();
			await token.addTornadoContract( tornado.address );

			const totalSupply = await token.totalSupply();

			await redisClient.set( token.address, JSON.stringify( {
				name,
				symbol,
				initialSupply,
				token: token.address,
				tornado: tornado.address
			} ) );

			return {
				name,
				symbol,
				tokenAddress: token.address,
				tornadoAddress: tornado.address,
				totalSupply: totalSupply.toString()
			};
		} );

		this.post( '/connect', async req => {
			const { fromAddress, toAddress } = req.body;

			const from = await redisClient.get( fromAddress );
			const to = await redisClient.get( toAddress );

			if( !from ) throw new Error( "Invalid (from) institution" );
			if( !to ) throw new Error( "Invalid (to) institution" );

			const institutionFrom = JSON.parse( from );
			const institutionTo = JSON.parse( to );

			const tokenFrom = new ethers.Contract( institutionFrom.token, InteroperableTokenJSON.abi, operator );

			await tokenFrom.addOrDeleteInstitution( institutionTo.name, institutionTo.token, true );

			return true;
		} );

		this.post( '/mint', async req => {
			const { tokenAddress, amount } = req.body;

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, operator );

			await token.mint( operatorAddress, `0x${amount.toString( 16 )}` );

			const totalSupply = await token.totalSupply();
			return {
				preimage: totalSupply.toString()
			}
		} );

		this.post( '/transfer', async req => {
			const { fromAddress, toAddress, amount } = req.body;

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const from = await redisClient.get( fromAddress );
			const to = await redisClient.get( toAddress );

			if( !from ) throw new Error( "Invalid (from) institution" );
			if( !to ) throw new Error( "Invalid (to) institution" );

			const institutionFrom = JSON.parse( from );
			const institutionTo = JSON.parse( to );

			const deposit = newDeposit();
			let commitmentHex = BNfrom( deposit.commitment ).toHexString();
			const tokenFrom = new ethers.Contract( institutionFrom.token, InteroperableTokenJSON.abi, operator );
			await tokenFrom.burnAndTransferToConnectedInstitution( amount, [amount], [commitmentHex], institutionTo.name );

			return {
				preimage: deposit.preimage.toString( 'hex' ),
				nullifierHash: BNfrom( deposit.nullifierHash ).toHexString()
			}
		} )

		this.get( '/balance/:tokenAddress/:accountAddress', async req => {
			const { tokenAddress, accountAddress } = req.params;

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );

			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, operator );
			const balance = await token.balanceOf( accountAddress ); // 0x4222ec932c5a68b80e71f4ddebb069fa02518b8a
			return {
				balance: balance.toString()
			}
		} );

		this.post( '/withdraw', async req => {
			const { tokenAddress, preimage, nullifierHash } = req.body;

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const tornado = new ethers.Contract( institution.tornado, tornadoJSON.abi, operator );
			//withdraw from institution tornado contract
			const provingKey = ( await fs.readFileSync( path.resolve() + '/src/resources/external/withdraw_proving_key.bin' ) ).buffer;
			const depositEvents = ( await tornado.queryFilter( 'Deposit', 35435620 ) ).map( depositArgs => ( {
				leafIndex: depositArgs.args.leafIndex,
				commitment: depositArgs.args.commitment,
			} ) );

			//sending the withdrawn tokens to institution2's contract address (as that already has the authorised role)
			const {
				root,
				proof
			} = await generateProof( Buffer.from( preimage, 'hex' ), institution.token, MERKLE_TREE_HEIGHT, depositEvents, circuit, provingKey );
			const rootHex = BNfrom( root ).toHexString();

			//checking the receiving address has 0 balance before the withdrawal
			await tornado.withdraw(
				proof,
				rootHex,
				nullifierHash,
				institution.token,
				ethers.constants.AddressZero,
				0,
				0
			);

			return true;
		} );

	}

}