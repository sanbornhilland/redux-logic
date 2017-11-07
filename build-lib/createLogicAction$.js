'use strict';

exports.__esModule = true;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

exports['default'] = createLogicAction$;

var _isObservable = require('is-observable');

var _isObservable2 = _interopRequireDefault(_isObservable);

var _isPromise = require('is-promise');

var _isPromise2 = _interopRequireDefault(_isPromise);

var _Observable = require('rxjs/Observable');

var _Subject = require('rxjs/Subject');

var _asap = require('rxjs/scheduler/asap');

require('rxjs/add/observable/fromPromise');

require('rxjs/add/observable/of');

require('rxjs/add/observable/throw');

require('rxjs/add/observable/timer');

require('rxjs/add/operator/defaultIfEmpty');

require('rxjs/add/operator/do');

require('rxjs/add/operator/filter');

require('rxjs/add/operator/map');

require('rxjs/add/operator/mergeAll');

require('rxjs/add/operator/observeOn');

require('rxjs/add/operator/take');

require('rxjs/add/operator/takeUntil');

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

// confirm custom Rx build imports
(0, _utils.confirmProps)(_Observable.Observable, ['fromPromise', 'of', 'throw', 'timer'], 'Observable');
(0, _utils.confirmProps)(_Observable.Observable.prototype, ['defaultIfEmpty', 'do', 'filter', 'map', 'mergeAll', 'take', 'takeUntil'], 'Observable.prototype');

var UNHANDLED_LOGIC_ERROR = 'UNHANDLED_LOGIC_ERROR';
var NODE_ENV = process.env.NODE_ENV;

var debug = function debug() /* ...args */{};

function createLogicAction$(_ref) {
  var action = _ref.action,
      logic = _ref.logic,
      store = _ref.store,
      deps = _ref.deps,
      cancel$ = _ref.cancel$,
      monitor$ = _ref.monitor$;
  var getState = store.getState;
  var name = logic.name,
      warnTimeout = logic.warnTimeout,
      processFn = logic.process,
      _logic$processOptions = logic.processOptions,
      dispatchReturn = _logic$processOptions.dispatchReturn,
      dispatchMultiple = _logic$processOptions.dispatchMultiple,
      successType = _logic$processOptions.successType,
      failType = _logic$processOptions.failType;

  var intercept = logic.validate || logic.transform; // aliases

  debug('createLogicAction$', name, action);
  monitor$.next({ action: action, name: name, op: 'begin' });

  // once action reaches bottom, filtered, nextDisp, or cancelled
  var interceptComplete = false;

  // logicAction$ is used for the mw next(action) call
  var logicAction$ = _Observable.Observable.create(function (logicActionObs) {
    // create notification subject for process which we dispose of
    // when take(1) or when we are done dispatching
    var cancelled$ = new _Subject.Subject().take(1);
    cancel$.subscribe(cancelled$); // connect cancelled$ to cancel$
    cancelled$.subscribe(function () {
      if (!interceptComplete) {
        monitor$.next({ action: action, name: name, op: 'cancelled' });
      } else {
        // marking these different so not counted twice
        monitor$.next({ action: action, name: name, op: 'dispCancelled' });
      }
    });

    // In non-production mode only we will setup a warning timeout that
    // will console.error if logic has not completed by the time it fires
    // warnTimeout can be set to 0 to disable
    if (NODE_ENV !== 'production' && warnTimeout) {
      _Observable.Observable.timer(warnTimeout)
      // take until cancelled, errored, or completed
      .takeUntil(cancelled$.defaultIfEmpty(true))['do'](function () {
        // eslint-disable-next-line no-console
        console.error('warning: logic (' + name + ') is still running after ' + warnTimeout / 1000 + 's, forget to call done()? For non-ending logic, set warnTimeout: 0');
      }).subscribe();
    }

    var dispatch$ = new _Subject.Subject().mergeAll().takeUntil(cancel$);
    dispatch$['do'](mapToActionAndDispatch, // next
    mapErrorToActionAndDispatch // error
    ).subscribe({
      error: function error() /* err */{
        monitor$.next({ action: action, name: name, op: 'end' });
        // signalling complete here since error was dispatched
        // accordingly, otherwise if we were to signal an error here
        // then cancelled$ subscriptions would have to specifically
        // handle error in subscribe otherwise it will throw. So
        // it doesn't seem that it is worth it.
        cancelled$.complete();
        cancelled$.unsubscribe();
      },
      complete: function complete() {
        monitor$.next({ action: action, name: name, op: 'end' });
        cancelled$.complete();
        cancelled$.unsubscribe();
      }
    });

    function storeDispatch(act) {
      monitor$.next({ action: action, dispAction: act, op: 'dispatch' });
      return store.dispatch(act);
    }

    function mapToActionAndDispatch(actionOrValue) {
      var act = successType ? mapToAction(successType, actionOrValue, false) : actionOrValue;
      if (act) {
        storeDispatch(act);
      }
    }

    /* eslint-disable consistent-return */
    function mapErrorToActionAndDispatch(actionOrValue) {
      if (failType) {
        // we have a failType, if truthy result we will use it
        var act = mapToAction(failType, actionOrValue, true);
        if (act) {
          return storeDispatch(act);
        }
        return; // falsey result from failType, no dispatch
      }

      // no failType so must wrap values with no type
      if (actionOrValue instanceof Error) {
        var _act = actionOrValue.type ? actionOrValue : // has type
        {
          type: UNHANDLED_LOGIC_ERROR,
          payload: actionOrValue,
          error: true
        };
        return storeDispatch(_act);
      }

      // dispatch objects or functions as is
      var typeOfValue = typeof actionOrValue;
      if (actionOrValue && ( // not null and is object | fn
      typeOfValue === 'object' || typeOfValue === 'function')) {
        return storeDispatch(actionOrValue);
      }

      // wasn't an error, obj, or fn, so we will wrap in unhandled
      storeDispatch({
        type: UNHANDLED_LOGIC_ERROR,
        payload: actionOrValue,
        error: true
      });
    }
    /* eslint-enable consistent-return */

    function mapToAction(type, payload, err) {
      if (typeof type === 'function') {
        // action creator fn
        return type(payload);
      }
      var act = { type: type, payload: payload };
      if (err) {
        act.error = true;
      }
      return act;
    }

    // allowMore is now deprecated in favor of variable process arity
    // which sets processOptions.dispatchMultiple = true then
    // expects done() cb to be called to end
    // Might still be needed for internal use so keeping it for now
    var DispatchDefaults = {
      allowMore: false
    };

    function dispatch(act) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DispatchDefaults;

      var _applyDispatchDefault = applyDispatchDefaults(options),
          allowMore = _applyDispatchDefault.allowMore;

      if (typeof act !== 'undefined') {
        // ignore empty action
        dispatch$.next( // create obs for mergeAll
        // eslint-disable-next-line no-nested-ternary
        (0, _isObservable2['default'])(act) ? act : (0, _isPromise2['default'])(act) ? _Observable.Observable.fromPromise(act) : act instanceof Error ? _Observable.Observable['throw'](act) : _Observable.Observable.of(act));
      }
      if (!(dispatchMultiple || allowMore)) {
        dispatch$.complete();
      }
      return act;
    }

    function applyDispatchDefaults(options) {
      return _extends({}, DispatchDefaults, options);
    }

    // passed into each execution phase hook as first argument
    var depObj = _extends({}, deps, {
      cancelled$: cancelled$,
      ctx: {}, // for sharing data between hooks
      getState: getState,
      action: action
    });

    function shouldDispatch(act, useDispatch) {
      if (!act) {
        return false;
      }
      if (useDispatch === 'auto') {
        // dispatch on diff type
        return act.type !== action.type;
      }
      return useDispatch; // otherwise forced truthy/falsy
    }

    var AllowRejectNextDefaults = {
      useDispatch: 'auto'
    };

    function applyAllowRejectNextDefaults(options) {
      return _extends({}, AllowRejectNextDefaults, options);
    }

    function allow(act) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : AllowRejectNextDefaults;

      handleNextOrDispatch(true, act, options);
    }

    function reject(act) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : AllowRejectNextDefaults;

      handleNextOrDispatch(false, act, options);
    }

    function done() {
      dispatch$.complete();
    }

    function handleNextOrDispatch(shouldProcess, act, options) {
      var _applyAllowRejectNext = applyAllowRejectNextDefaults(options),
          useDispatch = _applyAllowRejectNext.useDispatch;

      if (shouldDispatch(act, useDispatch)) {
        monitor$.next({ action: action, dispAction: act, name: name, shouldProcess: shouldProcess, op: 'nextDisp' });
        interceptComplete = true;
        dispatch(act, { allowMore: true }); // will be completed later
        logicActionObs.complete(); // dispatched action, so no next(act)
      } else {
        // normal next
        if (act) {
          monitor$.next({ action: action, nextAction: act, name: name, shouldProcess: shouldProcess, op: 'next' });
        } else {
          // act is undefined, filtered
          monitor$.next({ action: action, name: name, shouldProcess: shouldProcess, op: 'filtered' });
          interceptComplete = true;
        }
        postIfDefinedOrComplete(act, logicActionObs);
      }

      // unless rejected, we will process even if allow/next dispatched
      if (shouldProcess) {
        // processing, was an accept
        // make this async to shorten call stack
        _Observable.Observable.of(true).observeOn(_asap.asap).subscribe(function () {
          // if action provided is empty, give process orig
          depObj.action = act || action;
          try {
            var retValue = processFn(depObj, dispatch, done);
            if (dispatchReturn) {
              // processOption.dispatchReturn true
              // returning undefined won't dispatch
              if (typeof retValue === 'undefined') {
                dispatch$.complete();
              } else {
                // defined return value, dispatch
                dispatch(retValue);
              }
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('unhandled exception in logic named: ' + name, err);
            // wrap in observable since might not be an error object
            dispatch(_Observable.Observable['throw'](err));
          }
        });
      } else {
        // not processing, must have been a reject
        dispatch$.complete();
      }
    }

    /* post if defined, then complete */
    function postIfDefinedOrComplete(act, act$) {
      if (act) {
        act$.next(act); // triggers call to middleware's next()
      }
      interceptComplete = true;
      act$.complete();
    }

    // start use of the action
    function start() {
      intercept(depObj, allow, reject);
    }

    start();
  }).takeUntil(cancel$).take(1);

  return logicAction$;
}