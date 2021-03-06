import DeferredEvent from './deferred-event';
import Transaction from './transaction';
import { validateDimensions } from './validators';
import { hrtime, cloneDeepJSON } from './helpers';
import { warn } from './logger';
import { assign } from './builtins/object';

// FIXME: remove istanbul ignore once Waterfall is officially supported
export default function Waterfall(dimensions = {}, transaction = Transaction()) /* istanbul ignore next */ {
	const elements = [];
	let initTime = hrtime();
	let committed;

	validateDimensions(dimensions);

	function setInitTime(time) {
		initTime = time;
	}

	function push(element) {
		if (committed) {
			warn(() => 'Attempted push to committed waterfall');
		} else if (element) {
			const offset = hrtime() - initTime;
			elements.push(assign(element, { offset }));
		}
	}

	function span(initialData = {}) {
		push(initialData);
		return DeferredEvent(undefined, (elapsed, finalData) => {
			assign(initialData, finalData, { elapsed });
			return waterfall;
		});
	}

	function point(data) {
		push(data);
		return waterfall;
	}

	function commit() {
		if (committed) {
			warn(() => 'Attempted multiple commits on waterfall');
		} else {
			committed = true;
			transaction.dispatch('waterfall', elements, dimensions);
		}
	}

	const waterfall = {
		span,
		point,
		commit,
		setInitTime,
		get elements() {
			return cloneDeepJSON(elements);
		}
	};

	return waterfall;
}
