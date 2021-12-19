import fs from "fs";
import path from "path";
import ethers from "ethers";
import { deployERC20Tornado, generateProof, MERKLE_TREE_HEIGHT } from "../lib/index.js";
import Router from './router.js';
import InteroperableTokenJSON from '../contracts/InteroperableToken.json';

const BNfrom = ethers.BigNumber.from;
const operator = new ethers.Wallet( "6ccfcaa51011057276ef4f574a3186c1411d256e4d7731bdf8743f34e608d1d1", new ethers.providers.JsonRpcProvider( "https://writer.lacchain.net" ) );

const institutions = [];

export default class APIRouter extends Router {

	constructor() {
		super();
	}

	async init() {
		const operatorAddress = await operator.getAddress();

		this.get( '/', async() => {
			return {
				version: '1.0'
			}
		} );

		this.post( '/deploy', async req => {
			const { name, symbol, initialSupply } = req.body;

			const InteroperableToken = new ethers.ContractFactory( InteroperableTokenJSON.abi, InteroperableTokenJSON.bytecode, operator );
			const token = await InteroperableToken.deploy( name, symbol, name, initialSupply, operatorAddress, operatorAddress, operatorAddress, operatorAddress, operatorAddress );
			await token.deployed();

			const tornado = await deployERC20Tornado( operator, 1, token.address )
			await tornado.deployed();
			await token.addTornadoContract( tornado.address );

			const totalSupply = await token.totalSupply();

			institutions.push( { name, symbol, initialSupply, token, tornado } );
			return { name, symbol, tokenAddress: token.address, tornadoAddress: tornado.address, totalSupply: parseInt( totalSupply, 16 ) };
		} );

		this.post( '/connect', async req => {
			const { indexFrom, indexTo } = req.body;

			if( indexFrom >= institutions.length ) throw new Error( "Invalid indexFrom Institution " );
			if( indexTo >= institutions.length ) throw new Error( "Invalid indexTo Institution " );

			const institutionFrom = institutions[indexFrom];
			const institutionTo = institutions[indexTo];

			await institutionFrom.token.addOrDeleteInstitution( institutionTo.name, institutionTo.token.address, true );

			return true;
		} );

		this.post( '/deposit', async req => {
			const { amount, institutionIndex } = req.body;

			if( institutionIndex >= institutions.length ) throw new Error( "Invalid Institution index" );

			const institution = institutions[institutionIndex];
			await institution.token.mint( operatorAddress, amount );

			const totalSupply = await institution.token.totalSupply();
			return {
				totalSupply: parseInt( totalSupply, 16 )
			}
		} );

		this.post( '/transfer', async req => {
			/*const amount = req.body.amount;
			//burning with a correct commitment value.
			const deposit = newDeposit();
			let commitmentHex = BNfrom( deposit.commitment ).toHexString();
			//burning on institution 1 to deposit into institution 2
			await financialInstitution1.burnAndTransferToConnectedInstitution( amount, [amount], [commitmentHex], financialInstitution2Name );*/
		} )

		this.get( '/balance', async req => {
			const { institutionIndex } = req.body;

			if( institutionIndex >= institutions.length ) throw new Error( "Invalid Institution index" );
			const institution = institutions[institutionIndex];

			const balance = await institution.token.balanceOf( institution.address );
			return {
				balance: parseInt( balance, 16 )
			}
		} );

		this.post( '/withdraw', async req => {
			const { institutionIndex } = req.body;

			if( institutionIndex >= institutions.length ) throw new Error( "Invalid Institution index" );
			const institution = institutions[institutionIndex];
			//withdraw from institution tornado contract
			const circuit = fs.readFileSync( path.resolve() + '/resources/external/withdraw.json' );
			const provingKey = ( await fs.readFileSync( path.resolve() + '/resources/external/withdraw_proving_key.bin' ) ).buffer;
			const depositEvents = ( await institution.tornado.queryFilter( 'Deposit' ) ).map( depositArgs => ( {
				leafIndex: depositArgs.args.leafIndex,
				commitment: depositArgs.args.commitment,
			} ) );
			//sending the withdrawn tokens to institution2's contract address (as that already has the authorised role)
			const {
				root,
				proof
			} = await generateProof( deposit.preimage, institution.token.address, MERKLE_TREE_HEIGHT, depositEvents, circuit, provingKey );
			const rootHex = BNfrom( root ).toHexString();
			const nullifierHashHex = BNfrom( deposit.nullifierHash ).toHexString();
			//checking the receiving address has 0 balance before the withdrawal
			await institution.tornado.withdraw(
				proof,
				rootHex,
				nullifierHashHex,
				institution.token.address,
				ethers.constants.AddressZero,
				0,
				0
			);

			const balance = await institution.token.balanceOf( institution.token.address );

			return {
				balance: parseInt( balance, 16 )
			};
		} );

	}

}