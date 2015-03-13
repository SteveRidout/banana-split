"use strict";

var _ = require('underscore');
var mongoose = require('mongoose');

// miscallaneous helpful functions

module.exports = {
  snapToDay: function (date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  },

  nextDay: function (day) {
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1));
  },

  previousDay: function (day) {
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - 1));
  },

  dateToObjectIdString: function (date) {
    return Math.floor(date.getTime() / 1000).toString(16) + "0000000000000000";
  },

  dateToObjectId: function (date) {
    return mongoose.Types.ObjectId(this.dateToObjectIdString(date));
  },

  // for quering _id fields based on date
  dayQuery: function (date) {
    var day = this.snapToDay(date);

    return {
      $gte: this.dateToObjectId(day),
      $lt: this.dateToObjectId(this.nextDay(day))
    };
  },

  formatPercentage: function (number) {
    return (100 * number) + "%";
  },

  dayToDate: function (year, month, date) {
    return new Date(Date.UTC(year, month - 1, date));
  },

  dateToDay: function (date) {
    return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  },

  dayRange: function (startDay, endDay) {
    var currentDate = this.snapToDay(startDay);
    var endDate = this.snapToDay(endDay);
    var range = [currentDate];

    while (currentDate < endDate) {
      currentDate = this.nextDay(currentDate);
      range.push(currentDate);
    }

    return range;
  },

  createSet: function (list) {
    return list ? this.setListUnion({}, list) : {};
  },

  // in-place union on set
  setListUnion: function (set, list) {
    _.each(list, function (item) {
      set[item] = true;
    });
    return set;
  },
  
  setSetUnion: function (set, setB) {
    _.each(setB, function (value, key) {
      set[key] = true;
    });
    return set;
  },

  addCountMap: function (mapA, mapB) {
    _.each(mapB, function (count, key) {
      mapA[key] = (mapA[key] || 0) + count;
    });
    return mapA;
  },

  // return new set with intersection
  setIntersection: function (set, list) {
    var newSet = {};
    _.each(list, function (item) {
      if (set[item]) {
        newSet[item] = true;
      }
    });
    return newSet;
  },

  sumValues: function (collection) {
    return _.reduce(collection, function (memo, value) {return memo + value;}, 0);
  },

  filterObject: function (object, callback) {
    var filtered = {};
    _.each(object, function (value, key) {
      if (callback(value, key)) {
        filtered[key] = value;
      }
    });
    return filtered;
  }
};

