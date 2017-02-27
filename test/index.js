import _ from 'lodash';
import fetch from 'isomorphic-fetch';
import Bluebird from 'bluebird';
import { expect } from 'chai';
import intercept from 'intercept-stdout';
import stripAnsi from 'strip-ansi';

import { start, stop } from './server';
import { config, Transaction } from '../lib/index';
import Stack from '../lib/stack';

const BUCKET_ID = 'cc6e1624-5b2c-524d-81ef-d11e61fc14d5';

let unhook = _.noop;

before(() => {
	unhook = intercept((txt) => {
		if (/(^|\W)(error|warning):(\W|$)/i.test(stripAnsi(txt))) {
			throw new Error(txt);
		}
	});
});

after(() => unhook());

describe('bitclock', () => {
	describe('config', () => {
		it('should set config values', () => {
			expect(config().bucket).to.equal(null);
			config({ bucket: BUCKET_ID });
			expect(config().bucket).to.equal(BUCKET_ID);
		});

		it('should throw an error given an invalid reportingInterval', () => {
			expect(() => config({ reportingInterval: null })).to.throw(Error);
			expect(() => config({ reportingInterval: 1 })).to.throw(Error);
			expect(() => config({ reportingInterval: 300.5 })).to.throw(Error);
		});
	});

	describe('Transaction', () => {
		const tmp = config();
		const reportingInterval = 200;
		const reportingEndpoint = 'http://localhost:3000';
		let transaction;

		before(() => {
			config({ reportingInterval, reportingEndpoint });
			return start();
		});

		after(() => {
			config(tmp);
			return stop();
		});

		beforeEach(() => {
			transaction = Transaction();
		});

		describe('tic', () => {
			it('log a warning if label is falsy', () => {
				expect(() => transaction.tic()).to.throw(/warning/i);
				expect(() => transaction.tic('')).to.throw(/warning/i);
				expect(() => transaction.tic(0)).to.throw(/warning/i);
				expect(() => transaction.tic(null)).to.throw(/warning/i);
				expect(() => transaction.tic(false)).to.throw(/warning/i);
			});

			it('log a warning if label is not a string', () => {
				expect(() => transaction.tic(1)).to.throw(/warning/i);
				expect(() => transaction.tic({})).to.throw(/warning/i);
				expect(() => transaction.tic(true)).to.throw(/warning/i);
			});
		});

		describe('toc', () => {
			it('should log a warning if the label does not exist', () => {
				expect(() => transaction.toc('invalid')).to.throw(/warning/i);
			});

			it('should enqueue an event created with tic', () => {
				const tests = _.map([1, 2, 3], (n) => {
					return Bluebird
						.resolve(transaction.tic(`test${n}`))
						.delay(_.random(1, reportingInterval))
						.then(() => transaction.toc(`test${n}`));
				});

				return Bluebird
					.all(tests)
					.delay(reportingInterval + 50)
					.then(() => fetch(`${reportingEndpoint}/events`))
					.then(res => res.json())
					.then((events) => {
						expect(events).to.have.length.gte(tests.length);
						events.forEach((event) => {
							expect(event.elapsed).to.be.within(1, reportingInterval + 50);
						});
					});
			});
		});

		describe('report', () => {
			it('should not block promise chains when the server fails to respond', () => {
				const tStart = Date.now();
				return Bluebird
					.resolve(transaction.report({ message: 'timeout' }))
					.then(() => expect(Date.now() - tStart).to.be.at.most(100))
					.delay(1000);
			});

			it('should enqueue and send events in series', () => {
				const event1 = { message: 'event1' };
				const event2 = { message: 'event2' };
				return Bluebird
					.resolve(transaction.report(event1))
					.delay(reportingInterval + 50)
					.then(() => fetch(`${reportingEndpoint}/events`))
					.then(res => res.json())
					.then(([event]) => expect(event).to.include(event1))
					.then(() => transaction.report(event2))
					.delay(reportingInterval + 50)
					.then(() => fetch(`${reportingEndpoint}/events`))
					.then(res => res.json())
					.then(([event]) => expect(event).to.include(event2));
			});
		});

		describe('all', () => {
			it('should merge common data with all events in transaction', () => {
				const common = { isCommon: true };
				const event1 = { message: 'event1' };
				const event2 = { message: 'event2' };
				transaction.all(common);
				return Bluebird
					.resolve(transaction.report(event1))
					.delay(reportingInterval + 50)
					.then(() => fetch(`${reportingEndpoint}/events`))
					.then(res => res.json())
					.then(([event]) => expect(event).to.include({ ...event1, ...common }))
					.then(() => transaction.report(event2))
					.delay(reportingInterval + 50)
					.then(() => fetch(`${reportingEndpoint}/events`))
					.then(res => res.json())
					.then(([event]) => expect(event).to.include({ ...event2, ...common }));
			});
		});
	});
});

describe('Stack', () => {
	it('should handle objects, arrays, and functions that return either', () => {
		const object = { message: 'event1' };
		const array = [{ message: 'event2' }, { message: 'event3' }];
		const fnObject = () => ({ message: 'event4' });
		const fnArray = () => [{ message: 'event5' }, { message: 'event6' }];
		const expected = _.range(1, 7).map(n => ({ message: `event${n}` }));
		const stack = Stack();

		stack.put(object);
		stack.put(array);
		stack.put(fnObject);
		stack.put(fnArray);
		expect(stack.flush()).to.eql(expected);
		expect(stack.flush()).to.have.length(0);
	});

	it('should honor maxChunkSize', () => {
		const chunkSize = 10;
		const stack = Stack();
		const input = _.range(1, 15);

		input.forEach(n => stack.put(n));
		expect(stack.flush()).to.have.length(input.length);
		expect(stack.flush()).to.have.length(0);

		input.forEach(n => stack.put(n));
		expect(stack.flush(chunkSize)).to.have.length(chunkSize);
		expect(stack.flush(chunkSize)).to.have.length(input.length - chunkSize);
		expect(stack.flush()).to.have.length(0);
	});
});
