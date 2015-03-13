"use strict";

var _ = require('underscore'),
  async = require('async');

var utils = require('./utils.js');

module.exports = function (config) {
  var dayEventUserListSchema = new config.mongoose.Schema({
    day:    Date,
    event:  String,  // event name
    users:  [{
      _id:   String,
      count: Number
    }]
  });

  dayEventUserListSchema.index({event: 1, day: 1});

  dayEventUserListSchema.statics._getUsersByAggregation = function (query, callback) {
    if (config.unitTest) {
      // aggregation framework not supported by mockgoose :-(
      
      config.eventModel.find({_id: utils.dayQuery(query.day), name: query.event}, function (err, events) {
        var grouped = _.reduce(events, function (memo, event) {
          memo[event.user] = (memo[event.user] || 0) + 1;
          return memo;
        }, {});

        callback(null, _.map(grouped, function (count, user) {
          return {
            _id: user,
            count: count
          };
        }));
      });
    } else {
      config.eventModel.aggregate(
        {$match: {_id: utils.dayQuery(query.day), name: query.event}},
        {$group: {_id: '$user', count: {$sum: 1}}},
        callback
      );
    }
  };

  dayEventUserListSchema.statics.getUsers = function (options, callback) {
    // options:
    // - day {year, month, date}
    // - event
    // - filter (optional)
    
    var query = {
      day: utils.snapToDay(options.day),
      event: options.event
    };

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

  dayEventUserListSchema.statics.getStats = function (options, callback) {
    this.getUsers(options, function (err, users) {
      var data = {};

      data.total = _.reduce(users, function (memo, item) {
        return memo + item.count;
      }, 0);

      data.unique = users.length;
      data.over10 = _.reduce(users, function (memo, item) {
        if (item.count > 10) {
          memo++;
        }
        return memo;
      }, 0);

      data.over10ConversionRate = utils.formatPercentage((data.over10 / data.unique).toPrecision(3));
      callback(err, data);
    });
  };

  return config.db.model('DayEventUserList', dayEventUserListSchema);
};

