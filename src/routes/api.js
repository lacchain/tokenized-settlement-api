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

		const redisClient = redis.createClient( {
			url: process.env.REDIS_HOST
		} );

		await redisClient.connect();

		this.swagger( '/', swaggerDocument );

		this.post( '/deploy', async req => {
			const { name, symbol, initialSupply } = req.body;

			if( isNaN( initialSupply ) ) throw new Error( "initialSupply is not a number" );

			const InteroperableToken = new ethers.ContractFactory( InteroperableTokenJSON.abi, InteroperableTokenJSON.bytecode, operator );
			const token = await InteroperableToken.deploy( name, symbol, name, `0x${initialSupply.toString( 16 )}`, operatorAddress, operatorAddress, operatorAddress, operatorAddress, operatorAddress );
			await token.deployed();

			const tornados = {};
			for( const denomination of denominations ){
				const tornado = await deployERC20Tornado( operator, denomination, token.address )
				await tornado.deployed();
				await token.addTornadoContract( tornado.address );
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

			return {
				name,
				symbol,
				tokenAddress: token.address,
				tornados,
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

		this.get( '/supply/:tokenAddress', async req => {
			const { tokenAddress } = req.params;

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, operator );

			const totalSupply = await token.totalSupply();
			return {
				totalSupply: totalSupply.toString()
			}
		});

		this.post( '/mint', async req => {
			const { tokenAddress, amount } = req.body;

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, operator );

			await token.mint( operatorAddress, `0x${amount.toString( 16 )}` );

			await sleep(3);

			const totalSupply = await token.totalSupply();
			return {
				totalSupply: totalSupply.toString()
			}
		} );

		this.get( '/balance/:tokenAddress/:accountAddress', async req => {
			const { tokenAddress, accountAddress } = req.params;

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );

			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, operator );
			const balance = await token.balanceOf( accountAddress ); // operator = 0x4222ec932c5a68b80e71f4ddebb069fa02518b8a
			return {
				balance: balance.toString()
			}
		} );

		this.post( '/addCustomer', async req => {
			const { tokenAddress, account } = req.body;

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, operator );

			const role = await token.AUTHORISED_ROLE();
			const hasRole = await token.hasRole( role, account );
			if( !hasRole ) {
				await token.addOrDeleteAuthorisedUser( account, true );
			}

			return true;
		} );

		this.post( '/transferInstitution1', async req => {
			const { fromAddress, toAddress, amount } = req.body;

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const from = await redisClient.get( fromAddress );
			const to = await redisClient.get( toAddress );

			if( !from ) throw new Error( "Invalid (from) institution" );
			if( !to ) throw new Error( "Invalid (to) institution" );

			const institutionFrom = JSON.parse( from );
			const institutionTo = JSON.parse( to );

			const amounts = amountInDenominations( amount + 0 );
			const deposits = amounts.map( value => ({ denomination: value, ...newDeposit() }) );
			const tokenFrom = new ethers.Contract( institutionFrom.token, InteroperableTokenJSON.abi, operator );
			const commitments = deposits.map(({ commitment }) => BNfrom( commitment ).toHexString() );
			this.logger.silly( `transferInstitution1`, { amount, amounts, commitments, institution: institutionTo.name } );
			await tokenFrom.burnAndTransferToConnectedInstitution( amount, amounts, commitments, institutionTo.name );
			return deposits.map( ({ denomination, preimage, nullifierHash,  }) => ({
				denomination,
				preimage: preimage.toString( 'hex' ),
				nullifierHash: BNfrom( nullifierHash ).toHexString()
			}) )
		} );

		this.post( '/transferInstitution2', async req => {
			const { tokenAddress, deposits } = req.body;

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );

			const provingKey = ( await fs.readFileSync( path.resolve() + '/src/resources/external/withdraw_proving_key.bin' ) ).buffer;

			for( const deposit of deposits ) {
				const tornado = new ethers.Contract( institution.tornados[`d_${deposit.denomination}`], tornadoJSON.abi, operator );
				const depositEvents = ( await tornado.queryFilter( 'Deposit', 42742914 ) ).map( depositArgs => ( {
					leafIndex: depositArgs.args.leafIndex,
					commitment: depositArgs.args.commitment,
				} ) );
				const { root, proof } = await generateProof( Buffer.from( deposit.preimage, 'hex' ), operatorAddress, MERKLE_TREE_HEIGHT, depositEvents, circuit, provingKey );
				const rootHex = BNfrom( root ).toHexString();
				await tornado.withdraw( proof, rootHex, deposit.nullifierHash, operatorAddress, ethers.constants.AddressZero, 0, 0 );
			}
			return true;
		} );

		this.post( '/transferCustomer', async req => {
			const { tokenAddress, amount, account } = req.body;

			if( isNaN( amount ) ) throw new Error( "amount is not a number" );

			const object = await redisClient.get( tokenAddress );
			if( !object ) throw new Error( "Invalid token address" );

			const institution = JSON.parse( object );

			const amounts = amountInDenominations( amount + 0);
			const deposits = amounts.map( value => ({ denomination: value, ...newDeposit() }) );
			const token = new ethers.Contract( institution.token, InteroperableTokenJSON.abi, operator );
			const commitments = deposits.map(({ commitment }) => BNfrom( commitment ).toHexString() );
			this.logger.silly( `transferCustomer`, { amount, amounts, commitments, institution: institution.name } );
			await token.burnAndTransferToConnectedInstitution( amount, amounts, commitments, institution.name );
			const proofs = deposits.map( ({ denomination, preimage, nullifierHash,  }) => ({
				denomination,
				preimage: preimage.toString( 'hex' ),
				nullifierHash: BNfrom( nullifierHash ).toHexString()
			}) )

			// Wait after burnAndTransferToConnectedInstitution tx
			await sleep(3);

			const provingKey = ( await fs.readFileSync( path.resolve() + '/src/resources/external/withdraw_proving_key.bin' ) ).buffer;

			for( const deposit of proofs ) {
				const tornado = new ethers.Contract( institution.tornados[`d_${deposit.denomination}`], tornadoJSON.abi, operator );
				const depositEvents = ( await tornado.queryFilter( 'Deposit', 42742914 ) ).map( depositArgs => ( {
					leafIndex: depositArgs.args.leafIndex,
					commitment: depositArgs.args.commitment,
				} ) );
				const { root, proof } = await generateProof( Buffer.from( deposit.preimage, 'hex' ), account, MERKLE_TREE_HEIGHT, depositEvents, circuit, provingKey );
				const rootHex = BNfrom( root ).toHexString();
				await tornado.withdraw( proof, rootHex, deposit.nullifierHash, account, ethers.constants.AddressZero, 0, 0 );
			}

			return true;
		} )

	}

}
