"use strict";

var async = require('async'),
	_ = require('underscore'),
	Random = require('random-js');

// use deterministic random number generator to avoid sporadic test failures
var random = new Random(Random.engines.mt19937().seed(1234));
var deterministicRandom = function () {
	return random.real(0, 1);
};

var mongoose = require('mongoose'),
	mockgoose = require('mockgoose');
mockgoose(mongoose);

var Banana = require('../lib/Banana');

var db,       // fake mockgoose database
	banana;   // banana instance

var roughlyEqual = function (a, b, relativeTolerance, absoluteTolerance) {
	relativeTolerance = relativeTolerance || 0.1;    // 10% default
	absoluteTolerance = absoluteTolerance || 0.0001; // default

	if (a === b) {
		return true;
	} else if (Math.abs(a - b) <= absoluteTolerance) {
		return true;
	} else if (Math.abs(a - b) / Math.min(Math.abs(a), Math.abs(b)) <= relativeTolerance) {
		return true;
	} else {
		return false;
	}
};

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
		db = mongoose.createConnection("test-banana");
		db.on('error', console.error.bind(console, 'connection error:'));
		db.once('open', function () {
			banana = Banana({db: db, mongoose: mongoose, unitTest: true});
			banana.setRandomFunction(deterministicRandom);
			callback();
		});
	}
};

exports.tearDown = function (callback) {
	banana.excludeIPs([]);
	mockgoose.reset();
	callback();
};

exports.roughlyEqual = function (test) {
	test.equal(roughlyEqual(1, 1.05), true);
	test.equal(roughlyEqual(1, 1.09999), true);
	test.equal(roughlyEqual(1, 1.11), false);
	test.equal(roughlyEqual(1, 1.11, 0.2), true);
	test.equal(roughlyEqual(20, 19), true);
	test.equal(roughlyEqual(20, 20), true);
	test.equal(roughlyEqual(-20, -21), true);
	test.equal(roughlyEqual(-20, -23), false);

	// not relatively close, but absolutely close
	test.equal(roughlyEqual(0.00001, 0.00002), true);
	test.done();
};

exports.initExperiment = function (test) {
	async.waterfall([
		// check 0 experiements
		function (callback) {
			banana.listExperiments(function (err, experiments) {
				test.equal(experiments.length, 0);
				callback();
			});
		},
		// create experiment
		function (callback) {
			banana.initExperiment({
				name: 'colors',
				variations: ['red', 'blue']
			}, function (err) {
				test.ok(!err);
				callback();
			});
		},
		// check experiement
		function (callback) {
			banana.listExperiments(function (err, experiments) {
				test.equal(experiments.length, 1);
				test.equal(experiments[0].name, 'colors');

				test.ok(!experiments[0].events);
				callback();
			});
		},
		// add extra variation by re-initializing
		// (this will update the existing 'colors' experiment)
		function (callback) {
			banana.initExperiment({
				name: 'colors',
				variations: ['red', 'blue', 'green'],
				events: ['signup', 'upgrade']
			}, function (err) {
				test.ok(!err);
				callback();
			});
		},
		// check still only 1 experiement
		function (callback) {
			banana.listExperiments(function (err, experiments) {
				test.equal(experiments.length, 1);
				test.equal(experiments[0].name, 'colors');

				callback();
			});
		},
		// check events
		function (callback) {
			banana.getExperiment('colors', function (err, experiment) {
				test.equal(experiment.events.length, 2);
				callback();
			});
		},
		// add new experiment
		function (callback) {
			banana.initExperiment({
				name: 'sizes',
				variations: ['small', 'large', 'control', 'massive']
			}, function (err) {
				callback();
			});
		},
		// check 2 experiements
		function (callback) {
			banana.listExperiments(function (err, experiments) {
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
			banana.initExperiment({
				name: 'exp1',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				callback(err);
			});
		},
		// participate
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user1'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err, variationName);
			});
		},
		// re-participate multiple times
		function (variationName, callback) {
			// subsequent participate calls by same participant...
			async.each(_.range(20), function (index, callback) {
				banana.participate({
					experiment: 'exp1',
					user: 'user1',
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
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				test.equal(result.experiment, 'exp1');
				test.equal(result.variations.length, 3);

				var variation = _.findWhere(result.variations, {name: variationName});
				test.equal(variation.participants,    1);
				test.equal(variation.conversions,     0);
				test.equal(variation.conversionRate,  0);
				callback(null, variationName);
			});
		},
		// convert
		function (variationName, callback) {
			banana.trackEvent({
				event: 'event1',
				user: 'user1'
			}, function (err) {
				callback(err, variationName);
			});
		},
		function (variationName, callback) {
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				var variation = _.findWhere(result.variations, {name: variationName});
				test.equal(variation.participants,       1);
				test.equal(variation.conversions,        1);
				test.equal(variation.conversionRate,     1);
				callback(err, variationName);
			});
		},
		// multiple event count condition
		function (variationName, callback) {
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0, count: 5}, function (err, result) {
				var variation = _.findWhere(result.variations, {name: variationName});
				test.equal(variation.participants,       1);
				test.equal(variation.conversions,        0);
				test.equal(variation.conversionRate,     0);
				callback(err, variationName);
			});
		},
		// add 4 more events...
		function (variationName, callback) {
			async.each(_.range(4), function (number, callback) {
				banana.trackEvent({
					event: 'event1',
					user: 'user1'
				}, function (err) {
					callback(err);
				});
			}, function (err) {
				callback(err, variationName);
			});
		},
		// multiple event count condition
		function (variationName, callback) {
			banana.getResult('exp1', 'event1:5', {cacheExpiryTime: 0}, function (err, result) {
				var variation = _.findWhere(result.variations, {name: variationName});
				test.equal(variation.participants,       1);
				test.equal(variation.conversions,        1);
				test.equal(variation.conversionRate,     1);
				callback();
			});
		},
		// opt out
		function (callback) {
			banana.optOut({
				user: 'user1'
			}, function (err) {
				callback(err);
			});
		},
		function (callback) {
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, experiment) {
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

exports.excludeIPs = function (test) {
	async.waterfall([
		// create experiment
		function (callback) {
			banana.initExperiment({
				name: 'exp1',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				callback(err);
			});
		},
		// participate user1 from ip1
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user1',
				ip: 'ip1'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		// participate user2 from ip2
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user2',
				ip: 'ip2'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		function (callback) {
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				var totalParticipants = _.reduce(result.variations, function (memo, variation) {
					return memo + variation.participants;
				}, 0);

				test.equal(totalParticipants, 2);
				test.equal(totalParticipants, result.totalParticipants);
				callback(null);
			});
		},
		// exclude some ip addresses and try again
		function (callback) {
			banana.excludeIPs(['ip2']);
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				var totalParticipants = _.reduce(result.variations, function (memo, variation) {
					return memo + variation.participants;
				}, 0);

				test.equal(totalParticipants, 1);
				callback(null);
			});
		},
		function (callback) {
			banana.excludeIPs(['ip1', 'ip2']);
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				var totalParticipants = _.reduce(result.variations, function (memo, variation) {
					return memo + variation.participants;
				}, 0);

				test.equal(totalParticipants, 0);
				callback(null);
			});
		}
	], function (err) {
		test.equal(err, null, err);
		test.done();
	});
};
exports.optOutIfNotConverted = function (test) {
	async.waterfall([
		// create experiment
		function (callback) {
			banana.initExperiment({
				name: 'colors',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				test.ok(!err, err);
				callback();
			});
		},
		// participate
		function (callback) {
			banana.participate({
				experiment: 'colors',
				user: 'user1',
			}, function (err, variationName) {
				test.ok(!err, err);
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		// check there's one participant
		function (callback) {
			banana.getResult('colors', 'event1', {cacheExpiryTime: 0}, function (err, experiment) {
				test.ok(!err, err);
				var totalParticipants = 0;
				_.each(experiment.variations, function (variation) {
					totalParticipants += variation.participants;
				});
				test.equal(totalParticipants, 1);
				callback();
			});
		},
		// opt out
		function (callback) {
			banana.optOut({
				user: 'user1'
			}, function (err) {
				callback(err);
			});
		},
		// check there's no participants
		function (callback) {
			banana.getResult('colors', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				var totalParticipants = 0;
				_.each(result.variations, function (variation) {
					totalParticipants += variation.participants;
				});
				test.equal(totalParticipants, 0);
				callback(err);
			});
		},
		// participate again
		function (callback) {
			banana.participate({
				experiment: 'colors',
				user: 'user2'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		// convert
		function (callback) {
			banana.trackEvent({
				event: 'event1',
				user: 'user2',
			}, function (err) {
				callback(err);
			});
		},
		// opt out
		function (callback) {
			banana.optOut({
				user: 'user2',
			}, function (err) {
				callback(err);
			});
		},
		// should be 0 participants
		function (callback) {
			banana.getResult('colors', 'event1', {cacheExpiryTime: 0}, function (err, experiment) {
				var totalParticipants = 0;
				_.each(experiment.variations, function (variation) {
					totalParticipants += variation.participants;
				});
				test.equal(totalParticipants, 0);
				callback();
			});
		}
	], function (err) {
		if (err) throw err;
		test.done();
	});
};

exports.manyParticipants = function (test) {
	// This test simulates many participants with different conversion rates
	// and checks whether the results match
	
	// Note - conversion rates only works to granularity of 10%
	var EXPERIMENTS = [
		{
			name: 'colors',
			variations: [
				{
					name: 'red',
					conversionRate: 0.7
				},
				{
					name: 'blue',
					conversionRate: 0.4
				},
				{
					name: 'green',
					conversionRate: 0.3
				}
			]
		},
		{
			name: 'sizes',
			variations: [
				{
					name: 'small',
					conversionRate: 0.6
				},
				{
					name: 'large',
					conversionRate: 0.3
				}
			]
		}
	];
	var TOTAL_PARTICIPANTS = 100;
	async.eachSeries(EXPERIMENTS, function (experimentSpec, callback) {
		async.waterfall([
			// create experiments
			function (callback) {
				banana.initExperiment({
					name: experimentSpec.name,
					variations: _.pluck(experimentSpec.variations, 'name')
				}, function (err) {
					callback(err);
				});
			},
			// add lots of participants
			function (callback) {
				var participants = [];
				var variationCounts = {};
				
				_.each(experimentSpec.variations, function (variation) {
					variationCounts[variation.name] = 0;
				});

				async.each(_.range(TOTAL_PARTICIPANTS), function (index, callback) {
					var userID = "user" + index;

					banana.participate({
						experiment: experimentSpec.name,
						user: userID,
					}, function (err, variationName) {
						variationCounts[variationName]++;
						participants.push({
							user: userID,
							variation: variationName
						});
						callback(err, variationName);
					});
				}, function (err) {
					callback(err, participants, variationCounts);
				});
			},
			// check the variation counts, which should be a roughly equal split
			function (participants, variationCounts, callback) {
				banana.getResult(experimentSpec.name, 'event-' + experimentSpec.name, {cacheExpiryTime: 0}, function (err, result) {
					_.each(result.variations, function (variation) {
						test.ok(roughlyEqual(variation.participants, TOTAL_PARTICIPANTS / result.variations.length, 0.4, 0.1),
							"roughly equal split: " + variation.name + ", " + variation.participants);
					});
					callback(err, participants, variationCounts);
				});
			},
			// simulate the conversion rate
			function (participants, variationCounts, callback) {
				var converted = {};
				_.each(experimentSpec.variations, function (variation) {
					converted[variation.name] = 0;
				});
				async.eachSeries(_.range(participants.length), function (index, callback) {
					var participant = participants[index];
					var variationSpec = _.findWhere(experimentSpec.variations, {name: participant.variation});

					// convert based on experimentSpec rates
					if (converted[variationSpec.name] < variationSpec.conversionRate * variationCounts[variationSpec.name]) {
						banana.trackEvent({
							event: 'event-' + experimentSpec.name,
							user: participant.user
						}, function (err) {
							converted[variationSpec.name]++;
							callback(err);
						});
					} else {
						callback();
					}
				}, function (err) {
					callback(err, participants);
				});
			},
			// check the conversion rates are correct (allowing for rounding error)
			function (participants, callback) {
				banana.getResult(experimentSpec.name, 'event-' + experimentSpec.name, {cacheExpiryTime: 0}, function (err, result) {
					// check total participants number
					var totalParticipants = _.reduce(_.pluck(result.variations, 'participants'), function (a, m) {return a + m;}, 0);
					test.equal(totalParticipants, TOTAL_PARTICIPANTS);

					_.each(experimentSpec.variations, function (variationSpec) {
						var variation = _.findWhere(result.variations, {name: variationSpec.name});

						test.equal(variation.name, variationSpec.name);
						test.ok(roughlyEqual(variation.conversionRate, variationSpec.conversionRate, 0.2),
							experimentSpec.name + ", " + variationSpec.name + ": " +
							variation.conversionRate + " (actual), " + variationSpec.conversionRate + " (expected)");
						
						// just check a valid confidence interval exists
						test.ok(variation.confidenceInterval > 0);
						test.ok(variation.confidenceInterval < 1);
					});
					callback(err, participants);
				});
			},
			// opt out 50% of participants
			function (participants, callback) {
				async.each(participants.slice(0, participants.length / 2), function (participant, callback) {
					banana.optOut({
						user: participant.user
					}, function (err) {
						callback(err);
					});
				}, function (err) {
					callback(err);
				});
			},
			// check total has decreased to 50%
			function (callback) {
				banana.getResult(experimentSpec.name, 'event-' + experimentSpec.name, {cacheExpiryTime: 0}, function (err, experiment) {
					test.equal(
						_.reduce(_.pluck(experiment.variations, 'participants'), function (a, m) {return a + m;}, 0),
						TOTAL_PARTICIPANTS / 2);
					callback();
				});
			}
		], function (err) {
			callback(err);
		});
	}, function (err) {
		test.ok(!err, err);
		test.done();
	});
};

exports.testResultCaching = function (test) {
	async.waterfall([
		// create experiment
		function (callback) {
			banana.initExperiment({
				name: 'exp1',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				callback(err);
			});
		},
		// participate user1 from ip1
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user1',
				ip: 'ip1'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		function (callback) {
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				var totalParticipants = _.reduce(result.variations, function (memo, variation) {
					return memo + variation.participants;
				}, 0);

				test.equal(totalParticipants, 1);
				callback(null);
			});
		},
		// participate user2 from ip2
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user2',
				ip: 'ip2'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		// should still be only 1 participant in result due to caching
		function (callback) {
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 3600 * 1000}, function (err, result) {
				test.ok(!err, err);

				var totalParticipants = _.reduce(result.variations, function (memo, variation) {
					return memo + variation.participants;
				}, 0);

				test.equal(totalParticipants, 1);
				callback(null);
			});
		},
		// without caching - should be 2 participants...
		function (callback) {
			banana.getResult('exp1', 'event1', {cacheExpiryTime: 0}, function (err, result) {
				test.ok(!err, err);

				var totalParticipants = _.reduce(result.variations, function (memo, variation) {
					return memo + variation.participants;
				}, 0);

				test.equal(totalParticipants, 2);
				callback(null);
			});
		}
	], function (err) {
		test.ok(!err, err);
		test.done();
	});
};

exports.testGetVariation = function (test) {
	async.waterfall([
		// create experiment
		function (callback) {
			banana.initExperiment({
				name: 'exp1',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				callback(err);
			});
		},
		// participate user1 from ip1
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user1',
				ip: 'ip1'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err, variationName);
			});
		},
		// get variation for user 1
		function (variationName, callback) {
			banana.getVariation({
				experiment: 'exp1',
				user: 'user1'
			}, function (err, fetchedVariationName) {
				test.equal(fetchedVariationName, variationName);
				callback();
			});
		},
		// get variation for unknown user
		function (callback) {
			banana.getVariation({
				experiment: 'exp1',
				user: 'user2'
			}, function (err, fetchedVariationName) {
				test.equal(fetchedVariationName, null);
				callback();
			});
		}
	], function (err) {
		test.ok(!err, err);
		test.done();
	});
};

exports.testMultipleIPUsers = function (test) {
	async.series([
		// create experiment
		function (callback) {
			banana.initExperiment({
				name: 'exp1',
				variations: ['red', 'blue', 'green']
			}, function (err) {
				callback(err);
			});
		},
		// participate user1 from ip1
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user1',
				ip: 'ip1'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		// participate user2, also from ip1
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user2',
				ip: 'ip1'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		// get result
		function (callback) {
			banana.getResult('exp1', 'no-event', {cacheExpiryTime: 0}, function (err, result) {
				test.equal(result.totalParticipants, 1);
				callback(err);
			});
		},
		// participate user3, from different ip: ip2
		function (callback) {
			banana.participate({
				experiment: 'exp1',
				user: 'user3',
				ip: 'ip2'
			}, function (err, variationName) {
				test.ok(_.contains(['red', 'blue', 'green'], variationName));
				callback(err);
			});
		},
		// get result
		function (callback) {
			banana.getResult('exp1', 'no-event', {cacheExpiryTime: 0}, function (err, result) {
				test.equal(result.totalParticipants, 2);
				callback(err);
			});
		}
	], function (err) {
		test.ok(!err, err);
		test.done();
	});
};

exports.testWeightedVariations = function (test) {
	async.series([
		// create experiment
		function (callback) {
			banana.initExperiment({
				name: 'exp1',
				variations: [
					{
						name: 'red',
			   			weight: 5
					},
					{
						name: 'green',
						weight: 4
					},
					{
						name: 'blue',
						weight: 1
					}
				]
			}, function (err) {
				callback(err);
			});
		},
		// add lots of participants
		function (callback) {
			var variationCounts = {
				red: 0,
				green: 0,
				blue: 0
			};
			
			async.each(_.range(1000), function (index, callback) {
				banana.participate({
					experiment: 'exp1',
					user: 'user-' + index
				}, function (err, variationName) {
					variationCounts[variationName]++;
					callback(err, variationName);
				});
			}, function (err) {
				callback(err);
			});
		},
		// check the variation counts, which should be roughly proportional to the weights
		function (callback) {
			banana.getResult('exp1', 'no-event', {cacheExpiryTime: 0}, function (err, result) {
				test.ok(roughlyEqual(_.findWhere(result.variations, {name: 'red'}).participants, 500));
				test.ok(roughlyEqual(_.findWhere(result.variations, {name: 'green'}).participants, 400));
				test.ok(roughlyEqual(_.findWhere(result.variations, {name: 'blue'}).participants, 100));
				callback();
			});
		}
	], function (err) {
		test.ok(!err, err);
		test.done();
	});
};

