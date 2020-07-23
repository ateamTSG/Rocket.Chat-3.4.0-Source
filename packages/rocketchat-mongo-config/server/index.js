import tls from 'tls';
import { PassThrough } from 'stream';

import { EmailTest } from 'meteor/email';
import { Mongo } from 'meteor/mongo';

// FIX For TLS error see more here https://github.com/RocketChat/Rocket.Chat/issues/9316
// TODO: Remove after NodeJS fix it, more information
// https://github.com/nodejs/node/issues/16196
// https://github.com/nodejs/node/pull/16853
// This is fixed in Node 10, but this supports LTS versions
tls.DEFAULT_ECDH_CURVE = 'auto';

const mongoConnectionOptions = {
	// add retryWrites=false if not present in MONGO_URL
	...!process.env.MONGO_URL.includes('retryWrites') && { retryWrites: false },
};

const mongoOptionStr = process.env.MONGO_OPTIONS;
if (typeof mongoOptionStr !== 'undefined') {
	const mongoOptions = JSON.parse(mongoOptionStr);

	Object.assign(mongoConnectionOptions, mongoOptions);
}

if (Object.keys(mongoConnectionOptions).length > 0) {
	Mongo.setConnectionOptions(mongoConnectionOptions);
}

process.env.HTTP_FORWARDED_COUNT = process.env.HTTP_FORWARDED_COUNT || '1';

// Send emails to a "fake" stream instead of print them in console
if (process.env.NODE_ENV !== 'development' || process.env.TEST_MODE) {
	const stream = new PassThrough();
	EmailTest.overrideOutputStream(stream);
	stream.on('data', () => {});
	stream.on('end', () => {});
}
