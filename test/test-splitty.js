"use strict";

var async = require('async'),
	_ = require('underscore');

var mongoose = require('mongoose'),
	mockgoose = require('mockgoose');
mockgoose(mongoose);

var Splitty = require('../lib/Splitty');

var db,       // fake mockgoose database
	splitty;  // splitty instance

// to catch errors that happen in an async function called from a test
// see https://github.com/caolan/nodeunit/pull/245
process.on('uncaughtException', function (err) {
	console.error(err.stack);
	process.exit(1);
});

exports.setUp = function (callback) {
	if (db) {
		callback();
	} else {
		db = mongoose.createConnection("test-splitty");
		db.on('error', console.error.bind(console, 'connection error:'));
		db.once('open', function () {
			console.log('--- setting up ---');
			splitty = Splitty({db: db});
			callback();
		});
	}
};

exports.tearDown = function (callback) {
//	db.close(function () {
		mockgoose.reset();
		console.log('--- teared down ---');
		callback();
//	});
};

exports.createExperiment = function (test) {
	async.waterfall([
		// check 0 experiements
		function (callback) {
			splitty.listExperiments(function (err, experiments) {
				test.equal(experiments.length, 0);
				callback();
			});
		},
		// create experiment
		function (callback) {
			splitty.createExperiment({
				name: 'colors',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				test.ok(!err);
				callback();
			});
		},
		// check experiement
		function (callback) {
			splitty.listExperiments(function (err, experiments) {
				test.equal(experiments.length, 1);
				test.equal(experiments[0].name, 'colors');
				callback();
			});
		},
		// add identical experiment
		function (callback) {
			splitty.createExperiment({
				name: 'colors',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				test.ok(err);
				callback();
			});
		},
		// check still only 1 experiement
		function (callback) {
			splitty.listExperiments(function (err, experiments) {
				test.equal(experiments.length, 1);
				test.equal(experiments[0].name, 'colors');
				callback();
			});
		},
		// add new experiment
		function (callback) {
			splitty.createExperiment({
				name: 'sizes',
				variations: ['small', 'large', 'control', 'massive']
			}, function (err) {
				test.ok(!err);
				callback();
			});
		},
		// check 2 experiements
		function (callback) {
			splitty.listExperiments(function (err, experiments) {
				test.equal(experiments.length, 2);

				var names = _.pluck(experiments, 'name');
				test.ok(_.contains(names, 'colors'));
				test.ok(_.contains(names, 'sizes'));
				callback();
			});
		}
	], function (err) {
		if (err) throw err;
		test.done();
	});
};

exports.oneParticipant = function (test) {
	async.waterfall([
		// create experiment
		function (callback) {
			splitty.createExperiment({
				name: 'exp1',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				test.ok(!err);
				callback();
			});
		},
		// participate
		function (callback) {
			splitty.participate({
				experiment: 'exp1',
				participant: 'userID',
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err, variationName);
			});
		},
		// re-participate multiple times
		function (variationName, callback) {
			console.log('2');
			// subsequent participate calls by same participant...
			async.each(_.range(20), function (index, callback) {
				splitty.participate({
					experiment: 'exp1',
					participant: 'userID',
					alternatives: ['red', 'blue', 'green']
				}, function (err, newVariation) {
					// ...should all return the same variation
					test.equal(newVariation, variationName);
					callback(err);
				});
			}, function (err) {
				callback(err, variationName);
			});
		},
		function (variationName, callback) {
			console.log('3');
			splitty.experimentInfo('exp1', function (err, experiment) {
				test.equal(experiment.name, 'exp1');
				test.equal(experiment.variations.length, 3);

				var variation = _.findWhere(experiment.variations, {name: variationName});
				test.equal(variation.participants,    1);
				test.equal(variation.conversions,     0);
				test.equal(variation.conversionRate,  0);
				callback(null, variationName);
			});
		},
		// convert
		function (variationName, callback) {
			splitty.convert({
				experiment: 'exp1',
				participant: 'userID'
			}, function (err) {
				callback(err, variationName);
			});
		},
		function (variationName, callback) {
			splitty.experimentInfo('exp1', function (err, experiment) {
				var variation = _.findWhere(experiment.variations, {name: variationName});
				test.equal(variation.participants,    1);
				test.equal(variation.conversions,     1);
				test.equal(variation.conversionRate,  1);
				callback();
			});
		},
		// opt out
		function (callback) {
			splitty.optOut({
				experiment: 'exp1',
				participant: 'userID'
			}, function (err) {
				callback(err);
			});
		},
		function (callback) {
			splitty.experimentInfo('exp1', function (err, experiment) {
				_.each(experiment.variations, function (variation) {
					test.equal(variation.participants,   0);
					test.equal(variation.conversions,    0);
					test.equal(variation.conversionRate, 0);
				});
				callback();
			});
		}
	], function (err) {
		test.equal(err, null, err);
		test.done();
	});
};

console.log('end of test');

