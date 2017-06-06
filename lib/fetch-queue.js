import fetch from 'isomorphic-fetch';

import pkg from '../package.json';
import Stack from './stack';
import { debug, warn } from './logger';
import { get, isBrowser, once, hrtime, getToken, safeStringify } from './helpers';
import CONFIG, { MIN_INTERVAL } from './config';

const logEnvWarning = once(() => warn(() => 'Missing value for config.env'));
const stack = Stack();

let lastSent;
let checkInProgress;

export default function enqueue(substack) {
	if (CONFIG.enable) {
		stack.put(() => substack.flush());
		debug(() => (
			`enqueue / stack.size = ${stack.size} / substack = ${JSON.stringify(substack, null, 2)}`
		));
		// wrap this in a timeout so libs like bluebird
		// don't complain about orphaned promises
		if (!checkInProgress) {
			checkInProgress = true;
			setTimeout(checkTime);
		}
	}
}

function checkTime() {
	debug(() => `enqueue / checkTime / lastSent = ${lastSent}`);
	const time = hrtime();
	if (!lastSent || time - CONFIG.reportingInterval >= lastSent) {
		lastSent = time;
		debug(() => `enqueue / flush stack / stack.size = ${stack.size}`);
		while (stack.size > 0) {
			send(stack.flush());
		}
	}
	if (stack.size) {
		setTimeout(checkTime, MIN_INTERVAL);
	} else {
		checkInProgress = false;
	}
}

function send(events) {
	if (!CONFIG.env) {
		logEnvWarning();
	}

	debug(() => `events = ${JSON.stringify(events, null, 2)}`);

	if (events.length < 1) {
		return Promise.resolve();
	}

	const { bucket, reportingEndpoint, reportingAPIVersion } = CONFIG;
	const uri = `${reportingEndpoint}/${reportingAPIVersion}/bucket/${bucket}/event`;

	const { env } = CONFIG;
	const { version } = pkg;
	const userAgent = get(global, ['navigator', 'userAgent']);
	const source = isBrowser() ? 'client' : 'server';
	const body = { version, env, userAgent, source, events };

	return fetch(uri, {
		method: 'POST',
		headers: {
			accept: 'application/json',
			authorization: `Bearer ${getToken()}`,
			'content-type': 'application/json',
		},
		body: safeStringify(body)
	})
	.catch(err => warn(err.stack));
}