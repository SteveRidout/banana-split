"use strict";

var async = require('async'),
	md5 = require('MD5'),
	_ = require('underscore');

module.exports = function (config) {
	// config must contain document store, which must be a
	// [Mongoose model](http://mongoosejs.com/docs/api.html#model-js) or equivalent
	if (!config.db) {
		throw new Error('Banana requires a mongoDB database');
	}

	var models = {
		participant: require('./Participant')(config),
		experiment: require('./Experiment')(config),
		event: require('./Event')(config),
		result: require('./Result')(config)
	};

	var publicAPI = {};

	publicAPI.createExperiment = function (options, callback) {
		options = _.pick(options, [
			'name',
			'variations'
		]);
		
		async.waterfall([
			// Check for existing experiment
			function (callback) {
				models.experiment.findOne({
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
				models.experiment.create({
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
			'user',
			'ip',
			'variation'
		]);

		async.waterfall([
			// Fetch experiment
			function (callback) {
				models.experiment.findOne({
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
				models.participant.findOne({
					experiment: experiment.name,
					user: options.user
				}, function (err, participant) {
					callback(err, experiment, participant);
				});
			},
			// Choose variation for participant if necessary
			function (experiment, participant, callback) {
				var variation = participant && participant.variation;

				if (!variation) {
					if (options.variation) {
						if (!_.contains(_.pluck(experiment.variations, 'name'), options.variation)) {
							callback("Variation not valid: " + options.variation);
							return;
						}
						variation = options.variation;
					} else {
						// pick variation based on CRC32 of experiment + participant
						// gives equal weight to each of the options
						//
						// TODO: smart multi-armed bandit solution
						variation = experiment.variations[
							parseInt(md5(options.experiment + options.user).substring(0, 8), 16) %
							experiment.variations.length].name;
					}
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
					participant.save(function (err, participant) {
						callback(err, variation);
					});
				} else {
					models.participant.create({
						experiment: options.experiment,
						user: options.user,
						ip: options.ip,
						variation: variation
					}, function (err, participant) {
						callback(err, variation);
					});
				}
			}
		], function (err, variation) {
			callback(err, variation);
		});
	};

	publicAPI.listExperiments = function (callback) {
		models.experiment.find({}, "name", function (err, experiments) {
			callback(err, experiments);
		});
	};

	publicAPI.getResult = function (experimentName, eventName, callback) {
		async.waterfall([
			function (callback) {
				models.experiment.findOne({
					name: experimentName
				}, function (err, experiment) {
					callback(err, experiment);
				});
			},
			// Fetch all participants
			// TODO: check lastCalculated date first
			function (experiment, callback) {
				models.participant.find({
					experiment: experiment.name,
					optedOut: false
				}, function (err, participants) {
					callback(err, experiment, participants);
				});
			},
			// Fetch conversion status of each participant for the given event
			function (experiment, participants, callback) {
				async.each(participants, function (participant, cb) {
					models.event.findOne({
						name: eventName,
						user: participant.user
					}, function (err, event) {
						if (event) {
							participant.converted = true;
						}
						cb(err);
					});
				}, function (err) {
					callback(err, experiment, participants);
				});
			},
			function (experiment, participants, callback) {
				models.result.findOne({
					experiment: experiment.name,
					event: eventName
				}, function (err, result) {
					callback(err, result, experiment, participants);
				});
			},
			function (result, experiment, participants, callback) {
				if (!result) {
					models.result.create({
						experiment: experiment.name,
						event: eventName
					}, function (err, result) {
						callback(err, result, experiment, participants);
					});
				} else {
					callback(null, result, experiment, participants);
				}
			},
			function (result, experiment, participants, callback) {
				result.variations = _.map(experiment.variations, function (variation) {
					return {
						name: variation.name
					};
				});

				// reset all variation data
				_.each(result.variations, function (variation) {
					variation.participants = 0;
					variation.conversions = 0;
				});

				_.each(participants, function (participant) {
					var variation = _.findWhere(result.variations, {name: participant.variation});

					variation.participants++;
					if (participant.converted) {
						variation.conversions++;
					}
				});

				// calc conversion rates and 95% confidence intervals
				_.each(result.variations, function (variation) {
					variation.conversionRate = variation.conversions === 0 ? 0 :
						variation.conversions / variation.participants;

					if (variation.participants > 0) {
						// standard error formula: https://developer.amazon.com/sdk/ab-testing/reference/ab-math.html
						//
						// 95% confidence interval is +- 1.96 * standard error
						// http://en.wikipedia.org/wiki/Standard_error#Assumptions_and_usage
						variation.confidenceInterval = 1.96 * Math.sqrt(
							variation.conversionRate * (1 - variation.conversionRate) / variation.participants);
					}
				});

				result.lastCalculated = new Date();
				result.save(function (err, result) {
					if (err) throw err;
					callback(err, result);
				});
			}
		], function (err, result) {
			callback(err, result);
		});
	};

	publicAPI.trackEvent = function (options, callback) {
		models.event.create({
			name: options.event,
			user: options.user,
			ip: options.ip
		}, function (err, event) {
			if (callback) {
				callback(err);
			}
		});
	};

	publicAPI.optOut = function (options, callback) {
		// Deletes all participations for this user
		// (e.g. when a user is logged in and given an existing userID, opt-out the preUserID)
		models.participant.update({
					user: options.user
				}, {$set: {optedOut: true}}, {multi: true}, function (err, participants) {
			callback();
		});
	};

	return publicAPI;
};

