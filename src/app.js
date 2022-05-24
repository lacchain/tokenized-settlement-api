import express from 'express';
import http from 'http';
import https from "https";
import cors from 'cors';
import fs from "fs";
import APIRouter from "./routes/api.js";

const app = express();

const apiRouter = new APIRouter();

app.use( cors() );
app.use( express.json( { limit: 152428800 } ) );
app.use( express.urlencoded( { extended: false } ) );

app.use( '/', apiRouter.getRouter() );


const port = process.env.PORT || 8085;
if( !process.env.SSL ) {
	const server = http.createServer( app );

	server.listen( port, () => {
		console.log( 'LACChain Tokenized Money Settlement API | v1.1 HTTP port', port );
	} );
} else {
	const privateKey = fs.readFileSync( process.env.CERT_KEY, 'utf8' );
	const certificate = fs.readFileSync( process.env.CERT_CRT, 'utf8' );
	const credentials = { key: privateKey, cert: certificate };
	const ssl = https.createServer( credentials, app );

	ssl.listen( port, '0.0.0.0', () => {
		console.log( 'LACChain Tokenized Money Settlement API | v1.1 HTTPS port', port );
	} );
}