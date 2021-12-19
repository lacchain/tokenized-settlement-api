import winston from "winston";
import WinstonElastic from "winston-elasticsearch";
import ElasticSearch from "@elastic/elasticsearch";
import config from '../config.js';

export default class Logger {

	constructor() {
		if( config.ELASTIC_LOGGER_LEVEL !== 'none' )
			this.client = new ElasticSearch.Client( {
				node: config.ELASTIC_NODE_URL,
				auth: {
					username: 'elastic',
					password: config.ELASTIC_APP_KEY
				}
			} )
	}

	instance( index ) {
		return winston.createLogger( {
			transports: [
				...( config.ELASTIC_LOGGER_LEVEL !== 'none' ? [new WinstonElastic.ElasticsearchTransport( {
					level: config.ELASTIC_LOGGER_LEVEL,
					index,
					client: this.client
				} )] : [] ),
				new winston.transports.Console( {
					level: config.CONSOLE_LOGGER_LEVEL,
					handleExceptions: true,
					format: winston.format.cli(),
					colorize: true
				} )
			],
			silent: config.CONSOLE_LOGGER_LEVEL === 'none'
		} );

	}
}