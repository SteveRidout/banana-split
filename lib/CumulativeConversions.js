"use strict";

module.exports = function (config) {
  var cumulativeConversionsSchema = new config.mongoose.Schema({
    experiment:     String,
    variation:      String,
    event:          String,
    startDate:      Date,
    endDate:        Date,
    participants:   [String],
    convertedUsers: [{
      _id: String,
      count: Number
    }]
  });

  cumulativeConversionsSchema.index({experiment: 1, event: 1});

  return config.db.model('CumulativeConversion', cumulativeConversionsSchema);
};

