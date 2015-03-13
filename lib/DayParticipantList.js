"use strict";

var _ = require('underscore'),
  async = require('async');

var utils = require('./utils.js');

module.exports = function (config) {
  var dayParticipantListSchema = new config.mongoose.Schema({
    day:         Date,
    experiment:  String,  // experiment name / ID
    variation:   String,
    users:       [String] // list of users (filtered to show only first user per ip address on that day)
  });

  dayParticipantListSchema.index({experiment: 1, day: 1});

  dayParticipantListSchema.statics._getUsersByAggregation = function (query, callback) {
    var thisQuery = _.extend({}, _.omit(query, 'day'), {
      _id: utils.dayQuery(query.day),
      optedOut: false
    });

    config.participantModel
        .find(thisQuery, 'ip user')
        .sort({_id: 1})
        .exec(function (err, participants) {
      var ips = {};
      var filteredParticipants = _.filter(participants, function (participant) {
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

      callback(err, _.pluck(filteredParticipants, 'user'));
    });
  };

  dayParticipantListSchema.statics.excludeIPs = function (ips) {
    this.excludedIPs = ips;
  };

  dayParticipantListSchema.statics.getUsers = function (options, callback) {
    // options:
    // - day {year, month, date}
    // - experiment
    // - variation (optional, by default participants in all variations are selected)
    
    var query = {
      day: utils.snapToDay(options.day),
      experiment: options.experiment,
      variation: options.variation,
    };

    if (this.excludedIPs && this.excludedIPs.length > 0) {
      query.ip = {$nin: this.excludedIPs};
    }

    // use cache if querying data before today
    if (query.day < utils.snapToDay(new Date())) {
      this.findOne(query, function (err, dayEventUserList) {
        if (dayEventUserList) {
          callback(err, dayEventUserList.users);
          return;
        }

        this._getUsersByAggregation(query, function (err, result) {
          // place in cache for next time
          this.create(_.extend({}, query, {users: result}), function (err) {
            callback(err, result);
          });
        }.bind(this));
      }.bind(this));
    } else {
      this._getUsersByAggregation(query, callback);
    }
  };

  return config.db.model('DayParticipantsList', dayParticipantListSchema);
};

