"use strict";

var async = require('async'),
  _ = require('underscore'),
  randomWeightedChoice = require('random-weighted-choice');

module.exports = function(config) {
  // config must contain document store, which must be a
  // [Mongoose model](http://mongoosejs.com/docs/api.html#model-js) or equivalent
  if (!config.db) {
    throw new Error('Banana requires a mongoDB database');
  }

  var ObjectID = config.mongoose.mongo.ObjectID,
    models = {
      participant: require('./Participant')(config),
      experiment: require('./Experiment')(config),
      event: require('./Event')(config),
      result: require('./Result')(config)
    },
    publicAPI = {},
    randomFunction;

  publicAPI.setRandomFunction = function(_randomFunction) {
    randomFunction = _randomFunction;
  };

  publicAPI.excludeIPs = function(ips) {
    config.excludeIPs = ips;
  };

  // Creates new experiment, or updates it if it already exists
  publicAPI.initExperiment = function(options, callback) {
    options = _.pick(options, [
      'name',
      'variations',
      'events'
    ]);

    var variations,
      events;

    if (typeof(options.variations[0]) === "object") {
      variations = options.variations;
    } else {
      variations = _.map(options.variations, function(variationName) {
          return {
            name: variationName
          };
        });
    }

    if (options.events) {
      if (typeof(options.events[0]) === "object") {
        events = options.events;
      } else {
        events = _.map(options.events, function(eventName) {
            return {
              name: eventName
            };
          });
      }
    }

    models.experiment.update({
      name: options.name
    }, {
      $set: {
        variations: variations,
        events: events
      }
    }, {
      upsert: true
    }, function(err) {
      callback(err);
    });
  };

  // Returns the variation of an existing participant
  publicAPI.getVariation = function(options, callback) {
    options = _.pick(options, [
      'experiment',
      'user'
    ]);

    async.waterfall([
      // Fetch experiment
      function(callback) {
        models.experiment.findOne({
          name: options.experiment,
        }, function(err, experiment) {
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
      function(experiment, callback) {
        models.participant.findOne({
          experiment: experiment.name,
          user: options.user
        }, function(err, participant) {
          callback(err, participant && participant.variation);
        });
      }
    ], callback);
  };

  publicAPI.participate = function(options, callback) {
    options = _.pick(options, [
      'experiment',
      'user',
      'ip',
      'variation'
    ]);

    async.waterfall([
      // Fetch experiment
      function(callback) {
        models.experiment.findOne({
          name: options.experiment,
        }, function(err, experiment) {
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
      function(experiment, callback) {
        models.participant.findOne({
          experiment: experiment.name,
          user: options.user
        }, function(err, participant) {
          callback(err, experiment, participant);
        });
      },
      // Choose variation for participant if necessary
      function(experiment, participant, callback) {
        var variation = participant && participant.variation;

        if (!variation) {
          if (options.variation) {
            if (!_.contains(_.pluck(experiment.variations, 'name'), options.variation)) {
              callback("Variation not valid: " + options.variation);
              return;
            }
            variation = options.variation;
          } else {
            var table = [];

            _.each(experiment.variations, function(variation) {
              table.push({
                id: variation.name,
                weight: variation.weight || 1
              });
            });

            variation = randomWeightedChoice(table, undefined, randomFunction);
          }
        }
        callback(null, participant, variation);
      },
      // Create or update participant as neccessary
      function(participant, variation, callback) {
        if (participant && participant.variation) {
          // done
          callback(null, variation);
        } else if (participant) {
          participant.variation = variation;
          participant.save(function(err, participant) {
            callback(err, variation);
          });
        } else {
          models.participant.create({
            experiment: options.experiment,
            user: options.user,
            ip: options.ip,
            variation: variation
          }, function(err, participant) {
            callback(err, variation);
          });
        }
      }
    ], function(err, variation) {
      callback(err, variation);
    });
  };

  publicAPI.listExperiments = function(callback) {
    models.experiment.find({}, "name startDate endDate", function(err, experiments) {
      callback(err, experiments);
    });
  };

  publicAPI.getExperiment = function(experimentName, callback) {
    models.experiment.findOne({name: experimentName}, function(err, experiment) {
      callback(err, experiment);
    });
  };

  publicAPI.getResult = function(experimentName, eventName, options /* optional */, callback) {
    // default args
    if (!callback) {
      callback = options;
      options = {};
    }
    options = _.defaults(options, {
      cacheExpiryTime: 0
    });

    var eventSplit = eventName.split(':');
    var event = eventSplit[0];
    var eventCount = eventSplit[1];

    async.waterfall([
      function(callback) {
        models.experiment.findOne({
          name: experimentName
        }, function(err, experiment) {
          callback(err, experiment);
        });
      },
      function(experiment, callback) {
        models.result.findOne({
          experiment: experiment.name,
          event: eventName
        }, function(err, result) {
          callback(err, result, experiment);
        });
      },
      function(result, experiment, callback) {
        if (!result) {
          models.result.create({
            experiment: experiment.name,
            event: eventName
          }, function(err, result) {
            callback(err, result, experiment);
          });
        } else {
          // used previous result if generated within the last hour
          if (result.lastCalculated > new Date(new Date().getTime() - options.cacheExpiryTime)) {
            callback("finished", result);
            return;
          }
          callback(null, result, experiment);
        }
      },
      // Fetch all participants
      // TODO: check lastCalculated date first
      function(result, experiment, callback) {
        result.startDate = experiment.startDate || experiment._id.getTimestamp();

        var query = {
            experiment: experiment.name,
            optedOut: false,
            _id: {$gt: ObjectID(result.startDate.getTime() / 1000 - 1)}
          };

        if (config.excludeIPs) {
          query.ip = {$nin: config.excludeIPs};
        }

        models.participant.find(query).sort({_id: 1}).exec(function(err, participants) {
          // filter participants to only include the first participant from each IP address
          var ips = {};
          participants = _.filter(participants, function(participant) {
            if (participant.ip) {
              if (ips[participant.ip]) {
                // ignore this participant
                return false;
              }
              // include participant and add to ip filter
              ips[participant.ip] = true;
            }
            return true;
          });
          callback(err, result, experiment, participants);
        });
      },
      // Fetch conversion status of each participant for the given event
      function(result, experiment, participants, callback) {
        async.eachLimit(participants, 5, function(participant, cb) {
          if (eventCount) {
            models.event.count({
              name: event,
              user: participant.user,
              _id: {$gt: participant._id}
            }, function(err, count) {
              if (count >= eventCount) {
                participant.converted = true;
              }
              cb(err);
            });
          } else {
            models.event.findOne({
              name: event,
              user: participant.user,
              _id: {$gt: participant._id}
            }, function(err, event) {
              if (event) {
                participant.converted = true;
              }
              cb(err);
            });
          }
        }, function(err) {
          callback(err, result, experiment, participants);
        });
      },
      function(result, experiment, participants, callback) {
        result.variations = _.map(experiment.variations, function(variation) {
          return {
            name: variation.name
          };
        });

        // reset all variation data
        _.each(result.variations, function(variation) {
          variation.participants = 0;
          variation.conversions = 0;
        });

        _.each(participants, function(participant) {
          var variation = _.findWhere(result.variations, {name: participant.variation});

          if (variation) {
            variation.participants++;
            if (participant.converted) {
              variation.conversions++;
            }
          }
        });

        result.totalParticipants = 0;
        result.totalConversions = 0;

        // calc conversion rates and 95% confidence intervals
        _.each(result.variations, function(variation) {
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

          result.totalParticipants += variation.participants;
          result.totalConversions  += variation.conversions;
        });

        result.lastCalculated = new Date();
        result.save(function(err, result) {
          callback(err, result);
        });
      }
    ], function(statusOrError, result) {
      if (statusOrError === "finished") {
        callback(null, result);
      } else {
        callback(statusOrError, result);
      }
    });
  };

  publicAPI.trackEvent = function(options, callback) {
    models.event.create({
      name: options.event,
      user: options.user,
      ip: options.ip
    }, function(err, event) {
      if (callback) {
        callback(err);
      }
    });
  };

  publicAPI.optOut = function(options, callback) {
    // Deletes all participations for this user
    // (e.g. when a user is logged in and given an existing userID, opt-out the preUserID)
    models.participant.update({
          user: options.user
        }, {$set: {optedOut: true}}, {multi: true}, function(err, participants) {
      callback();
    });
  };

  return publicAPI;
};

