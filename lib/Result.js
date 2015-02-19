"use strict";

// Aggregated result of all events in 'experiment'

module.exports = function (options) {
  var resultSchema = new options.mongoose.Schema({
    experiment: String,   // Name of the experiment
    event:      String,   // Name of the event

    startDate:  Date,     // The date from which to start counting participants

    variations: [{
      name:               String,
      participants:       Number,
      conversions:        Number,
      conversionRate:     Number,
      confidenceInterval: Number
    }],
    lastCalculated: Date  // used to check that we're up to date
  });

  resultSchema.index({experiment: 1, event: 1});

  return options.db.model('Result', resultSchema);
};

