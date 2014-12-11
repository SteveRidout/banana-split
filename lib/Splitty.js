"use strict";

// Splitty, a minimal split testing library using MongoDB for storage
//
// Use it on your node.js web server to:
//
// 1. Create experiments with multiple variations
// 2. Assign users to a specific variation
// 3. Record each conversion
// 4. Get conversion rates and confidence intervals for each variation

var async = require('async'),
	crc32 = require('crc32'),
	_ = require('underscore'),
	ParticipationFactory = require('./Participation'),
	ExperimentFactory = require('./Experiment');

module.exports = function (config) {
	// config must contain document store, which must be a
	// [Mongoose model](http://mongoosejs.com/docs/api.html#model-js) or equivalent
	if (!config.db) {
		throw new Error('splitty requires a mongoDB database');
	}

	var Participation = ParticipationFactory(config.db);
	var Experiment = ExperimentFactory(config.db);

	var publicAPI = {};

	publicAPI.createExperiment = function (options, callback) {
		options = _.pick(options, [
			'name',
			'variations'
		]);
		
		async.waterfall([
			// Check for existing experiment
			function (callback) {
				Experiment.findOne({
					name: options.name
				}, function (err, experiment) {
					if (err) {
						callback(err);
					} else if (experiment) {
						callback("Experiment already exists with this name");
					} else {
						callback();
					}
				});
			},
			// Create new experiment
			function (callback) {
				Experiment.create({
					name: options.name,
					variations: _.map(options.variations, function (variationName) {
						return {
							name: variationName
						};
					})
				}, function (err) {
						callback(err);
					}
				);
			}
		], function (err) {
			callback(err);
		});
	};

	publicAPI.participate = function (options, callback) {
		options = _.pick(options, [
			'experiment',
			'participant'
		]);

		async.waterfall([
			// Fetch experiment
			function (callback) {
				Experiment.findOne({
					name: options.experiment,
				}, function (err, experiment) {
					if (err) {
						callback(err);
					} else if (!experiment) {
						callback("No matching experiment found, please create one first");
					} else {
						callback(err, experiment);
					}
				});
			},
			// Fetch participant
			function (experiment, callback) {
				Participation.findOne({
					experiment: experiment.name,
					participant: options.participant
				}, function (err, participant) {
					callback(err, experiment, participant);
				});
			},
			// Choose variation for participant if necessary
			function (experiment, participant, callback) {
				var variation = participant && participant.variation;

				if (!variation) {
					// pick variation based on CRC32 of experiment + participant
					// gives equal weight to each of the options
					variation = experiment.variations[
						parseInt(crc32(options.experiment + options.participant), 16) % experiment.variations.length].name;
				}
				callback(null, participant, variation);
			},
			// Create or update participant as neccessary
			function (participant, variation, callback) {
				if (participant && participant.variation) {
					// done
					callback(null, variation);
				} else if (participant) {
					participant.variation = variation;
					participant.save(function (err, participation) {
						callback(err, variation);
					});
				} else {
					Participation.create({
						experiment: options.experiment,
						participant: options.participant,
						variation: variation
					}, function (err, participation) {
						callback(err, variation);
					});
				}
			}
		], function (err, variation) {
			callback(err, variation);
		});
	};

	publicAPI.listExperiments = function (callback) {
		Experiment.find({}, "name", function (err, experiments) {
			callback(err, experiments);
		});
	};

	publicAPI.experimentInfo = function (experimentName, callback) {
		async.waterfall([
			function (callback) {
				Experiment.findOne({
					name: experimentName
				}, function (err, experiment) {
					callback(err, experiment);
				});
			},
			// Fetch all participants
			// TODO: check lastCalculated date first
			function (experiment, callback) {
				Participation.find({
					experiment: experiment.name
				}, function (err, participants) {
					callback(err, experiment, participants);
				});
			},
			function (experiment, participants, callback) {
				var variations = {};

				// reset all variation data
				_.each(experiment.variations, function (variation) {
					variation.participants = 0;
					variation.conversions = 0;
				});

				_.each(participants, function (participant) {
					var variation = _.findWhere(experiment.variations, {name: participant.variation});

					variation.participants++;
					if (participant.converted) {
						variation.conversions++;
					}
				});

				// calc conversion rates and 95% confidence intervals
				_.each(experiment.variations, function (variation) {
					variation.conversionRate = variation.conversions === 0 ? 0 : variation.conversions / variation.participants;

					// standard error formula: https://developer.amazon.com/sdk/ab-testing/reference/ab-math.html
					//
					// 95% confidence interval is +- 1.96 * standard error
					// http://en.wikipedia.org/wiki/Standard_error#Assumptions_and_usage
					variation.confidenceInterval = 1.96 * Math.sqrt(
						variation.conversionRate * (1 - variation.conversionRate) / variation.participants);
				});

				experiment.lastCalculated = new Date();
				experiment.save(function (err, experiment) {
					callback(err, experiment);
				});
			}
		], function (err, experiment) {
			callback(err, experiment);
		});
	};

	publicAPI.convert = function (options, callback) {
		Participation.findOneAndUpdate({
			experiment: options.experiment,
			participant: options.participant
		}, {
			$set: {converted: true}
		}, {
			upsert: true
		}, function (err, participant) {
			callback(err);
		});
	};

	publicAPI.optOut = function (options, callback) {
		Participation.findOneAndRemove({
			experiment: options.experiment,
			participant: options.participant
		}, function (err, removed) {
			callback(err);
		});
	};

	return publicAPI;
};

