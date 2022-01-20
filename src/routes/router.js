import express from 'express';
import Logger from "../utils/logger.js";
import config from "../config.js";
import multer from "multer";
import swaggerUi from "swagger-ui-express";

export default class Router {

	constructor() {
		this.router = express.Router();
		this.logger = ( new Logger() ).instance( `${config.ELASTIC_APP_INDEX}-api` );
		this.init();
	}

	init() {
	}

	swagger( path, document ) {
		this.router.use( path, swaggerUi.serve );
		this.router.get( path, swaggerUi.setup( document ) );
	}

	get( path, ...callbacks ) {
		this.router.get( path, this._bindCustomResponses, this._getCallbacks( callbacks ) );
	}

	post( path, ...callbacks ) {
		this.router.post( path, this._bindCustomResponses, this._getCallbacks( callbacks ) );
	}

	upload( path, filename, ...callbacks ) {
		const upload = multer();
		this.router.post( path, this._bindCustomResponses, upload.single( filename ), this._getCallbacks( callbacks ) );
	}

	getRouter() {
		return this.router;
	}

	_getCallbacks( callbacks ) {
		return callbacks.map( ( callback ) => async( ...params ) => {
			try {
				const startTime = new Date().getTime();
				const response = await callback.apply( this, params )
				const endTime = new Date().getTime();
				const latency = endTime - startTime;
				this.logger.info( `${params[0].method} ${params[0].originalUrl}` );
				this.logger.debug( `${params[0].method} ${params[0].originalUrl}`, {
					response: {
						status: 200,
						executionTime: latency
					},
					request: JSON.stringify( params[0].body, null, 2 )
				} );
				params[1].sendSuccess( response );
			} catch( error ) {
				this.logger.error( `${params[0].method} ${params[0].originalUrl}`, {
					response: {
						status: 500,
						error: error + ''
					},
					request: JSON.stringify( params[0].body, null, 2 )
				} );
				params[1].sendError( error + '' );
			}
		} );
	}

	_bindCustomResponses( req, res, next ) {
		res.sendSuccess = ( payload ) => {
			res.status( 200 ).json( payload );
		};
		res.sendError = ( error ) => {
			res.status( 500 ).json( error );
		};
		next();
	}
}