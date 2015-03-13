"use strict";

var async = require('async'),
  _ = require('underscore'),
  randomWeightedChoice = require('random-weighted-choice');

var utils = require('./utils');

module.exports = function (config) {
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
      result: require('./Result')(config),
    },
    publicAPI = {},
    randomFunction;

  models.dayEventUserList = require('./DayEventUserList')(_.extend({}, config, {eventModel: models.event}));
  models.dayParticipantList = require('./DayParticipantList')(_.extend({}, config, {participantModel: models.participant}));
  models.cumulativeConversions = require('./CumulativeConversions')(config);

  publicAPI.setRandomFunction = function (_randomFunction) {
    randomFunction = _randomFunction;
  };

  // note: if changed, need to update all stored data
  publicAPI.excludeIPs = function (ips) {
    config.excludeIPs = ips;
    models.dayParticipantList.excludeIPs(ips);
  };

  // Creates new experiment, or updates it if it already exists
  publicAPI.initExperiment = function (options, callback) {
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
      variations = _.map(options.variations, function (variationName) {
          return {
            name: variationName
          };
        });
    }

    if (options.events) {
      if (typeof(options.events[0]) === "object") {
        events = options.events;
      } else {
        events = _.map(options.events, function (eventName) {
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
    }, function (err) {
      callback(err);
    });
  };

  // Returns the variation of an existing participant
  publicAPI.getVariation = function (options, callback) {
    options = _.pick(options, [
      'experiment',
      'user'
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
          callback(err, participant && participant.variation);
        });
      }
    ], callback);
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
            var table = [];

            _.each(experiment.variations, function (variation) {
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
    models.experiment.find({}, "name startDate endDate events", function (err, experiments) {
      callback(err, experiments);
    });
  };

  publicAPI.getExperiment = function (experimentName, callback) {
    models.experiment.findOne({name: experimentName}, function (err, experiment) {
      callback(err, experiment);
    });
  };

  publicAPI.getDailyResults = function (options, callback) {
    // options:
    // - experiment
    // - event

    models.experiment.findOne({
      name: options.experiment
    }, function (err, experiment) {

      async.mapSeries(experiment.variations, function (variation, callback) {
        publicAPI.conversionRateOverRange({
          startDay: experiment.startDate || experiment._id.getTimestamp(),
          experiment: options.experiment,
          variation: variation.name,
          event: options.event,
          cumulative: options.cumulative
        }, function (err, result) {
          callback(err, {
            name: variation.name,
            result: result
          });
        });
      }, function (err, variationResults) {
        callback(err, {
          experiment: experiment,
          variations: variationResults
        });
      });
    });
  };

  publicAPI.getResults = function (options, callback) {
    // options:
    // - experiment
    // - event
    // - eventCount : minimum number of events for a conversion

    models.experiment.findOne({
      name: options.experiment
    }, function (err, experiment) {
      async.mapSeries(experiment.variations, function (variation, callback) {
        publicAPI.cumulativeConversionRateOverRange({
          startDay: experiment.startDate || experiment._id.getTimestamp(),
          experiment: options.experiment,
          variation: variation.name,
          event: options.event,
          eventCount: options.eventCount
        }, function (err, result) {
          callback(err, {
            name: variation.name,
            result: result
          });
        });
      }, function (err, variationResults) {
        callback(err, {
          experiment: experiment,
          variations: variationResults,
          combined: calcConversionMetrics({
            participants: _.reduce(variationResults, function (memo, variation) {
                return memo + variation.result.participants;
              }, 0),
            conversions: _.reduce(variationResults, function (memo, variation) {
                return memo + variation.result.conversions;
              }, 0)
          })
        });
      });
    });
  };

  publicAPI.cumulativeConversionRateOverRange = function (options, callback) {
    var query = _.pick(options, ['experiment', 'variation', 'event']);
    var newOptions = _.clone(options);

    // calc up to yesterday for 1st step (will calculate today's later which isn't cached)
    if (options.endDay) {
      newOptions.endDay = utils.snapToDay(new Date(Math.min(options.endDay.getTime(), new Date().getTime())));
    } else {
      newOptions.endDay = utils.snapToDay(new Date());
    }

    models.cumulativeConversions.findOne(query, function (err, conversions) {
      if (conversions && conversions.startDate.getTime() === utils.snapToDay(options.startDay).getTime()) {
        // shift start date to end of cumulative end date and feed into next step
        newOptions.startDay = conversions.endDate;
        newOptions.cumulativeData = {
          participants: utils.createSet(conversions.participants),
          convertedUsers: _.reduce(conversions.convertedUsers, function (memo, user) {
            memo[user._id] = user.count;
            return memo;
          }, {})
        };
      }

      async.waterfall([
        function (callback) {
          // update the cached value to yesterday at the latest
          if (newOptions.startDay.getTime() < newOptions.endDay.getTime()) {
            publicAPI._cumulativeConversionRateOverRangeByAggregation(newOptions, function (err, results) {
              // update cumulative data again to carry over to the last step
              newOptions.cumulativeData = {
                participants: results.participants,
                convertedUsers: results.convertedUsers,
              };

              if (!conversions || newOptions.endDay.getTime() > conversions.endDate.getTime()) {
                models.cumulativeConversions.update(query, {
                  $set: {
                    startDate: utils.snapToDay(options.startDay),
                    endDate: newOptions.endDay,
                    participants: _.keys(results.participants),
                    convertedUsers: _.map(results.convertedUsers, function (count, user) {
                      return {
                        _id: user,
                        count: count
                      };
                    })
                  }
                }, {upsert: true}, function (err, result) {
                  if (err) throw err;
                  callback();
                });
              } else {
                callback();
              }
            });
          } else {
            callback();
          }
        },
        function (callback) {
          newOptions.startDay = newOptions.endDay;
          newOptions.endDay = utils.nextDay(newOptions.endDay);
          // calc up to today
          publicAPI._cumulativeConversionRateOverRangeByAggregation(newOptions, function (err, results) {
            callback(null, results);
          });
        }
      ], function (err, results) {
        if (options.eventCount > 1) {
          results.convertedUsers = utils.filterObject(results.convertedUsers, function (count, user) {
            return count >= options.eventCount;
          });
        }

        callback(err, calcConversionMetrics({
          participants: _.keys(results.participants).length,
          conversions: _.keys(results.convertedUsers).length,
          totalConversions: utils.sumValues(results.convertedUsers)
        }));
      });
    });
  };

  var filterBasedOnEventCount = function () {
  };

  publicAPI._cumulativeConversionRateOverRangeByAggregation = function (options, callback) {
    // options:
    // - startDay
    // - endDay
    // - experiment
    // - variation
    // - event
    // - cumulativeData

    _.defaults(options, {
      endDay: new Date()
    });

    var allParticipants = {};
    var allConversions = {};

    if (options.cumulativeData) {
      allParticipants = options.cumulativeData.participants;
      allConversions = options.cumulativeData.convertedUsers;
    }
    
    async.eachSeries(utils.dayRange(options.startDay, options.endDay), function (day, callback) {
      var dayResult = {
        date: day
      };

      models.dayParticipantList.getUsers({day: day, experiment: options.experiment, variation: options.variation}, function (err, participants) {
        models.dayEventUserList.getUsers({day: day, event: options.event, days: 1}, function (err, eventUsers) {
          utils.setListUnion(allParticipants, participants);

          var newConvertedUsers = {};
          _.each(eventUsers, function (eventUser) {
            if (allParticipants[eventUser._id]) {
              allConversions[eventUser._id] = (allConversions[eventUser._id] || 0) + eventUser.count;
            }
          });
          utils.addCountMap(allConversions, newConvertedUsers);

          callback();
        });
      });
    }, function (err) {
      callback(err, {
        participants: allParticipants,
        convertedUsers: allConversions
      });
    });
  };

  publicAPI.conversionRateOverRange = function (options, callback) {
    // options:
    // - startDay
    // - endDay
    // - experiment
    // - variation
    // - event

    _.defaults(options, {
      endDay: new Date()
    });

    var allParticipants = {};
    var allConvertedUsers = {};

    async.mapSeries(utils.dayRange(options.startDay, options.endDay), function (day, callback) {
      var dayResult = {
        date: day
      };

      models.dayParticipantList.getUsers({day: day, experiment: options.experiment, variation: options.variation}, function (err, participants) {
        models.dayEventUserList.getUsers({day: day, event: options.event, days: 1}, function (err, eventUsers) {
          var convertedUsers = _.intersection(participants, _.pluck(eventUsers, '_id'));

          if (options.cumulative) {
            utils.setUnion(allParticipants, participants);
            utils.setSetUnion(allConvertedUsers, utils.setIntersection(allParticipants, _.pluck(eventUsers, '_id')));
          }

          callback(null, calcConversionMetrics({
            day: day,
            participants: participants.length,
            conversions: convertedUsers.length
          }));
        });
      });
    }, function (err, dailyResults) {
      var result = {
        daily: dailyResults
      };

      if (options.cumulative) {
        result.cumulative = calcConversionMetrics({
          participants: _.keys(allParticipants).length,
          conversions: _.keys(allConvertedUsers).length
        });
      }

      var participantsCount = 0;
      var conversionsCount = 0;
      _.each(dailyResults, function (dailyResult) {
        participantsCount += dailyResult.participants;
        conversionsCount += dailyResult.conversions;
      });
      result.dailyTotal = calcConversionMetrics({
        participants: participantsCount,
        conversions: conversionsCount
      });

      callback(err, result);
    });
  };

  var calcConversionMetrics = function (results) {
    results.conversionRate = results.participants > 0 ? results.conversions / results.participants : 0;

    if (results.participants > 0) {
      // standard error formula: https://developer.amazon.com/sdk/ab-testing/reference/ab-math.html
      var standardError = Math.sqrt(results.conversionRate * (1 - results.conversionRate) / results.participants);

      // 95% confidence interval is +- 1.96 * standard error
      // http://en.wikipedia.org/wiki/Standard_error#Assumptions_and_usage
      results.confidenceInterval = 1.96 * standardError;

      // 90% confidence interval is +- 1.64 * standard error
      // http://en.wikipedia.org/wiki/Normal_distribution#Quantile_function
      results.confidenceInterval90 = 1.64 * standardError;
    }
    return results;
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

